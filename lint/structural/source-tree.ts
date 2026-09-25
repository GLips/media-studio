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
import { posix } from 'node:path';
import { parseSync } from 'oxc-parser';

export type CandidateSnapshot = { kind: 'index' } | { kind: 'commit'; rev: string };

/**
 * Whether the declared tree governs a path. `undeclared` isn't dropped silently: those source files come back in
 * `SourceTree.undeclared` for the runner to report.
 */
export type TreeScope = (path: string) => 'governed' | 'exempt' | 'undeclared';

export type AstNode = { type: string; start: number; end: number; [key: string]: unknown };

export type ScannedImport = { specifier: string; offset: number; names: readonly string[] | '*'; typeOnly: boolean };

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
  /** A snapshot file's text, for checks over non-source files (docs, shell). */
  readText: (path: string) => string;
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
  const readText = (path: string) => {
    if (!texts.has(path)) readBlobs(root, [path].map(objectName)).forEach((text) => texts.set(path, text));
    return texts.get(path)!;
  };
  const candidates = [...paths].filter((path) => SOURCE_RE.test(path) && !path.endsWith('.d.ts'));
  const scoped = candidates.map((path) => ({ path, verdict: scope(path) }));
  const governed = scoped.filter(({ verdict }) => verdict === 'governed').map(({ path }) => path);
  readBlobs(root, governed.map(objectName)).forEach((text, i) => texts.set(governed[i], text));

  const sources = governed.map((path) => parseSourceFile(path, readText(path)));
  const undeclared = scoped.filter(({ verdict }) => verdict === 'undeclared').map(({ path }) => path);
  const aliases = paths.has('package.json') ? readImportsMap(readText('package.json')) : {};
  return {
    snapshot, paths, sources, undeclared: undeclared.sort(), readText,
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
  return { path, text, program, imports: scanImports(parsed.module, program), lineOf };
}

/**
 * Every import a file names: static imports and re-exports off the module record (a re-export keeps its edge), and
 * the forms the record doesn't carry (`import()`, `require()`, `import('…')` in a type, `import x = require()`,
 * `export {} from`). A type-only import is kept and marked: it couples two ends without executing, which a purity
 * check must tell apart. The forms follow the enforced-architecture catalog's `import-scanning.ts`.
 */
function scanImports(module: ReturnType<typeof parseSync>['module'], program: AstNode): ScannedImport[] {
  const found: ScannedImport[] = [];
  for (const statement of module.staticImports) {
    const names = statement.entries.map((entry) => (entry.importName.kind === 'Name' ? entry.importName.name! : '*'));
    found.push({
      specifier: statement.moduleRequest.value, offset: statement.moduleRequest.start,
      names: names.length === 0 || names.includes('*') ? '*' : names,
      typeOnly: statement.entries.length > 0 && statement.entries.every((entry) => entry.isType),
    });
  }
  const reexports = new Map<number, ScannedImport>();
  for (const statement of module.staticExports) {
    for (const entry of statement.entries) {
      if (!entry.moduleRequest) continue;
      const name = entry.importName.kind === 'Name' ? entry.importName.name! : '*';
      const existing = reexports.get(entry.moduleRequest.start);
      if (existing) {
        existing.names = existing.names === '*' || name === '*' ? '*' : [...existing.names, name];
        existing.typeOnly &&= entry.isType;
      } else {
        reexports.set(entry.moduleRequest.start, {
          specifier: entry.moduleRequest.value, offset: entry.moduleRequest.start, names: name === '*' ? '*' : [name], typeOnly: entry.isType,
        });
      }
    }
  }
  found.push(...reexports.values());
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
      found.push({ specifier: literal.value, offset: literal.start, names: '*', typeOnly });
    }
  });
  return found.sort((a, b) => a.offset - b.offset);
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
    modulePath = expandAlias(specifier, aliases);
    if (modulePath === undefined) return { kind: 'unresolved-alias', specifier };
  } else if (specifier.startsWith('.') || specifier.startsWith('/')) {
    modulePath = posix.join(posix.dirname(fromPath), specifier);
  }
  if (modulePath === undefined) {
    const segments = specifier.split('/');
    const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
    return { kind: 'package', name, names: name === specifier ? names : '*' };
  }
  const canonical = posix.normalize(modulePath).replace(/\/$/, '');
  const backing = backingFile(paths, canonical);
  return { kind: 'module', path: backing ?? canonical, backed: backing !== undefined };
}

/**
 * Node's subpath-import rule: an exact key first, then the `*` pattern with the longest prefix. The result is
 * repo-relative and normalized, so `#studio` and `../../lib/studio/api.ts` compare equal.
 */
export function expandAlias(specifier: string, imports: Readonly<Record<string, string>>): string | undefined {
  let target = imports[specifier];
  if (target === undefined) {
    let best: { prefix: string; suffix: string; target: string } | undefined;
    for (const [key, value] of Object.entries(imports)) {
      const star = key.indexOf('*');
      if (star < 0) continue;
      const prefix = key.slice(0, star), suffix = key.slice(star + 1);
      if (specifier.length < prefix.length + suffix.length || !specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
      if (!best || prefix.length > best.prefix.length) best = { prefix, suffix, target: value };
    }
    if (!best) return undefined;
    target = best.target.replaceAll('*', specifier.slice(best.prefix.length, specifier.length - best.suffix.length));
  }
  return posix.normalize(target);
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
