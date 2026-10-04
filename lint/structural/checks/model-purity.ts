// ─── (c) Model purity ─────────────────────────────────────────────────
//
// A model (a lib feature's `models/`, a project's `x-model.ts`, its painting sources and its
// `timeline.ts`) loads in plain Node with no browser or I/O code behind it. From each model,
// every runtime import is followed transitively through first-party code, and a
// chain is refused where it reaches render or Node-side code (a feature's
// `studio/`, and `#studio`; its `engine/`; cli; harness; a scene), a package beyond the allowlist, a
// builtin, or a browser or I/O global: a name no scope of the file binds, or one read off globalThis.
//
// An `import type` is erased and isn't followed: flagging it would force types
// to be duplicated. Evaluator tests, importing it under `node --test`, hold that a model loads.

import type { StudioPosition } from '../../policy/studio-tree.ts';
import { childAt, childrenAt, isIdentifier, walkAst, type SourceFile } from '../source-tree.ts';
import type { CheckContext, Finding, ImportEdge, StructuralCheck } from '../check-context.ts';
import { globalNamed, globalReferencesIn } from '../lexical-scope.ts';

const ID = 'model-purity';

/**
 * The only packages a model may import, by name: three's math classes and Remotion's pure easing. Anything else from
 * either package pulls in its renderer.
 */
export const MODEL_PACKAGE_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  three: ['Vector3', 'Matrix4', 'Quaternion', 'Euler', 'MathUtils'],
  remotion: ['interpolate', 'Easing', 'spring'],
};

/** Globals that mean a browser or I/O. `fetch` and `process` exist in Node, and are I/O all the same. */
const IMPURE_GLOBALS = new Set([
  'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'requestAnimationFrame',
  'cancelAnimationFrame', 'getComputedStyle', 'HTMLElement', 'HTMLCanvasElement', 'Image', 'OffscreenCanvas',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'process',
]);
/** The global object's names, a member of which (`globalThis.fetch`) is the global itself. */
const GLOBAL_OBJECTS = new Set(['globalThis', 'self']);

/** Positions a model may pass through: pure until shown otherwise, and scanned in turn. */
const isScannable = (position: StudioPosition) =>
  position.kind === 'models' ||
  (position.kind === 'project' && ['model', 'painting-source', 'timeline', 'shared', 'unclassified', 'media', 'sfx', 'brand'].includes(position.role));

const isModel = (position: StudioPosition) =>
  position.kind === 'models' || (position.kind === 'project' && ['model', 'painting-source', 'timeline'].includes(position.role));
/** A model's spec is its evaluator, run by `node --test`: it may use node:test and fixtures, and isn't loaded as a model. */
const isSpec = (path: string) => /\.test\.tsx?$/.test(path);

export const modelPurityCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      if (isSpec(file.path) || !isModel(context.positionOf(file.path))) continue;
      const reported = new Set<string>();
      const report = (first: ImportEdge | undefined, chain: readonly string[], offense: string, line: number) => {
        const key = first ? `${first.scanned.specifier} → ${offense}` : offense;
        if (reported.has(key)) return;
        reported.add(key);
        const via = chain.length > 1 ? ` (via ${chain.slice(1).join(' → ')})` : '';
        findings.push({ check: ID, path: file.path, line, key, message: `a model reaches ${offense}${via}` });
      };
      const seen = new Set<string>([file.path]);
      const visit = (current: SourceFile, chain: readonly string[], first: ImportEdge | undefined) => {
        for (const global of impureGlobalsIn(current)) {
          report(first, chain, `the global ${global.name}`, first ? first.line : current.lineOf(global.offset));
        }
        for (const edge of context.edgesFrom(current)) {
          if (edge.scanned.typeOnly) continue;
          const head = first ?? edge;
          const offense = offenseOf(context, edge);
          if (offense) {
            report(head, chain, offense, head.line);
            continue;
          }
          if (edge.target.kind !== 'module' || seen.has(edge.target.path)) continue;
          seen.add(edge.target.path);
          const next = context.fileAt(edge.target.path);
          if (next) visit(next, [...chain, edge.target.path], head);
        }
      };
      visit(file, [file.path], undefined);
    }
    return findings;
  },
};

function offenseOf(context: CheckContext, edge: ImportEdge): string | undefined {
  const target = edge.target;
  if (target.kind === 'builtin') return `the builtin ${target.name}`;
  if (target.kind === 'unresolved-alias') return `the unresolved alias ${target.specifier}`;
  if (target.kind === 'outside') return `${target.specifier}, outside the repo`;
  if (target.kind === 'computed') return "a computed import(), whose module can't be read";
  if (target.kind === 'package') {
    const allowed = MODEL_PACKAGE_ALLOWLIST[target.name];
    if (!allowed) return `the package ${target.name}`;
    const extra = target.names === '*' ? ['*'] : target.names.filter((name) => !allowed.includes(name));
    return extra.length ? `${extra.join(', ')} from ${target.name}` : undefined;
  }
  const position = context.positionOf(target.path);
  if (!isScannable(position)) {
    const where = position.kind === 'project' ? `the project's ${position.role} code` : `${position.kind} code`;
    return `${where} (${target.path})`;
  }
  // A gitignored generated input (a capture index, a fitted track) holds data; anything else unbacked can't be read.
  if (!target.backed && !(position.kind === 'project' && position.role === 'media')) return `${target.path}, which isn't in the snapshot`;
  return undefined;
}

/**
 * Reads of an impure global (`document`, `globalThis.document`, `globalThis['fetch']`, `const { fetch } = globalThis`),
 * each resolved through the file's lexical scopes (lint/structural/lexical-scope.ts): a local, parameter or import of
 * the same name shadows the global, as a local `self` does `self.fetch`.
 */
function impureGlobalsIn(file: SourceFile): { name: string; offset: number }[] {
  const globals = globalReferencesIn(file.program);
  const found: { name: string; offset: number }[] = [];
  walkAst(file.program, (node) => {
    const init = childAt(node, 'init'), id = childAt(node, 'id');
    const offGlobalObject = isIdentifier(init) && globals.has(init) && GLOBAL_OBJECTS.has(init.name);
    if (node.type === 'VariableDeclarator' && offGlobalObject && id?.type === 'ObjectPattern') {
      for (const property of childrenAt(id, 'properties')) {
        const key = childAt(property, 'key');
        if (isIdentifier(key) && IMPURE_GLOBALS.has(key.name)) found.push({ name: key.name, offset: property.start });
      }
    }
    const named = globalNamed(node, globals, GLOBAL_OBJECTS);
    if (named && IMPURE_GLOBALS.has(named.name)) found.push({ name: named.name, offset: node.start });
  });
  return found;
}
