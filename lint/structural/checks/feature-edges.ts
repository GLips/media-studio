// ─── Features and the imports between them ────────────────────────────
//
// For feature-visibility and feature-cycles. A feature is what studio-tree.ts
// classifies as one, a lib feature (`lib/<area>/<feature>/`) or a web feature
// (`web/src/features/<f>/`), named by its folder so a grant, a cycle and a
// grep spell it one way. Not features: `lib/api.ts`, projects, cli/, harness/
// and web outside features/; they consume features. A feature's tree (lib or
// web) is kept: a web feature consumes lib as cli does, not as a peer.
//
// Type-only imports count: a type crossing a boundary couples both ends.

import { HELD_OUT_UNTIL_VID_108_PATHS } from '../../policy/held-out.ts';
import type { StudioPosition } from '../../policy/studio-tree.ts';
import type { CheckContext, ImportEdge } from '../check-context.ts';

export type StudioFeature = { folder: string; tree: 'lib' | 'web' };

/** The feature a position is in, or undefined outside every feature. */
export function studioFeatureOf(position: StudioPosition): StudioFeature | undefined {
  if (position.kind === 'models' || position.kind === 'studio' || position.kind === 'engine') {
    return 'barrel' in position ? undefined : { folder: `lib/${position.feature}`, tree: 'lib' };
  }
  if ((position.kind === 'web-client' || position.kind === 'web-server') && position.place === 'feature') {
    return { folder: `web/src/features/${position.feature}`, tree: 'web' };
  }
  return undefined;
}

/** `importer` and `importee` are feature folders. */
export type CrossFeatureEdge = { importer: string; importee: string; sameTree: boolean; edge: ImportEdge };

/** Every import from a file in one feature into another feature, in source order per file. */
export function crossFeatureEdges(context: CheckContext): CrossFeatureEdge[] {
  const found: CrossFeatureEdge[] = [];
  for (const file of context.tree.sources) {
    const importer = studioFeatureOf(context.positionOf(file.path));
    if (!importer) continue;
    for (const edge of context.edgesFrom(file)) {
      if (edge.target.kind !== 'module') continue;
      const importee = studioFeatureOf(context.positionOf(edge.target.path));
      if (!importee || importee.folder === importer.folder) continue;
      // Either end held out: a feature vid-108 renames would rename the finding, and block its commit.
      if ([importer, importee].some((feature) => HELD_OUT_UNTIL_VID_108_PATHS.includes(`${feature.folder}/`))) continue;
      found.push({ importer: importer.folder, importee: importee.folder, sameTree: importer.tree === importee.tree, edge });
    }
  }
  return found;
}
