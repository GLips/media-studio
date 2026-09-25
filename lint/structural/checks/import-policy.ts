// ─── Import policy: the §2 denials no studio check owns ───────────────
//
// A project never imports another project; lib/studio never reaches lib/engine;
// a `#` alias names a key package.json's `imports` has; no import climbs out of
// the repo. Scene, model and scratch denials are checks (b), (c) and (d).
//
// Negative space: the allowed side of §2's graph (a project's picture reaching
// only `#studio`, `#models/*` and its own files) isn't held yet. Today every
// project imports lib/studio's files directly, and the lib split slices move
// them; each slice's exit tightens this table.

import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'import-policy';

export const importPolicyCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = [];
    for (const file of context.tree.sources) {
      const from = context.positionOf(file.path);
      for (const edge of context.edgesFrom(file)) {
        const report = (message: string) => findings.push({ check: ID, path: file.path, line: edge.line, key: edge.scanned.specifier, message });
        const target = edge.target;
        if (target.kind === 'unresolved-alias') {
          report(`${target.specifier} matches no key in package.json's imports`);
          continue;
        }
        if (target.kind !== 'module') continue;
        if (target.path.startsWith('..')) {
          report('imports from outside the repo');
          continue;
        }
        const to = context.positionOf(target.path);
        if (from.kind === 'project' && to.kind === 'project' && to.project !== from.project) {
          report(`project ${from.project} imports project ${to.project}; shared code belongs in lib/ or brands/`);
        }
        if (from.kind === 'studio' && to.kind === 'engine') report('lib/studio renders in the browser; lib/engine is Node');
      }
    }
    return findings;
  },
};
