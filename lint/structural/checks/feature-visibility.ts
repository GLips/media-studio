// ─── An import between features needs the importee's grant ────────────
//
// An import from one feature into another of its tree (feature-edges.ts)
// needs a grant in the importee's `visibility.json`: `{ "<importer folder>":
// "<why>" }`, so a feature lists its dependants and a new one is an edit there.
// `lib/api.ts`, projects, cli/, harness/ and the web app consume lib rather than
// peer with it, so need no grant; what they may reach is import-policy's. Nor
// does a lib foundation (LIB_LAYERS), which keeps no grant file.
//
// One finding per ungranted pair, filed on the grant file and keyed by the
// importer. A grant outliving its last import is a finding: the coupling could
// return unreviewed.

import { libFoundationLayer } from '../../policy/studio-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';
import { crossFeatureEdges, studioFeatureOf } from './feature-edges.ts';

const ID = 'feature-visibility';
const GRANT_FILE = 'visibility.json';

type GrantFile = { kind: 'grants'; grants: ReadonlyMap<string, string> } | { kind: 'malformed'; reason: string };

export const featureVisibilityCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const features = new Set(context.tree.sources.flatMap((file) => studioFeatureOf(context.positionOf(file.path))?.folder ?? []));
    const grantPaths = [...context.tree.paths].filter((path) => path === GRANT_FILE || path.endsWith(`/${GRANT_FILE}`));
    const texts = context.tree.readTexts(grantPaths);
    const grantFiles = new Map(grantPaths.map((path, i) => [path.slice(0, -GRANT_FILE.length - 1), parseGrantFile(texts[i])]));
    const findings: Finding[] = [];

    for (const [folder, file] of grantFiles) {
      const path = `${folder}/${GRANT_FILE}`;
      if (isFoundation(folder)) {
        findings.push({ check: ID, path, line: 1, key: 'foundation', message: `${folder} is a foundation (LIB_LAYERS), which any feature imports without a grant: delete its ${GRANT_FILE}` });
      } else if (!features.has(folder)) {
        findings.push({ check: ID, path, line: 1, key: 'no-feature', message: `${folder} isn't a feature, so its ${GRANT_FILE} grants nothing: move it to the feature it's for, or delete it` });
      } else if (file.kind === 'malformed') {
        findings.push({ check: ID, path, line: 1, key: 'unreadable', message: `unreadable: ${file.reason}. Until it parses, no import of ${folder} is granted` });
      }
    }

    const used = new Set<string>();
    const reported = new Set<string>();
    for (const { importer, importee, sameTree, edge } of crossFeatureEdges(context)) {
      if (!sameTree || isFoundation(importee)) continue;
      used.add(`${importer}\0${importee}`);
      const file = grantFiles.get(importee);
      if (file?.kind === 'malformed') continue;
      if (file?.grants.has(importer)) continue;
      const pair = `${importer}\0${importee}`;
      if (reported.has(pair)) continue;
      reported.add(pair);
      findings.push({
        check: ID, path: `${importee}/${GRANT_FILE}`, line: 1, key: `missing:${importer}`,
        message: `${importer} imports ${importee} (first at ${edge.from.path}:${edge.line}), which doesn't grant it: add "${importer}" with the reason here, or move what both need into a feature of its own`,
      });
    }

    for (const [folder, file] of grantFiles) {
      if (file.kind !== 'grants' || !features.has(folder) || isFoundation(folder)) continue;
      for (const importer of file.grants.keys()) {
        if (used.has(`${importer}\0${folder}`)) continue;
        findings.push({
          check: ID, path: `${folder}/${GRANT_FILE}`, line: 1, key: `grant:${importer}`,
          message: features.has(importer)
            ? `grants ${importer}, which imports nothing from ${folder}: drop the entry, or the coupling can return unreviewed`
            : `grants ${importer}, which isn't a feature folder: name the importer as its folder (lib/<area>/<feature> or web/src/features/<f>)`,
        });
      }
    }
    return findings;
  },
};

const isFoundation = (folder: string) => folder.startsWith('lib/') && libFoundationLayer(folder.slice(4)) !== undefined;

function parseGrantFile(text: string): GrantFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { kind: 'malformed', reason: (error as Error).message };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'malformed', reason: 'must be an object of importer feature folder → reason' };
  }
  const grants = new Map<string, string>();
  for (const [importer, reason] of Object.entries(parsed)) {
    // A grant with no reason is one nobody had to think about: the file is refused rather than honoured.
    if (typeof reason !== 'string' || reason.trim() === '') return { kind: 'malformed', reason: `"${importer}" needs a reason` };
    grants.set(importer, reason);
  }
  return { kind: 'grants', grants };
}
