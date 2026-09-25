// ─── What every structural check is handed ────────────────────────────
//
// One snapshot, parsed once, with each file classified and each import resolved
// to its canonical target. Checks read edges from here and never resolve a
// specifier themselves, so an alias and a relative spelling can't reach two
// verdicts.

import { classifyStudioPath, type DeclaredShared, type StudioPosition } from '../policy/studio-tree.ts';
import { DECLARED_SHARED_MODULES } from '../policy/declared-shared.ts';
import { loadSourceTree, type CandidateSnapshot, type ImportTarget, type ScannedImport, type SourceFile, type SourceTree } from './source-tree.ts';

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

export type StructuralCheck = { id: string; run: (context: CheckContext) => Finding[] };

export type ImportEdge = { from: SourceFile; scanned: ScannedImport; target: ImportTarget; line: number };

export type CheckContext = {
  tree: SourceTree;
  positionOf: (path: string) => StudioPosition;
  /** Every import edge of a governed file, in source order. */
  edgesFrom: (file: SourceFile) => readonly ImportEdge[];
  fileAt: (path: string) => SourceFile | undefined;
  /**
   * Where an exported name is defined, following named re-exports, `export *` and `import … export { … }` to the
   * module that declares it. Several origins when star exports collide; none when nothing in the snapshot defines it.
   */
  originsOf: (path: string, name: string) => readonly { path: string; name: string }[];
};

/** Paths the tree governs: everything declared, except generated output and what §4 leaves ungoverned. */
export function studioScope(path: string): 'governed' | 'exempt' | 'undeclared' {
  const position = classifyStudioPath(path);
  if (position.kind === 'undeclared') return 'undeclared';
  if (position.kind === 'ungoverned' || position.kind === 'lint') return 'exempt';
  if (position.kind === 'project' && position.role === 'generated') return 'exempt';
  return 'governed';
}

export function createCheckContext(root: string, snapshot: CandidateSnapshot): CheckContext {
  return contextFor(loadSourceTree({ root, snapshot, scope: studioScope }));
}

export function contextFor(tree: SourceTree, declaredShared: DeclaredShared = DECLARED_SHARED_MODULES): CheckContext {
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
      if (!declared.from || declared.from.imported === '*') return [{ path, name }];
      const next = moduleTarget(path, declared.from.specifier);
      return next ? originsOf(next, declared.from.imported, seen) : [];
    }
    if (name === 'default') return [];
    return file.starExports.flatMap((star) => {
      const next = moduleTarget(path, star.specifier);
      return next ? originsOf(next, name, seen) : [];
    });
  };
  return {
    tree,
    positionOf: (path) => classifyStudioPath(path, declaredShared),
    edgesFrom,
    fileAt: (path) => byPath.get(path),
    originsOf: (path, name) => originsOf(path, name),
  };
}
