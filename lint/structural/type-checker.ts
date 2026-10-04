// ─── What a declaration means: one TypeScript process per check:arch run ──
//
// The `types` checks ask the compiler what an annotation resolves to, which no
// syntax walk can answer. TypeScript 7's API is the only door (its main entry
// has no createProgram), and this file is the one importer of its `unstable`
// path. The sync client: checks return findings, never promises.
//
// The compiler reads the check's snapshot: every file the snapshot holds is
// served from it through the API's virtual filesystem, so under a hook a type
// check judges what the next commit holds, as every other check does. What the
// snapshot doesn't hold (node_modules, gitignored generated inputs) falls
// through to disk.

import { resolve, sep } from 'node:path';
import { API, SymbolFlags, TypeFlags } from 'typescript/unstable/sync';
import type { Checker, IndexInfo, Program, Snapshot, Type } from 'typescript/unstable/sync';
import { NodeFlags, SyntaxKind } from 'typescript/unstable/ast';
import type { Node, SourceFile } from 'typescript/unstable/ast';
import type { StudioPosition } from '../policy/studio-tree.ts';
import type { SourceTree } from './source-tree.ts';

export { NodeFlags, SyntaxKind, TypeFlags };
export type { Checker, IndexInfo, Node, Program, SourceFile, Type };

/**
 * The tsconfig whose program compiles a position: the web app's own (DOM and Vite's types), the repo's for
 * everything else. Keyed by position, so a folder is typed the moment studio-tree.ts declares it.
 */
export function tsconfigFor(position: StudioPosition): string {
  return position.kind === 'web-client' || position.kind === 'web-server' ? 'web/tsconfig.json' : 'tsconfig.json';
}

/** One program and its checker, with the one cache worth sharing across checks. */
export type TypedProgram = {
  program: Program;
  checker: Checker;
  /** The program's parse of a repo-relative path, or undefined when the program doesn't compile it. */
  sourceFile: (path: string) => SourceFile | undefined;
  /** `checker.getIndexInfosOfType`, memoised by type id: one bag shape written in many files is one type. */
  indexSignatures: (type: Type) => readonly IndexInfo[];
  /**
   * Whether every declaration of the name at `node` sits in a governed file of the tree. A reference to a name the
   * checks also walk isn't the violation's site, its declaration is; one declared in lib.d.ts or node_modules is.
   */
  declaredInTree: (node: Node) => boolean;
  /** Repo-relative path of a program file name. */
  repoPath: (fileName: string) => string;
};

const COMPILER_INPUT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/;

export type TypeCheckerHost = { programFor: (tsconfig: string) => TypedProgram; dispose: () => void };

/**
 * Serves the tree's snapshot to the compiler: its files read, and its folders list, as the snapshot holds them. A file
 * it doesn't track falls through to disk (`undefined`), which node_modules and gitignored generated inputs imported
 * by path need; they join a program only through an import, never an include glob.
 */
export function createTypeCheckerHost(root: string, tree: SourceTree): TypeCheckerHost {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  const repoRelative = (fileName: string) =>
    fileName === root ? '' : fileName.startsWith(prefix) ? fileName.slice(prefix.length).split(sep).join('/') : undefined;
  const tracked = (fileName: string) => {
    const path = repoRelative(fileName);
    return path !== undefined && tree.paths.has(path) ? path : undefined;
  };
  // The snapshot's folders, so a tsconfig's include globs expand over what it holds, never a gitignored file.
  const folders = new Map<string, { files: string[]; directories: string[] }>([['', { files: [], directories: [] }]]);
  for (const path of tree.paths) {
    const parts = path.split('/');
    for (let depth = 0; depth < parts.length; depth++) {
      const folder = parts.slice(0, depth).join('/');
      let entries = folders.get(folder);
      if (!entries) folders.set(folder, (entries = { files: [], directories: [] }));
      const name = parts[depth];
      if (depth === parts.length - 1) entries.files.push(name);
      else if (!entries.directories.includes(name)) entries.directories.push(name);
    }
  }
  // node_modules isn't in the snapshot: its folders read from disk.
  const listed = (folder: string | undefined) => (folder === undefined || folder.split('/').includes('node_modules') ? undefined : folder);
  // Everything the compiler may read, in one git batch: one read per request would spawn a git per file.
  tree.readTexts([...tree.paths].filter((path) => COMPILER_INPUT.test(path)));
  const api = new API({
    cwd: root,
    fs: {
      readFile: (fileName) => {
        const path = tracked(fileName);
        return path === undefined ? undefined : tree.readTexts([path])[0];
      },
      fileExists: (fileName) => (tracked(fileName) === undefined ? undefined : true),
      directoryExists: (name) => {
        const folder = listed(repoRelative(name));
        return folder === undefined ? undefined : folders.has(folder);
      },
      getAccessibleEntries: (name) => {
        const folder = listed(repoRelative(name));
        return folder === undefined ? undefined : folders.get(folder) ?? { files: [], directories: [] };
      },
    },
  });
  const governed = new Set(tree.sources.map((file) => file.path.toLowerCase()));
  const programs = new Map<string, TypedProgram>();
  const open: string[] = [];
  let snapshot: Snapshot | undefined;

  const programFor = (tsconfig: string): TypedProgram => {
    const memo = programs.get(tsconfig);
    if (memo) return memo;
    const absolute = resolve(root, tsconfig);
    if (!open.includes(absolute)) {
      open.push(absolute);
      snapshot = api.updateSnapshot({ openProjects: open });
    }
    const project = snapshot?.getProject(absolute);
    if (!project) throw new Error(`TypeScript loaded no project from ${tsconfig}, so no type check could read its files`);
    const { program, checker } = project;
    const facts = new Map<number, readonly IndexInfo[]>();
    // A declaration handle's path is the compiler's canonical form, lowercased on a case-insensitive disk.
    const repoPath = (fileName: string) => (fileName.toLowerCase().startsWith(prefix.toLowerCase()) ? fileName.slice(prefix.length) : fileName).split(sep).join('/');
    const typed: TypedProgram = {
      program,
      checker,
      repoPath,
      sourceFile: (path) => program.getSourceFile(resolve(root, path)),
      indexSignatures: (type) => {
        let infos = facts.get(type.id);
        if (!infos) facts.set(type.id, (infos = checker.getIndexInfosOfType(type)));
        return infos;
      },
      declaredInTree: (node) => {
        const named = node as { typeName?: Node; exprName?: Node; name?: Node };
        const name = named.typeName ?? named.exprName ?? named.name;
        // An imported name's own symbol is the import, declared in the importing file: follow it to the definition.
        const symbol = name ? checker.getSymbolAtLocation(name) : undefined;
        const target = symbol && symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        const declarations = target?.declarations ?? [];
        return declarations.length > 0 && declarations.every((handle) => governed.has(repoPath(handle.path).toLowerCase()));
      },
    };
    programs.set(tsconfig, typed);
    return typed;
  };
  return { programFor, dispose: () => api.close() };
}
