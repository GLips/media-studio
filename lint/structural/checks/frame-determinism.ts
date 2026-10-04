// ─── Frame determinism ────────────────────────────────────────────────
//
// A frame is a function of its time, so code that can reach pixels reads no ambient randomness or clock:
// `Math.random`, `crypto.getRandomValues` and `randomUUID`, `Date.now`, a bare `new Date()` or `Date()`,
// `performance.now` or `timeOrigin`, `process.hrtime`, however reached (through `globalThis`, destructured, an alias
// of `Math`). Seed randomness with
// lib/picture/motion/models/random.ts; take time from the scene.
//
// Held: lib's `models` and `studio` code, private styles, and a project's scenes, helpers, models, painting sources,
// shared modules, timeline, video, stills and brand. Not held: `engine` code, which never draws, so profiling a render
// lives there; a project's capture, tools and review; specs; and FRAME_PROFILER, which times a frame's work from
// inside the page.

import type { StudioPosition } from '../../policy/studio-tree.ts';
import { childAt, childrenAt, isIdentifier, memberName, walkAst, type AstNode } from '../source-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';
import { globalNamed, globalReferencesIn } from '../lexical-scope.ts';

const ID = 'frame-determinism';

/** Each ambient source by the object it hangs off, and what to use instead. */
const AMBIENT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  Math: { random: 'seed it: seededRandom or hashRandom' },
  crypto: { getRandomValues: 'seed it: seededRandom or hashRandom', randomUUID: 'use an ID the author writes' },
  Date: { now: "use the scene's time" },
  performance: { now: "use the scene's time; time a render from engine code", timeOrigin: "use the scene's time" },
  process: { hrtime: "use the scene's time; time a render from engine code" },
};
/** The global object's names, a member of which (`window.Math`) is the global itself. */
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);

const PIXEL_PROJECT_ROLES = new Set(['scene', 'scene-helper', 'model', 'painting-source', 'shared', 'timeline', 'video', 'stills', 'brand']);
const reachesPixels = (position: StudioPosition) =>
  position.kind === 'models' || position.kind === 'studio' || position.kind === 'style' || position.kind === 'brand-kit' ||
  (position.kind === 'project' && PIXEL_PROJECT_ROLES.has(position.role));
const isSpec = (path: string) => /\.test\.tsx?$/.test(path);
/**
 * Mounted (by Video.tsx) only in a `studio profile` render, and logs its times rather than drawing them. Drawing code
 * reaches it through frame-profile.ts's context, which reads no clock.
 */
const FRAME_PROFILER = 'lib/picture/profiling/studio/frame-profiler.tsx';

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

/**
 * Each ambient read, its global resolved by the file's lexical scopes (lint/structural/lexical-scope.ts): a local
 * `performance` (a timer handed in) or a parameter named `Math` is the local's, and a name inside a type reads nothing.
 */
function ambientReadsIn(program: AstNode): { construct: string; instead: string; offset: number }[] {
  const globals = globalReferencesIn(program);
  const ownerOf = (node: AstNode | undefined) => (node ? globalNamed(node, globals, GLOBAL_OBJECTS)?.name : undefined);
  const found: { construct: string; instead: string; offset: number }[] = [];
  walkAst(program, (node) => {
    if (node.type === 'MemberExpression') {
      const owner = ownerOf(childAt(node, 'object')), name = memberName(node);
      const instead = owner !== undefined && name !== undefined ? AMBIENT[owner]?.[name] : undefined;
      if (instead) found.push({ construct: `${owner}.${name}`, instead, offset: node.start });
    }
    const id = childAt(node, 'id'), owner = node.type === 'VariableDeclarator' ? ownerOf(childAt(node, 'init')) : undefined;
    // const M = Math, whose M.random() this check can't follow.
    if (isIdentifier(id) && owner !== undefined && owner !== 'Date' && AMBIENT[owner]) {
      found.push({ construct: `${owner} aliased`, instead: `name ${owner}'s members where they're used, so each read is checked`, offset: node.start });
    }
    // const { random } = Math
    if (id?.type === 'ObjectPattern' && owner !== undefined) {
      for (const property of childrenAt(id, 'properties')) {
        const key = childAt(property, 'key');
        const name = isIdentifier(key) ? key.name : key?.type === 'Literal' ? String(key.value) : undefined;
        const instead = name !== undefined ? AMBIENT[owner]?.[name] : undefined;
        if (instead) found.push({ construct: `${owner}.${name}`, instead, offset: property.start });
      }
    }
    // new Date() and Date(), both now; new Date(x) reads x.
    if ((node.type === 'NewExpression' || node.type === 'CallExpression') && ownerOf(childAt(node, 'callee')) === 'Date') {
      const call = node.type === 'NewExpression' ? 'new Date()' : 'Date()';
      if (node.type === 'CallExpression' || childrenAt(node, 'arguments').length === 0) found.push({ construct: call, instead: "use the scene's time", offset: node.start });
    }
  });
  return found;
}
