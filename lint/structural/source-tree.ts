// ─── The files the checks read, parsed once, from one git snapshot ────
//
// Every check reads the same candidate snapshot: the index (what the next commit
// would hold) or a committed tree. Never the working tree, so an untracked
// scratch file or a half-edit by another agent can't change a verdict, and a
// pre-commit run judges exactly what is being committed.
//
// Import targets resolve against that snapshot too. Gitignored generated inputs
// (`captures/index.ts`, `music/index.ts`) aren't in it: their edges stay, as a
// canonical path with `backed: false`, so a check still classifies them by path.

import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { parseSync } from 'oxc-parser';
import { expandStudioAlias, normalizeRepoPath } from '../policy/studio-tree.ts';

export type CandidateSnapshot = { kind: 'index' } | { kind: 'commit'; rev: string };

/**
 * Whether the declared tree governs a path. `undeclared` isn't dropped silently: those source files come back in
 * `SourceTree.undeclared` for the runner to report.
 */
export type TreeScope = (path: string) => 'governed' | 'exempt' | 'undeclared';

export type AstNode = { type: string; start: number; end: number; [key: string]: unknown };

/**
 * One import occurrence. `names` is what it takes from the module (`default` for a default import), or `'*'` for the
 * whole module: a namespace, a side-effect or a dynamic import. `bindings` maps each local name to what it imports.
 */
export type ScannedImport = {
  specifier: string;
  offset: number;
  names: readonly string[] | '*';
  typeOnly: boolean;
  bindings: readonly { imported: string; local: string }[];
};

/**
 * One name a module offers. `from` is set when it's re-exported (`imported` is `'*'` for `export * as ns`); a
 * module's bare `export *` targets are listed apart, in `SourceFile.starExports`.
 */
export type ScannedExport = { exported: string; typeOnly: boolean; from?: { specifier: string; imported: string } };

/**
 * Where a specifier lands, canonically: an alias and the relative spelling of the same file give the same `path`.
 * A `#` specifier no `imports` key matches is its own kind, for a check to refuse, never passed on as a package.
 */
export type ImportTarget =
  | { kind: 'module'; path: string; backed: boolean }
  | { kind: 'package'; name: string; names: readonly string[] | '*' }
  | { kind: 'builtin'; name: string }
  | { kind: 'unresolved-alias'; specifier: string };

export type SourceFile = {
  /** Repo-relative, `/`-separated. */
  path: string;
  text: string;
  program: AstNode;
  imports: ScannedImport[];
  exports: ScannedExport[];
  starExports: readonly { specifier: string; typeOnly: boolean }[];
  lineOf: (offset: number) => number;
};

export type SourceTree = {
  snapshot: CandidateSnapshot;
  /** Every path in the snapshot, any extension. */
  paths: ReadonlySet<string>;
  /** Parsed source files the scope governs. */
  sources: readonly SourceFile[];
  /** Source files the scope doesn't declare: reported, never skipped silently. */
  undeclared: readonly string[];
  resolveImport: (fromPath: string, specifier: string, names: readonly string[] | '*') => ImportTarget;
  /** Snapshot files' text, for checks over non-source files (docs, shell), read in one batch. */
  readTexts: (paths: readonly string[]) => string[];
};

export const SOURCE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'] as const;
const SOURCE_RE = new RegExp(`\\.(${SOURCE_EXTENSIONS.join('|')})$`);

export function loadSourceTree(options: { root: string; snapshot: CandidateSnapshot; scope: TreeScope }): SourceTree {
  const { root, snapshot, scope } = options;
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
  const listed = snapshot.kind === 'index'
    ? git(['ls-files', '--cached', '-z'])
    : git(['ls-tree', '-r', '-z', '--name-only', snapshot.rev]);
  const paths = new Set(listed.split('\0').filter(Boolean));
  const objectName = (path: string) => (snapshot.kind === 'index' ? `:${path}` : `${snapshot.rev}:${path}`);
  const texts = new Map<string, string>();
  const readTexts = (wanted: readonly string[]) => {
    const missing = wanted.filter((path) => !texts.has(path));
    readBlobs(root, missing.map(objectName)).forEach((text, i) => texts.set(missing[i], text));
    return wanted.map((path) => texts.get(path)!);
  };
  const readText = (path: string) => readTexts([path])[0];
  const candidates = [...paths].filter((path) => SOURCE_RE.test(path) && !path.endsWith('.d.ts'));
  const scoped = candidates.map((path) => ({ path, verdict: scope(path) }));
  const governed = scoped.filter(({ verdict }) => verdict === 'governed').map(({ path }) => path);
  readTexts(governed);

  const sources = governed.map((path) => parseSourceFile(path, readText(path)));
  const undeclared = scoped.filter(({ verdict }) => verdict === 'undeclared').map(({ path }) => path);
  const aliases = paths.has('package.json') ? readImportsMap(readText('package.json')) : {};
  return {
    snapshot, paths, sources, undeclared: undeclared.sort(), readTexts,
    resolveImport: (fromPath, specifier, names) => resolveImportTarget(paths, aliases, fromPath, specifier, names),
  };
}

