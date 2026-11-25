// painting-layer-origin.ts: what generated a document's layers, for a problem on one of their keys to name. A generator
// (paintSubject) records each layer node it hands back; a check reads the record through the document, so a factory
// that puts those nodes in its layers carries their origin without passing anything along. The record is keyed by the
// node object itself: a factory that copies a node (`{ ...layer }`) drops its origin.

import type { LayerNode, PaintingDocument } from './painting-document.ts';
import type { PaintingLayerOrigin, PaintingProblem } from './painting-problem.ts';

// A WeakMap so a recorded node is let go with its document; painting() keeps evaluations, and so their origins, alive.
const paintingLayerOrigins = new WeakMap<LayerNode, PaintingLayerOrigin>();

/** Records `origin` for each of `layers`, as a generator hands them back. A node recorded twice keeps the later origin. */
export function recordPaintingLayerOrigin(layers: readonly LayerNode[], origin: PaintingLayerOrigin): void {
  for (const layer of layers) paintingLayerOrigins.set(layer, origin);
}

/** Every key under `node` (its own, its children's, washes' and keyed applications'), each with `origin`. */
function collectKeyOrigins(node: LayerNode, inherited: PaintingLayerOrigin | undefined, into: Map<string, PaintingLayerOrigin>): void {
  const origin = paintingLayerOrigins.get(node) ?? inherited;
  if (origin) into.set(node.key, origin);
  if (node.children) {
    for (const child of node.children) collectKeyOrigins(child, origin, into);
    return;
  }
  if (!origin) return;
  for (const wash of node.washes) {
    into.set(wash.key, origin);
    for (const { key } of wash.applications) if (key !== undefined) into.set(key, origin);
  }
}

/**
 * `problems` with the origin of the layer each one's owner sits in, where a generator recorded one; an unkeyed
 * application (`<wash>.applications[i]`) takes its wash's.
 */
export function paintingProblemsWithOrigins(document: PaintingDocument, problems: readonly PaintingProblem[]): readonly PaintingProblem[] {
  if (problems.length === 0) return problems;
  const origins = new Map<string, PaintingLayerOrigin>();
  for (const layer of document.layers) collectKeyOrigins(layer, undefined, origins);
  if (origins.size === 0) return problems;
  return problems.map((problem) => {
    const origin = origins.get(problem.owner.replace(/\.applications\[\d+\]$/, ''));
    return origin ? { ...problem, origin } : problem;
  });
}
