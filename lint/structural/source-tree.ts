// ─── The files the checks read, parsed once, from one snapshot ────────
//
// Every check reads the same candidate snapshot (lint/candidate-snapshot.ts):
// the working tree run by hand, the index under a hook, so a pre-commit run
// judges exactly what's committed, or a committed tree.
//
// Imports resolve against that snapshot too. Gitignored generated inputs
// (`captures/index.ts`, `music/index.ts`) aren't in it: their edges stay, as a
// canonical path with `backed: false`, so a check still classifies them by path.
//
// A tree can be read from several repositories, each mounted at a folder of one
// path space (the workspace at `work/` beside the studio's root), so a project's
// `#studio` resolves to the studio's file and every check sees one tree.

import { builtinModules } from 'node:module';
import { parseSync } from 'oxc-parser';
import { listSnapshotPaths, readSnapshotTexts, type SnapshotRepository } from '../candidate-snapshot.ts';
import { expandStudioAlias, normalizeRepoPath } from '../policy/studio-tree.ts';

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
  | { kind: 'unresolved-alias'; specifier: string }
  /** An absolute path, or a relative one climbing above the repo root. */
  | { kind: 'outside'; specifier: string }
  /** `import(expr)` or `require(expr)` with a computed specifier: what it loads can't be read. */
  | { kind: 'computed' };

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

/**
 * One repository's snapshot and its place in the tree's path space: `mount` is `''` for the root repository,
 * whose package.json names the aliases, or a folder (`work`) prefixing every path it lists.
 * `gitEnv` is the environment git runs in: the process's own for the repository git is committing (a hook's
 * GIT_INDEX_FILE is the index the commit holds), isolatedGitEnv() for any other.
 */
export type MountedSnapshot = SnapshotRepository & { mount: string };

export type SourceTree = {
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
/** A TypeScript or JavaScript file by its extension, a declaration file included. */
export const isSourcePath = (path: string) => SOURCE_RE.test(path);

/** Every mounted repository's snapshot, read as one tree. Two repositories listing one path is refused. */
export function loadSourceTree(options: { repos: readonly MountedSnapshot[]; scope: TreeScope }): SourceTree {
  const { repos, scope } = options;
  const owner = new Map<string, { repo: MountedSnapshot; own: string }>();
  for (const repo of repos) {
    for (const own of listSnapshotPaths(repo)) {
      const path = repo.mount ? `${repo.mount}/${own}` : own;
      const mountedThere = repos.find((other) => other !== repo && other.mount && path.startsWith(`${other.mount}/`));
      if (mountedThere) throw new Error(`${repo.root} tracks ${own}, inside ${mountedThere.root}, a repository of its own: untrack it (git rm --cached)`);
      owner.set(path, { repo, own });
    }
  }
  const paths: ReadonlySet<string> = new Set(owner.keys());
  const texts = new Map<string, string>();
  const readTexts = (wanted: readonly string[]) => {
    const missing = wanted.filter((path) => !texts.has(path));
    for (const repo of repos) {
      const ours = missing.filter((path) => owner.get(path)?.repo === repo);
      readSnapshotTexts(repo, ours.map((path) => owner.get(path)!.own)).forEach((text, i) => texts.set(ours[i], text));
    }
    return wanted.map((path) => {
      const text = texts.get(path);
      if (text === undefined) throw new Error(`${path} isn't in the snapshot`);
      return text;
    });
  };
  const readText = (path: string) => readTexts([path])[0];
  const candidates = [...paths].filter((path) => isSourcePath(path) && !path.endsWith('.d.ts'));
  const scoped = candidates.map((path) => ({ path, verdict: scope(path) }));
  const governed = scoped.filter(({ verdict }) => verdict === 'governed').map(({ path }) => path);
  readTexts(governed);

  const sources = governed.map((path) => parseSourceFile(path, readText(path)));
  const undeclared = scoped.filter(({ verdict }) => verdict === 'undeclared').map(({ path }) => path);
  // The aliases are the root repository's: a mounted one has no package.json of its own, so Node resolves its `#`
  // imports through the root's too.
  const aliases = owner.get('package.json')?.repo.mount === '' ? readImportsMap(readText('package.json')) : {};
  return {
    paths, sources, undeclared: undeclared.toSorted(), readTexts,
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
 * check must tell apart.
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
    if (source == null) return;
    const literal = source as AstNode;
    const names = destructured.get(node) ?? '*';
    const quasis = literal.type === 'TemplateLiteral' && (literal.expressions as unknown[]).length === 0 ? literal.quasis as AstNode[] : undefined;
    const text = literal.type === 'Literal' && typeof literal.value === 'string'
      ? literal.value : (quasis?.[0]?.value as { cooked?: string } | undefined)?.cooked;
    // A computed specifier keeps its edge, as the empty string, so a check can refuse what it can't follow.
    imports.push({ specifier: text ?? '', offset: literal.start ?? node.start, names, typeOnly, bindings: [] });
  });
  return { imports: imports.toSorted((a, b) => a.offset - b.offset), exports, starExports };
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
  if (specifier === '') return { kind: 'computed' };
  // A bundler query (`./app.css?url`, `./x.ts?raw`) loads the same file, so it lands where the bare path does.
  specifier = specifier.replace(/\?.*$/, '');
  if (specifier.startsWith('/')) return { kind: 'outside', specifier };
  if (specifier.startsWith('node:') || BUILTINS.has(specifier.split('/')[0])) return { kind: 'builtin', name: specifier };
  let modulePath: string | undefined;
  if (specifier.startsWith('#')) {
    modulePath = expandStudioAlias(specifier, aliases);
    if (modulePath === undefined) return { kind: 'unresolved-alias', specifier };
  } else if (specifier.startsWith('.')) {
    modulePath = `${fromPath.slice(0, fromPath.lastIndexOf('/') + 1)}${specifier}`;
  }
  if (modulePath === undefined) {
    const segments = specifier.split('/');
    const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
    return { kind: 'package', name, names: name === specifier ? names : '*' };
  }
  const canonical = normalizeRepoPath(modulePath);
  if (canonical === '..' || canonical.startsWith('../')) return { kind: 'outside', specifier };
  const backing = backingFile(paths, canonical);
  return { kind: 'module', path: backing ?? canonical, backed: backing !== undefined };
}

/**
 * The snapshot file a module path lands on: the path itself, then with each extension, then its `index`. Only files
 * are in the snapshot's path set, so a directory never matches before its `index.ts` is tried.
 */
function backingFile(paths: ReadonlySet<string>, modulePath: string): string | undefined {
  if (paths.has(modulePath)) return modulePath;
  // Bundler resolution lets `./x.js` name `x.ts`, as TypeScript's own emit spelling does.
  const js = /\.(m|c)?js(x?)$/.exec(modulePath);
  if (js) {
    const stem = modulePath.slice(0, js.index);
    const swapped = [`${stem}.${js[1] ?? ''}ts${js[2]}`, ...(js[2] ? [] : [`${stem}.${js[1] ?? ''}tsx`])];
    const found = swapped.find((candidate) => paths.has(candidate));
    if (found) return found;
  }
  for (const ext of SOURCE_EXTENSIONS) if (paths.has(`${modulePath}.${ext}`)) return `${modulePath}.${ext}`;
  for (const ext of SOURCE_EXTENSIONS) if (paths.has(`${modulePath}/index.${ext}`)) return `${modulePath}/index.${ext}`;
  return undefined;
}
