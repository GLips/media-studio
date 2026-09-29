// ─── Import policy: the §2 denials no studio check owns ───────────────
//
// A project never imports another project; an import into a lib feature
// (`lib/<area>/<feature>`) from outside it uses the `#lib/*` alias, never a
// relative path (lint/rewrite-lib-imports.ts rewrites them); `studio` code
// never reaches `engine` code, except from a spec, which runs in Node and is
// never bundled; the web app's client code never reaches `engine` code (only a `.server` module in
// web/src/infrastructure/ may), and nothing in lib/ imports the web app; a `#`
// alias names a key package.json's `imports` has; no import climbs out of the
// repo; nothing outside work/ imports into it, since work/ is your own
// repository and a clean clone has none, and that holds its private painting
// styles (work/styles/) out of public code. A project imports only the styles
// its project.ts's `styles` names, which is how the bundle knows whose assets to
// check; a style never imports a project, and, since it paints in the browser,
// never engine code. Scene, model and scratch denials are checks (b), (c) and (d).
//
// A computed `import(expr)` isn't reported here: the CLI loads projects
// that way. The checks that must follow every edge refuse it themselves.
//
// Negative space: the rest of §2's allowed side (a project's picture reaching
// only `#studio`, `models` code and its own files) isn't held yet: a project
// may still import any of lib by `#lib/*`, behind the barrel.

import { libFeatureCrossedTo, STUDIO_WORKSPACE_MOUNT, type StudioPosition } from '../../policy/studio-tree.ts';
import type { Finding, StructuralCheck } from '../check-context.ts';

const ID = 'import-policy';
const SPEC_FILE = /\.test\.tsx?$/;
const isInStudioWorkspace = (path: string) => path.startsWith(`${STUDIO_WORKSPACE_MOUNT}/`);
const LIB_KINDS = new Set<StudioPosition['kind']>(['models', 'studio', 'engine']);

export const importPolicyCheck: StructuralCheck = {
  id: ID,
  run(context) {
    const findings: Finding[] = context.styleDeclarationProblems.map((problem) => ({ check: ID, ...problem }));
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
        // Unbacked too: in public scope work/ isn't in the snapshot, and that's exactly when such an import breaks.
        if (!isInStudioWorkspace(file.path) && isInStudioWorkspace(target.path)) {
          report('reaches into work/, your own repository, which a clean clone of the studio doesn\'t have');
          continue;
        }
        const to = context.positionOf(target.path);
        if (from.kind === 'project' && to.kind === 'project' && to.project !== from.project) {
          report(`project ${from.project} imports project ${to.project}; shared code belongs in lib/ or a brand kit (work/brands/)`);
        }
        if (from.kind === 'project' && to.kind === 'style' && !(context.declaredStyles[from.project] ?? []).includes(to.style)) {
          report(`uses the style ${to.style}, which project ${from.project}'s project.ts doesn't name in \`styles\`, so the bundle won't check its brushes`);
        }
        if (from.kind === 'style' && to.kind === 'project') report(`style ${from.style} imports project ${to.project}; projects use a style, never the reverse`);
        if (from.kind === 'style' && to.kind === 'engine') report('a style paints in the browser; engine code is Node');
        const crossed = edge.scanned.specifier.startsWith('.') ? libFeatureCrossedTo(file.path, target.path) : undefined;
        if (crossed !== undefined) report(`reaches ${crossed} by a relative path; import it through ${crossed === 'lib/api.ts' ? '#studio' : '#lib/*'}`);
        if (from.kind === 'studio' && to.kind === 'engine' && !SPEC_FILE.test(file.path)) report('studio code renders in the browser; engine code is Node');
        if (from.kind === 'web-client' && to.kind === 'engine') {
          report('web client code may land in a browser chunk; reach engine code through web/src/infrastructure/studio-engine.server.ts');
        }
        if (LIB_KINDS.has(from.kind) && (to.kind === 'web-client' || to.kind === 'web-server')) report('lib/ is the studio the web app is built on; it never imports web/');
      }
    }
    return findings;
  },
};