export function parseSourceFile(path: string, text: string): SourceFile {
  const parsed = parseSync(path, text);
  if (parsed.errors.length) throw new Error(`${path} doesn't parse: ${parsed.errors[0].message}`);
  const program = parsed.program as unknown as AstNode;
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset: number) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  return { path, text, program, ...scanModule(parsed.module, program), lineOf };
}

/**
 * Every import a file names: static imports and re-exports off the module record (a re-export keeps its edge), and
 * the forms the record doesn't carry (`import()`, `require()`, `import('…')` in a type, `import x = require()`,
 * `export {} from`). A type-only import is kept and marked: it couples two ends without executing, which a purity
 * check must tell apart. The forms follow the enforced-architecture catalog's `import-scanning.ts`.
 */
function scanModule(module: ReturnType<typeof parseSync>['module'], program: AstNode) {
  const nameOf = (name: { kind: string; name: string | null }) =>
    name.kind === 'Name' ? name.name! : name.kind === 'Default' ? 'default' : '*';
  const imports: ScannedImport[] = [];
  const staticOffsets = new Set<number>();
  for (const statement of module.staticImports) {
    staticOffsets.add(statement.moduleRequest.start);
    const names = statement.entries.map((entry) => nameOf(entry.importName));
    imports.push({
      specifier: statement.moduleRequest.value, offset: statement.moduleRequest.start,
      names: names.length === 0 || names.includes('*') ? '*' : names,
      typeOnly: statement.entries.length > 0 && statement.entries.every((entry) => entry.isType),
      bindings: statement.entries.map((entry) => ({ imported: nameOf(entry.importName), local: entry.localName.value })),
    });
  }
  const exports: ScannedExport[] = [];
  const starExports: { specifier: string; typeOnly: boolean }[] = [];
  const reexports = new Map<number, ScannedImport>();
  for (const statement of module.staticExports) {
    for (const entry of statement.entries) {
      const request = entry.moduleRequest;
      if (!request) {
        exports.push({ exported: nameOf(entry.exportName), typeOnly: entry.isType });
        continue;
      }
      const imported = nameOf(entry.importName);
      if (entry.exportName.kind === 'None') starExports.push({ specifier: request.value, typeOnly: entry.isType });
      else exports.push({ exported: nameOf(entry.exportName), typeOnly: entry.isType, from: { specifier: request.value, imported } });
      // `import { x } from './a'; export { x }` arrives as a re-export of './a', whose edge the import already holds.
      if (staticOffsets.has(request.start)) continue;
      const existing = reexports.get(request.start);
      if (existing) {
        existing.names = existing.names === '*' || imported === '*' ? '*' : [...existing.names, imported];
        existing.typeOnly &&= entry.isType;
      } else {
        reexports.set(request.start, {
          specifier: request.value, offset: request.start, names: imported === '*' ? '*' : [imported], typeOnly: entry.isType, bindings: [],
        });
      }
    }
  }
  imports.push(...reexports.values());
  // `const { a, b } = await import('./x')` takes just `a` and `b`, which a name-level check can read.
  const destructured = new Map<AstNode, string[]>();
  walkAst(program, (node) => {
    const awaited = node.type === 'VariableDeclarator' && (node.init as AstNode | null)?.type === 'AwaitExpression'
      ? ((node.init as AstNode).argument as AstNode) : undefined;
    const pattern = node.id as AstNode | undefined;
    if (awaited?.type !== 'ImportExpression' || pattern?.type !== 'ObjectPattern') return;
    const keys = (pattern.properties as AstNode[]).map((property) =>
      property.type === 'Property' && !property.computed && (property.key as AstNode).type === 'Identifier' ? (property.key as AstNode).name as string : undefined);
    if (keys.every((key) => key !== undefined)) destructured.set(awaited, keys);
  });
  walkAst(program, (node) => {
    let source: unknown, typeOnly = false;
    if (node.type === 'ImportExpression') source = node.source;
    else if (node.type === 'TSImportType') {
      source = node.source ?? (node.argument as AstNode | undefined)?.literal ?? node.argument;
      typeOnly = true;
    } else if (node.type === 'CallExpression' && isRequire(node.callee as AstNode)) source = (node.arguments as AstNode[])[0];
    else if (node.type === 'TSImportEqualsDeclaration') {
      const reference = node.moduleReference as AstNode;
      if (reference.type === 'TSExternalModuleReference') source = reference.expression;
      typeOnly = node.importKind === 'type';
    } else if (node.type === 'ExportNamedDeclaration' && (node.specifiers as unknown[]).length === 0) source = node.source;
    const literal = source as AstNode | undefined;
    if (literal?.type === 'Literal' && typeof literal.value === 'string') {
      imports.push({ specifier: literal.value, offset: literal.start, names: destructured.get(node) ?? '*', typeOnly, bindings: [] });
    }
  });
  return { imports: imports.sort((a, b) => a.offset - b.offset), exports, starExports };
}

