// ─── A foundation imports only downward ───────────────────────────────
//
// LIB_LAYERS (studio-tree.ts) names lib's foundations, layer by layer. A
// foundation may import a foundation of its own layer or a lower one; an
// import of a higher foundation or of a peer is a finding, one per pair,
// filed on the importer and keyed by the importee. That is what lets every
// feature import a foundation without a grant: nothing a foundation reaches can
// reach back. A cycle inside one layer is feature-cycles'.
//
// The declaration itself is checked too: a name no feature has, or one listed
// twice, would silently exempt or mislayer something.

import { LIB_LAYERS, libFoundationLayer } from '../../policy/studio-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';
import { crossFeatureEdges, studioFeatureOf } from './feature-edges.ts';

const ID = 'feature-layers';
const POLICY = 'lint/policy/studio-tree.ts';

export const featureLayersCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    const features = new Set(context.tree.sources.flatMap((file) => studioFeatureOf(context.positionOf(file.path))?.folder ?? []));
    const declared = new Set<string>();
    for (const { name, features: members } of LIB_LAYERS) {
      for (const feature of members) {
        if (declared.has(feature)) {
          findings.push({ check: ID, path: POLICY, line: 1, key: `duplicate:${feature}`, message: `LIB_LAYERS lists ${feature} twice (again in ${name}): a foundation has one layer` });
        } else if (!features.has(`lib/${feature}`)) {
          findings.push({ check: ID, path: POLICY, line: 1, key: `absent:${feature}`, message: `LIB_LAYERS' ${name} layer names ${feature}, which is no feature in lib/: drop it or fix the name` });
        }
        declared.add(feature);
      }
    }

    const reported = new Set<string>();
    for (const { importer, importee, sameTree, edge } of crossFeatureEdges(context)) {
      if (!sameTree || !importer.startsWith('lib/')) continue;
      const from = libFoundationLayer(importer.slice(4));
      if (from === undefined) continue;
      const to = libFoundationLayer(importee.slice(4));
      if (to !== undefined && to <= from) continue;
      if (reported.has(`${importer}\0${importee}`)) continue;
      reported.add(`${importer}\0${importee}`);
      const what = to === undefined ? 'a peer' : `a foundation of the higher ${LIB_LAYERS[to].name} layer`;
      findings.push({
        check: ID, path: importer, line: 1, key: `→ ${importee}`,
        message: `is a foundation of the ${LIB_LAYERS[from].name} layer, but imports ${importee}, ${what} (first at ${edge.from.path}:${edge.line}): move what it needs down, or invert the dependency`,
      });
    }
    return findings;
  },
};
