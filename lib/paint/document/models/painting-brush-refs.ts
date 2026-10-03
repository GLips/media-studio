// painting-brush-refs.ts: every brush a document's layers paint or mask with, each once: what a still's page needs
// resolved from the styles before it compiles the document.

import type { AnyApplication, BrushRef, Footprint } from './painting-document.ts';
import type { PaintingTree } from './painting-tree.ts';

/** Each brush `tree`'s layers name, by application, reserve or resist, each once. */
export function paintingBrushRefs(tree: PaintingTree): BrushRef[] {
  const refs = new Map<string, BrushRef>();
  const add = (ref: BrushRef) => refs.set(`${ref.style}/${ref.brush}`, ref);
  const marked = (footprints: readonly Footprint[] | undefined) => {
    for (const footprint of footprints ?? []) if (footprint.kind !== 'region') add(footprint.brush);
  };
  for (const { node } of tree.layers) {
    for (const wash of node.washes) {
      marked(wash.prewet?.reserves);
      const applications: readonly AnyApplication[] = wash.applications;
      for (const application of applications) {
        add(application.brush);
        marked(application.reserves);
        for (const resist of application.resists ?? []) marked(resist.footprints);
      }
    }
  }
  return [...refs.values()];
}