const isRequire = (callee: AstNode) =>
  (callee.type === 'Identifier' && callee.name === 'require') ||
  (callee.type === 'MemberExpression' && (callee.object as AstNode).name === 'require' && (callee.property as AstNode).name === 'resolve');

/** Depth-first over every node; `visit` returning `false` skips that node's children. */
export function walkAst(node: unknown, visit: (node: AstNode, parent: AstNode | undefined) => boolean | void, parent?: AstNode): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visit, parent);
    return;
  }
  const record = node as AstNode;
  if (typeof record.type === 'string') {
    if (visit(record, parent) === false) return;
    parent = record;
  }
  for (const key in record) if (key !== 'type') walkAst(record[key], visit, parent);
}

/** Many blobs in one `git cat-file --batch`, in order. Sizes are bytes, so the output is sliced as a Buffer. */
function readBlobs(root: string, objectNames: readonly string[]): string[] {
  if (objectNames.length === 0) return [];
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: objectNames.join('\n') + '\n', maxBuffer: 1 << 30 });
  const texts: string[] = [];
  let at = 0;
  for (const name of objectNames) {
    const headerEnd = out.indexOf(0x0a, at);
    const header = out.subarray(at, headerEnd).toString('utf8');
    const match = /^\S+ blob (\d+)$/.exec(header);
    if (!match) throw new Error(`git cat-file can't read ${name}: ${header}`);
    const size = Number(match[1]);
    texts.push(out.subarray(headerEnd + 1, headerEnd + 1 + size).toString('utf8'));
    at = headerEnd + 1 + size + 1;
  }
  return texts;
}

function readImportsMap(packageJson: string): Record<string, string> {
  const imports = (JSON.parse(packageJson) as { imports?: Record<string, unknown> }).imports ?? {};
  const map: Record<string, string> = {};
  for (const [key, target] of Object.entries(imports)) {
    // A conditional target is refused, not guessed at: the aliases the plan wants each name one file.
    if (typeof target !== 'string') throw new Error(`package.json imports["${key}"] must be a plain path, not conditions`);
    map[key] = target;
  }
  return map;
}

const BUILTINS = new Set(builtinModules);

function resolveImportTarget(
  paths: ReadonlySet<string>, aliases: Record<string, string>, fromPath: string, specifier: string, names: readonly string[] | '*',
): ImportTarget {
  if (specifier.startsWith('node:') || BUILTINS.has(specifier.split('/')[0])) return { kind: 'builtin', name: specifier };
  let modulePath: string | undefined;
  if (specifier.startsWith('#')) {
    modulePath = expandStudioAlias(specifier, aliases);
    if (modulePath === undefined) return { kind: 'unresolved-alias', specifier };
  } else if (specifier.startsWith('.') || specifier.startsWith('/')) {
    modulePath = `${fromPath.slice(0, fromPath.lastIndexOf('/') + 1)}${specifier}`;
  }
  if (modulePath === undefined) {
    const segments = specifier.split('/');
    const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
    return { kind: 'package', name, names: name === specifier ? names : '*' };
  }
  const canonical = normalizeRepoPath(modulePath);
  const backing = backingFile(paths, canonical);
  return { kind: 'module', path: backing ?? canonical, backed: backing !== undefined };
}

/**
 * The snapshot file a module path lands on: the path itself, then with each extension, then its `index`. Only files
 * are in the snapshot's path set, so a directory never matches before its `index.ts` is tried.
 */
function backingFile(paths: ReadonlySet<string>, modulePath: string): string | undefined {
  if (paths.has(modulePath)) return modulePath;
  for (const ext of SOURCE_EXTENSIONS) if (paths.has(`${modulePath}.${ext}`)) return `${modulePath}.${ext}`;
  for (const ext of SOURCE_EXTENSIONS) if (paths.has(`${modulePath}/index.${ext}`)) return `${modulePath}/index.${ext}`;
  return undefined;
}
