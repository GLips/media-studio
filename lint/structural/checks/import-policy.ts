// ─── Import policy: the §2 denials no studio check owns ───────────────
//
// No project imports another; entering a lib feature from outside uses
// `#lib/*`; `studio` reaches `engine` only from a spec, which is never bundled;
// lib/ never imports the web app; nothing climbs out of the repo; nothing
// outside work/ imports into it, since a clean clone has none. A project
// imports only the styles its project.ts names, so the bundle knows whose
// assets to check; a style never imports a project or engine code.
//
// A computed `import(expr)` isn't reported: the CLI loads projects that way.
//
// Negative space: a project may still import any of lib by `#lib/*`; §2's
// narrower allowed side isn't held yet.

import {
  libFeatureCrossedTo, STUDIO_WORKSPACE_MOUNT, WEB_ENGINE_DOOR, WEB_FEATURE_LAYERS, type StudioPosition, type WebPlace,
} from '../../policy/studio-tree.ts';
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
        if (isWeb(from)) for (const problem of webEdgeProblems(from, to, file.path)) report(problem);
        if (LIB_KINDS.has(from.kind) && (to.kind === 'web-client' || to.kind === 'web-server')) report('lib/ is the studio the web app is built on; it never imports web/');
      }
    }
    return findings;
  },
};

type WebPosition = Extract<StudioPosition, { kind: 'web-client' | 'web-server' }>;
const isWeb = (position: StudioPosition): position is WebPosition => position.kind === 'web-client' || position.kind === 'web-server';

/**
 * The places each web place never imports, and why. One reason per importer: it's what the importer is for that
 * rules the edge out. Unlisted edges are open, the app's own layers to lib's and to packages included.
 */
const WEB_PLACE_DENIALS: Record<WebPlace['place'], { denies: readonly WebPlace['place'][]; why: string }> = {
  route: { denies: ['entry', 'generated'], why: 'the entries and the route tree mount the routes, so the edge is a cycle' },
  feature: { denies: ['route', 'entry', 'generated'], why: 'routes mount a feature, and one that knows none of them works under any' },
  shared: {
    denies: ['feature', 'route', 'infrastructure', 'shared-ui', 'entry', 'generated'],
    why: 'everything imports shared/, so it imports none of the app back, and has no screen',
  },
  'shared-ui': {
    denies: ['feature', 'route', 'infrastructure', 'entry', 'generated'],
    why: 'every screen is written in these primitives, so they know no feature, route or adapter',
  },
  infrastructure: {
    denies: ['feature', 'route', 'shared-ui', 'entry', 'generated'],
    why: 'an adapter serves the places above it and consumes none of them; it has no screen',
  },
  entry: { denies: ['feature'], why: 'the entries wire the app and reach features only through the generated route tree' },
  generated: { denies: [], why: '' },
};

/** What's wrong with one import from a web file, by both ends' positions, so every spelling of the edge is judged alike. */
function webEdgeProblems(from: WebPosition, to: StudioPosition, fromPath: string): string[] {
  const problems: string[] = [];
  const ownFeature = from.place === 'feature' && isWeb(to) && to.place === 'feature' && to.feature === from.feature;
  if (to.kind === 'engine' && fromPath !== WEB_ENGINE_DOOR) {
    problems.push(`reaches engine code, which only ${WEB_ENGINE_DOOR} imports; call what it exports, from a server function`);
  }
  if (from.place === 'feature' && from.layer === 'barrel' && !ownFeature) {
    problems.push(`feature ${from.feature}'s barrel announces its own modules only; what they need, they import themselves`);
  }
  if (!isWeb(to)) return problems;
  const denial = WEB_PLACE_DENIALS[from.place];
  if (denial.denies.includes(to.place)) problems.push(`${from.place} imports ${to.place}: ${denial.why}`);
  // Controllers hold the app's server functions, whose bodies Start's compiler strips from the browser build;
  // barrel-purity holds what a barrel's chain may carry past them.
  if (from.kind === 'web-client' && to.kind === 'web-server' && !(from.place === 'feature' && from.layer === 'controllers')) {
    problems.push('imports a .server module, which may put server code in a browser chunk; only a feature\'s controllers reach one');
  }
  if (from.place === 'feature' && from.layer === 'controllers' && to.place === 'shared-ui') {
    problems.push('controllers fetch and validate; a UI primitive is the ui layer\'s to use');
  }
  if (to.place !== 'feature') return problems;
  if (!ownFeature && to.layer !== 'barrel') problems.push(`reaches past feature ${to.feature}'s barrel; import what its index.ts exports`);
  if (!ownFeature || from.place !== 'feature' || from.layer === 'barrel') return problems;
  if (to.layer === 'barrel') problems.push('imports its own feature\'s barrel, which re-exports it back: import the module itself');
  else if (WEB_FEATURE_LAYERS.indexOf(to.layer) < WEB_FEATURE_LAYERS.indexOf(from.layer)) {
    problems.push(`${from.layer} imports ${to.layer}, a layer above it; a layer imports only down ${WEB_FEATURE_LAYERS.join(' → ')}`);
  }
  return problems;
}
