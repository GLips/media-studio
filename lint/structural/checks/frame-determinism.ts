// ─── Frame determinism ────────────────────────────────────────────────
//
// A frame is a function of its time, so code that can reach pixels reads no ambient randomness or clock:
// `Math.random`, `crypto.getRandomValues` and `randomUUID`, `Date.now`, a bare `new Date()` or `Date()`,
// `performance.now` or `timeOrigin`, `process.hrtime`, however reached (through `globalThis`, destructured, an alias
// of `Math`). Seed randomness with
// lib/picture/motion/models/random.ts; take time from the scene.
//
// Held: lib's `models` and `studio` code, private styles, and a project's scenes, helpers, models, shared modules,
// timeline, video, stills and brand. Not held: `engine` code, which never draws, so profiling a render lives there;
// a project's capture, tools and review; specs; and FRAME_PROFILER, which times a frame's work from inside the page.

import type { StudioPosition } from '../../policy/studio-tree.ts';
import { walkAst, type AstNode } from '../source-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'frame-determinism';

/** Each ambient source by the object it hangs off, and what to use instead. */
const AMBIENT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  Math: { random: 'seed it: seededRandom or hashRandom' },
  crypto: { getRandomValues: 'seed it: seededRandom or hashRandom', randomUUID: 'use an ID the author writes' },
  Date: { now: "use the scene's time" },
  performance: { now: "use the scene's time; time a render from engine code", timeOrigin: "use the scene's time" },
  process: { hrtime: "use the scene's time; time a render from engine code" },
};
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);
/** Nodes that are only types, erased before anything runs: `ReturnType<typeof Date.now>` reads nothing. */
const TYPE_ONLY = new Set([
  'TSTypeAnnotation', 'TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'TSTypeQuery', 'TSTypeReference',
  'TSTypeParameterInstantiation', 'TSTypeParameterDeclaration', 'TSDeclareFunction', 'TSImportType',
]);

const PIXEL_PROJECT_ROLES = new Set(['scene', 'scene-helper', 'model', 'shared', 'timeline', 'video', 'stills', 'brand']);
const reachesPixels = (position: StudioPosition) =>
  position.kind === 'models' || position.kind === 'studio' || position.kind === 'style' || position.kind === 'brand-kit' ||
  (position.kind === 'project' && PIXEL_PROJECT_ROLES.has(position.role));
const isSpec = (path: string) => /\.test\.tsx?$/.test(path);
/**
 * Mounted (by Video.tsx) only in a `studio profile` render, and logs its times rather than drawing them. Drawing code
 * reaches it through frame-profile.ts's context, which reads no clock.
 */
const FRAME_PROFILER = 'lib/output/render/studio/frame-profiler.tsx';

export const frameDeterminismCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      if (isSpec(file.path) || file.path === FRAME_PROFILER || !reachesPixels(context.positionOf(file.path))) continue;
      for (const { construct, instead, offset } of ambientReadsIn(file.program)) {
        findings.push({
          check: ID, path: file.path, line: file.lineOf(offset), key: construct,
          message: `${construct} makes a frame depend on more than its time: ${instead}`,
        });
      }
    }
    return findings;
  },
};

/** `Math`, `globalThis.Math`, `window['Math']`: the global an expression names, or undefined. */
function globalNamed(node: AstNode): string | undefined {
  if (node.type === 'Identifier') return node.name as string;
  if (node.type !== 'MemberExpression') return undefined;
  const object = node.object as AstNode;
  if (object.type !== 'Identifier' || !GLOBAL_OBJECTS.has(object.name as string)) return undefined;
  return propertyName(node);
}

function propertyName(member: AstNode): string | undefined {
  const property = member.property as AstNode;
  if (!member.computed) return property.name as string;
  return property.type === 'Literal' && typeof property.value === 'string' ? property.value : undefined;
}

/**
 * By name, not by scope, as model purity reads globals: nothing that draws names a local `Math` or `Date`, so a
 * shadowing one is reported rather than trusted.
 */
function ambientReadsIn(program: unknown): { construct: string; instead: string; offset: number }[] {
  const found: { construct: string; instead: string; offset: number }[] = [];
  walkAst(program, (node) => {
    if (TYPE_ONLY.has(node.type)) return false;
    if (node.type === 'MemberExpression') {
      const owner = globalNamed(node.object as AstNode), name = propertyName(node);
      const instead = owner !== undefined && name !== undefined ? AMBIENT[owner]?.[name] : undefined;
      if (instead) found.push({ construct: `${owner}.${name}`, instead, offset: node.start });
    }
    // const M = Math, whose M.random() this check can't follow.
    if (node.type === 'VariableDeclarator' && node.init && (node.id as AstNode).type === 'Identifier') {
      const owner = globalNamed(node.init as AstNode);
      if (owner !== undefined && owner !== 'Date' && AMBIENT[owner]) {
        found.push({ construct: `${owner} aliased`, instead: `name ${owner}'s members where they're used, so each read is checked`, offset: node.start });
      }
    }
    // const { random } = Math
    if (node.type === 'VariableDeclarator' && (node.id as AstNode).type === 'ObjectPattern' && node.init) {
      const owner = globalNamed(node.init as AstNode);
      for (const property of ((node.id as AstNode).properties as AstNode[])) {
        const key = property.key as AstNode | undefined;
        const name = key?.type === 'Identifier' ? key.name as string : key?.type === 'Literal' ? String(key.value) : undefined;
        const instead = owner !== undefined && name !== undefined ? AMBIENT[owner]?.[name] : undefined;
        if (instead) found.push({ construct: `${owner}.${name}`, instead, offset: property.start });
      }
    }
    // new Date() and Date(), both now; new Date(x) reads x.
    if ((node.type === 'NewExpression' || node.type === 'CallExpression') && globalNamed(node.callee as AstNode) === 'Date') {
      const call = node.type === 'NewExpression' ? 'new Date()' : 'Date()';
      if (node.type === 'CallExpression' || !(node.arguments as unknown[]).length) found.push({ construct: call, instead: "use the scene's time", offset: node.start });
    }
  });
  return found;
}
