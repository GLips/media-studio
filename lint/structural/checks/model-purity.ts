// ─── (c) Model purity ─────────────────────────────────────────────────
//
// A model (`lib/models/**`, a project's `x-model.ts`, and its `timeline.ts`)
// loads in plain Node with no browser or I/O code behind it. From each model,
// every runtime import is followed transitively through first-party code, and a
// chain is refused where it reaches render or Node-side code (lib/studio, which
// `#studio` is; lib/engine; cli; lab; a scene), a package beyond the allowlist, a
// builtin, or a browser or I/O global.
//
// An `import type` is erased and isn't followed: flagging it would force types
// to be duplicated. That a model actually loads is held by its evaluator tests,
// which import it under `node --test`.

import type { StudioPosition } from '../../policy/studio-tree.ts';
import { walkAst, type AstNode, type SourceFile } from '../source-tree.ts';
import type { CheckContext, Finding, ImportEdge, StructuralCheck } from '../check-context.ts';

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
const GLOBAL_OBJECTS = new Set(['globalThis', 'self']);

/** Positions a model may pass through: pure until shown otherwise, and scanned in turn. */
const isScannable = (position: StudioPosition) =>
  position.kind === 'models' || position.kind === 'lib-unsplit' ||
  (position.kind === 'project' && ['model', 'timeline', 'shared', 'unclassified', 'media', 'sfx', 'brand'].includes(position.role));

const isModel = (position: StudioPosition) =>
  position.kind === 'models' || (position.kind === 'project' && (position.role === 'model' || position.role === 'timeline'));

export const modelPurityCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      if (!isModel(context.positionOf(file.path))) continue;
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

/** References to an impure global not declared in the file: `document`, `globalThis.document`. */
function impureGlobalsIn(file: SourceFile): { name: string; offset: number }[] {
  const declared = new Set<string>();
  const collect = (node: unknown) => walkAst(node, (inner) => {
    if (inner.type === 'Identifier') declared.add(inner.name as string);
  });
  walkAst(file.program, (node) => {
    if (node.type === 'VariableDeclarator') collect(node.id);
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      collect(node.id);
      collect(node.params);
    }
    if (node.type === 'ClassDeclaration') collect(node.id);
    if (node.type === 'CatchClause') collect(node.param);
  });
  for (const scanned of file.imports) for (const binding of scanned.bindings) declared.add(binding.local);

  const found: { name: string; offset: number }[] = [];
  walkAst(file.program, (node, parent) => {
    // Types are erased: `el: HTMLElement` loads nothing.
    if (node.type.startsWith('TS') && !node.type.endsWith('Expression')) return false;
    if (node.type === 'MemberExpression' && !node.computed) {
      const object = node.object as AstNode, property = node.property as AstNode;
      if (object.type === 'Identifier' && GLOBAL_OBJECTS.has(object.name as string) && IMPURE_GLOBALS.has(property.name as string)) {
        found.push({ name: property.name as string, offset: node.start });
      }
    }
    if (node.type !== 'Identifier' || !IMPURE_GLOBALS.has(node.name as string) || declared.has(node.name as string)) return;
    if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
    if ((parent?.type === 'Property' || parent?.type === 'PropertyDefinition' || parent?.type === 'MethodDefinition') && parent.key === node && !parent.computed) return;
    found.push({ name: node.name as string, offset: node.start });
  });
  return found;
}
