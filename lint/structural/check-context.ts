// ─── What every structural check is handed ────────────────────────────
//
// One snapshot, parsed once, with each file classified and each import resolved
// to its canonical target. Checks read edges from here and never resolve a
// specifier themselves, so an alias and a relative spelling can't reach two
// verdicts.

import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isolatedGitEnv } from '#lib/platform/git/engine/fixture-git.ts';
import { classifyStudioPath, STUDIO_WORKSPACE_MOUNT, type StudioPosition } from '../policy/studio-tree.ts';
import { readDeclaredShared, readDeclaredStyles, type DeclarationProblem, type DeclaredStyles } from './project-declaration.ts';
import type { CandidateSnapshot, LiveSnapshot, MountedSnapshot } from '../candidate-snapshot.ts';
import { gateRepository, type GateScope } from '../gate-scope.ts';
import { createTypeCheckerHost, tsconfigFor, type SourceFile as TypedSourceFile, type TypeCheckerHost, type TypedProgram } from './type-checker.ts';
import { loadSourceTree, walkAst, type AstNode, type ImportTarget, type ScannedImport, type SourceFile, type SourceTree } from './source-tree.ts';

export type Finding = {
  check: string;
  path: string;
  line: number;
  /**
   * What the baseline counts this finding by, within its file: the specifier or the construct, never a line
   * number, so an edit above a baselined violation doesn't turn it into a new one.
   */
  key: string;
  message: string;
};

/** An advisory check reports on every run and never blocks, so it has no baseline. */
export type StructuralCheck = { id: string; advisory?: true; run: (context: CheckContext) => Finding[] };

export type ImportEdge = { from: SourceFile; scanned: ScannedImport; target: ImportTarget; line: number };

export type CheckContext = {
  /** The studio's checkout, absolute: where the snapshot's paths resolve for the compiler. */
  root: string;
  tree: SourceTree;
  /** Where a path sits, each project's `shared` (its project.ts) applied: every check reads one classification. */
  positionOf: (path: string) => StudioPosition;
  /** `shared` entries a project.ts writes that declare nothing, which scene ownership reports. */
  sharedDeclarationProblems: readonly DeclarationProblem[];
  /** Each project's `styles` (its project.ts): the only styles in work/styles/ it may import. */
  declaredStyles: DeclaredStyles;
  /** `styles` entries a project.ts writes that declare nothing, which import policy reports. */
  styleDeclarationProblems: readonly DeclarationProblem[];
  /** Every import edge of a governed file, in source order. */
  edgesFrom: (file: SourceFile) => readonly ImportEdge[];
  fileAt: (path: string) => SourceFile | undefined;
  /**
   * Where an exported name is defined, following named re-exports, `export *` and `import … export { … }` to the
   * module that declares it. Several origins when star exports collide; none when nothing in the snapshot defines it.
   * A namespace (`export * as ns`) comes back as its module's path with the name `'*'`.
   */
  originsOf: (path: string, name: string) => readonly { path: string; name: string }[];
  /** Every name a module offers, its star exports' included. */
  exportedNames: (path: string) => readonly string[];
  /**
   * The program that compiles `path` (tsconfigFor its position) and its parse there, undefined when that program
   * doesn't hold it. The compiler boots on the first call, so a run no type check reaches never starts one.
   */
  typed: (path: string) => { program: TypedProgram; file: TypedSourceFile | undefined };
  /** Ends the compiler, if a check started one. */
  dispose: () => void;
};

/**
 * Every call in `file` to the function `origin` defines, by whatever local name a runtime import gives it (through any
 * re-export or rename). A type-only import binds nothing callable, and a local look-alike isn't the function.
 */
export function callsTo(context: CheckContext, file: SourceFile, origin: { path: string; name: string }): AstNode[] {
  const locals = new Set(context.edgesFrom(file).flatMap((edge) => {
    if (edge.scanned.typeOnly || edge.target.kind !== 'module') return [];
    const target = edge.target.path;
    return edge.scanned.bindings
      .filter((binding) => context.originsOf(target, binding.imported).some((o) => o.path === origin.path && o.name === origin.name))
      .map((binding) => binding.local);
  }));
  const calls: AstNode[] = [];
  walkAst(file.program, (node) => {
    const callee = node.callee as AstNode | undefined;
    if (node.type === 'CallExpression' && callee?.type === 'Identifier' && locals.has(callee.name as string)) calls.push(node);
  });
  return calls;
}

/**
 * Paths the tree governs: everything declared, except generated output and what §4 leaves ungoverned. Read before any
 * project.ts is, so with no shared modules: `shared` only tells a governed file's role, never whether it's governed.
 */
export function studioScope(path: string): 'governed' | 'exempt' | 'undeclared' {
  const position = classifyStudioPath(path, {});
  if (position.kind === 'undeclared') return 'undeclared';
  if (position.kind === 'ungoverned') return 'exempt';
  if (position.kind === 'project' && position.role === 'generated') return 'exempt';
  if ((position.kind === 'web-client' || position.kind === 'web-server') && position.place === 'generated') return 'exempt';
  return 'governed';
}

/**
 * What check:arch reads. `public` is the studio's snapshot alone, as a clean clone holds it, in this process's git
 * environment. `workspace` adds work/'s, mounted at `work/`, beside the studio's of the same kind: this process's
 * environment is the workspace's (its hook's), and the studio's is read with none of it.
 */
