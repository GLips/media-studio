// ─── Import policy: the §2 denials no studio check owns ───────────────
//
// A project never imports another project, and reaches lib/studio only through
// `#studio`; lib/studio never reaches lib/engine, except from a spec, which runs
// in Node and is never bundled; a `#` alias names a key package.json's `imports`
// has; no import climbs out of the repo. Scene, model and scratch denials are
// checks (b), (c) and (d).
//
// A computed `import(expr)` isn't reported here: lab and the CLI load projects
// that way. The checks that must follow every edge refuse it themselves.
//
// Negative space: the rest of §2's allowed side (a project's picture reaching
// only `#studio`, `#models/*` and its own files) isn't held yet: projects still
// import lib/models and lib/paint by relative path.

import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'import-policy';
const SPEC_FILE = /\.test\.tsx?$/;

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
        if (target.kind === 'outside') {
          report('imports from outside the repo');
          continue;
        }
        if (target.kind !== 'module') continue;
        const to = context.positionOf(target.path);
        if (from.kind === 'project' && to.kind === 'project' && to.project !== from.project) {
          report(`project ${from.project} imports project ${to.project}; shared code belongs in lib/ or brands/`);
        }
        if (from.kind === 'project' && to.kind === 'studio' && edge.scanned.specifier.startsWith('.')) {
          report('a project reaches lib/studio through #studio or #studio/*, never a relative path');
        }
        if (from.kind === 'studio' && to.kind === 'engine' && !SPEC_FILE.test(file.path)) report('lib/studio renders in the browser; lib/engine is Node');
      }
    }
    return findings;
  },
};