export type CheckTarget =
  | { scope: Extract<GateScope, 'public'>; snapshot: CandidateSnapshot }
  | { scope: Extract<GateScope, 'workspace'>; snapshot: LiveSnapshot };

export function createCheckContext(root: string, target: CheckTarget): CheckContext {
  if (target.scope === 'public') {
    const tree = loadSourceTree({ repos: [gateRepository(root, 'public', target.snapshot)], scope: studioScope });
    // `work` itself is the workspace added as a gitlink.
    const tracked = [...tree.paths].find((path) => path === STUDIO_WORKSPACE_MOUNT || path.startsWith(`${STUDIO_WORKSPACE_MOUNT}/`));
    if (tracked) throw new Error(`the studio holds ${tracked}, in work/, which is your workspace's repository: untrack it (git rm --cached) and ignore it`);
    return contextFor(tree, root);
  }
  const workspace = gateRepository(root, 'workspace', target.snapshot);
  assertOwnWorkspaceRepository(workspace);
  const studio: MountedSnapshot = { ...gateRepository(root, 'public', target.snapshot), gitEnv: isolatedGitEnv() };
  return contextFor(loadSourceTree({ repos: [studio, workspace], scope: studioScope }), root);
}

/**
 * work/ must be a repository of its own, and the one this process's git environment names: a folder inside the
 * studio's repository, or a hook's GIT_DIR pointing elsewhere, would read the wrong index as the workspace's.
 */
function assertOwnWorkspaceRepository({ root, gitEnv }: MountedSnapshot): void {
  const revParse = (env: NodeJS.ProcessEnv, what: string) =>
    realpathSync(execFileSync('git', ['rev-parse', what], { cwd: root, env, encoding: 'utf8' }).trim());
  if (!existsSync(root) || revParse(isolatedGitEnv(), '--show-toplevel') !== realpathSync(root)) {
    throw new Error(`${root} isn't a repository of its own: run \`studio workspace init\``);
  }
  const own = revParse(isolatedGitEnv(), '--absolute-git-dir'), read = revParse(gitEnv, '--absolute-git-dir');
  if (read !== own) throw new Error(`git reads ${read} for ${root}, not its own ${own}: this process's GIT_DIR names another repository`);
}

export function contextFor(tree: SourceTree, root: string): CheckContext {
  const declarations = tree.sources.flatMap((file) => {
    const position = classifyStudioPath(file.path, {});
    return position.kind === 'project' && position.role === 'project' ? [{ project: position.project, file }] : [];
  });
  const { shared: declaredShared, problems: sharedDeclarationProblems } = readDeclaredShared(declarations);
  const { styles: declaredStyles, problems: styleDeclarationProblems } = readDeclaredStyles(declarations);
  const byPath = new Map(tree.sources.map((file) => [file.path, file]));
  const edges = new Map<SourceFile, ImportEdge[]>();
  const edgesFrom = (file: SourceFile) => {
    let list = edges.get(file);
    if (!list) {
      list = file.imports.map((scanned) => ({
        from: file, scanned, line: file.lineOf(scanned.offset), target: tree.resolveImport(file.path, scanned.specifier, scanned.names),
      }));
      edges.set(file, list);
    }
    return list;
  };
  const moduleTarget = (from: string, specifier: string) => {
    const target = tree.resolveImport(from, specifier, '*');
    return target.kind === 'module' ? target.path : undefined;
  };
  const originsOf = (path: string, name: string, seen = new Set<string>()): { path: string; name: string }[] => {
    const key = `${path}#${name}`;
    const file = byPath.get(path);
    if (seen.has(key)) return [];
    // A module outside the parsed set (a package-less generated file) is as far as the name can be followed.
    if (!file) return [{ path, name }];
    seen.add(key);
    const declared = file.exports.find((entry) => entry.exported === name);
    if (declared) {
      if (!declared.from) return [{ path, name }];
      const next = moduleTarget(path, declared.from.specifier);
      if (!next) return [];
      // `export * as ns from './m'`: the name is m's namespace, reported as m with the name '*'.
      return declared.from.imported === '*' ? [{ path: next, name: '*' }] : originsOf(next, declared.from.imported, seen);
    }
    if (name === 'default') return [];
    return file.starExports.flatMap((star) => {
      const next = moduleTarget(path, star.specifier);
      return next ? originsOf(next, name, seen) : [];
    });
  };
  const exportedNames = (path: string, seen = new Set<string>()): string[] => {
    const file = byPath.get(path);
    if (!file || seen.has(path)) return [];
    seen.add(path);
    const own = file.exports.map((entry) => entry.exported);
    const starred = file.starExports.flatMap((star) => {
      const next = moduleTarget(path, star.specifier);
      return next ? exportedNames(next, seen).filter((name) => name !== 'default') : [];
    });
    return [...new Set([...own, ...starred])];
  };
  let types: TypeCheckerHost | undefined;
  const positionOf = (path: string) => classifyStudioPath(path, declaredShared);
  return {
    root,
    tree,
    typed: (path) => {
      types ??= createTypeCheckerHost(root, tree);
      const program = types.programFor(tsconfigFor(positionOf(path)));
      return { program, file: program.sourceFile(path) };
    },
    dispose: () => types?.dispose(),
    exportedNames: (path) => exportedNames(path),
    positionOf,
    sharedDeclarationProblems,
    declaredStyles,
    styleDeclarationProblems,
    edgesFrom,
    fileAt: (path) => byPath.get(path),
    originsOf: (path, name) => originsOf(path, name),
  };
}
