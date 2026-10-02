// ─── The studio's declared tree: where a repo path sits ───────────────
//
// The one answer to "what position is this file in", and the one alias
// expansion. Runtime-neutral (no Node APIs, AST types or tier imports), so both
// lint tiers hand it the same repo-relative string and reach one verdict.
//
// lib/ is `lib/<area>/<feature>/<role>/…`, the role giving the position.
// Anything else in lib/ but `lib/api.ts` is undeclared. Areas are declared in
// LIB_AREAS; a feature is any folder in one.
//
// work/ is its own repository, mounted in one path space. Only
// `work/projects/<p>/…`, `work/brands/<kit>/brand.ts` and `work/styles/<style>/…`
// (outside its imported `brushes/`) are positions there: `work/` is never
// stripped, so a `work/lib/x.ts` is undeclared, not lib.

export type ProjectRole =
  /** `project.ts` declares the project's capability (lib/platform/project/models/capability.ts). */
  | { role: 'timeline' | 'video' | 'stills' | 'brand' | 'capture' | 'project' }
  /** A spec beside a root module (`timeline.test.ts`): run by `node --test`, it may bind the whole project; nothing imports it. */
  | { role: 'spec' }
  /** `bars/<id>.tsx` or `scenes/<id>.tsx`: one scene per file. */
  | { role: 'scene'; scene: string }
  /** A file in `bars/<id>/` or `scenes/<id>/`: that scene's own helper. */
  | { role: 'scene-helper'; scene: string }
  /** A project-specific `x-model.ts`, in its scene's folder or beside its scene file. */
  | { role: 'model'; scene: string }
  /** Listed in its project.ts's `shared` (ProjectDeclaration): scenes may import it; it never imports back into one. */
  | { role: 'shared' }
  | { role: 'sfx' | 'tools' | 'review' }
  /** Ingested or recorded input the picture reads: captures, music, voice audio, fixtures, reference media. */
  | { role: 'media' }
  /** Generated modules and render output (`generated/`, `out/`), exempt from every check. */
  | { role: 'generated' }
  /** A project file no role names. A scene that reaches one fails scene ownership. */
  | { role: 'unclassified' };

export type StudioPosition =
  /** A file in a feature's role folder; `feature` is `<area>/<feature>`. */
  | { kind: LibRole; feature: string }
  /** `lib/api.ts`, the barrel projects import as `#studio`. It renders in the browser, as `studio` does. */
  | { kind: 'studio'; barrel: true }
  | { kind: 'cli' }
  /**
   * `harness/`: entry points for the brush-fidelity rigs (Photoshop captures, the fidelity sheet and
   * fit), run by node or npm rather than `studio`, which is for authoring. Wiring only, with cli's import rights.
   */
  | { kind: 'harness' }
  /**
   * The web app (web/src/). `web-server` is a `.server` module in web/src/infrastructure/, the app's door into
   * lib's engine code; everything else is `web-client`, since TanStack Start may put it in a browser chunk.
   */
  | ({ kind: 'web-server' | 'web-client' } & WebPlace)
  | { kind: 'brand-kit'; kit: string }
  /** A private stamp-paint style's source, `work/styles/<style>/` (docs/private-styles.md); a project names the ones it uses. */
  | { kind: 'style'; style: string }
  | ({ kind: 'project'; project: string } & ProjectRole)
  /** The checks themselves. Their fixtures name every violation on purpose. */
  | { kind: 'lint' }
  /** Tool config: `remotion.config.ts` at the root, `web/vite.config.ts` beside the app. */
  | { kind: 'root-config' }
  /** Deliberately ungoverned (§4): `scratch/`, `node_modules/`, `skills/`. */
  | { kind: 'ungoverned' }
  | { kind: 'undeclared' };

/**
 * Where a file sits in web/src/. A feature (`features/<f>/`) is reached from outside through its barrel
 * (`index.ts`) and holds layers, highest first in WEB_FEATURE_LAYERS: a layer imports only down the list.
 */
export type WebPlace =
  | { place: 'route' | 'shared' | 'shared-ui' | 'infrastructure' | 'entry' }
  /** `routeTree.gen.ts`, TanStack Router's generated route tree: exempt from every check. */
  | { place: 'generated' }
  | { place: 'feature'; feature: string; layer: WebFeatureLayer | 'barrel' };

export type WebFeatureLayer = 'ui' | 'controllers';
/** Highest first: `ui` renders what `controllers` fetch and validate, and never the reverse. */
export const WEB_FEATURE_LAYERS: readonly WebFeatureLayer[] = ['ui', 'controllers'];
const isWebFeatureLayer = (folder: string): folder is WebFeatureLayer => WEB_FEATURE_LAYERS.some((layer) => layer === folder);
const WEB_ENTRIES = new Set(['start.ts', 'router.tsx']);
/** A stylesheet at src/'s top (the app's global styles, which the root route links) is shared, like shared/. */
const STYLESHEET = /\.css$/;

/** The one web module that imports lib's engine code; the app reaches the engine only through what it exports. */
export const WEB_ENGINE_DOOR = 'web/src/infrastructure/studio-engine.server.ts';
/** The web app's StyleX token source: its scales are what every other module names instead of a raw value. */
export const WEB_THEME_MODULE = 'web/src/shared/ui/theme.stylex.ts';
/** Every shadow the web app draws, by name: the one module allowed to write one. */
export const WEB_SHADOW_MODULE = 'web/src/shared/ui/shadows.ts';

export type LibRole = 'models' | 'studio' | 'engine';
const LIB_ROLES: readonly LibRole[] = ['models', 'studio', 'engine'];
const isLibRole = (folder: string): folder is LibRole => LIB_ROLES.some((role) => role === folder);
/** lib/'s areas, each a group of features. A new area is declared here, which keeps lib/'s top level a short list. */
export const LIB_AREAS: readonly string[] = ['timing', 'picture', 'paint', 'footage', 'output', 'platform'];

/**
 * lib's foundations, in layers, lowest first. A foundation (`<area>/<feature>`) imports only foundations of its own
 * layer or one below, never a peer, and any feature imports a foundation without a grant. A feature listed nowhere is
 * a peer: importing it takes its grant (visibility.json). Areas group features by subject; this is their height.
 */
export type LibLayer = { name: string; features: readonly string[] };
export const LIB_LAYERS: readonly LibLayer[] = [
  {
    name: 'platform',
    features: [
      'platform/temp', 'platform/git', 'platform/zip', 'platform/wav', 'platform/ffmpeg', 'platform/raster', 'platform/paid-generation',
      'platform/photoshop', 'platform/project', 'platform/host', 'platform/web', 'platform/browser', 'platform/gpu',
    ],
  },
  { name: 'vocabulary', features: ['picture/frame', 'picture/motion', 'picture/type', 'picture/color', 'picture/shot-camera'] },
  { name: 'timing', features: ['timing/voice', 'timing/timeline', 'timing/sound', 'timing/music'] },
  // The camera keeps clear of the caption band a style reserves, so it stands on captions.
  { name: 'framing', features: ['picture/captions', 'picture/camera'] },
  { name: 'measurement', features: ['picture/measurement', 'picture/profiling'] },
  { name: 'authoring', features: ['picture/video', 'picture/stills'] },
];

/** The index in LIB_LAYERS of a foundation's layer, or undefined for a peer. `feature` is `<area>/<feature>`. */
export function libFoundationLayer(feature: string): number | undefined {
  const index = LIB_LAYERS.findIndex((layer) => layer.features.includes(feature));
  return index < 0 ? undefined : index;
}

const ROOT_ROLES: Record<string, 'timeline' | 'video' | 'stills' | 'brand' | 'capture' | 'project'> = {
  'timeline.ts': 'timeline', 'video.tsx': 'video', 'stills.tsx': 'stills', 'brand.ts': 'brand', 'capture.ts': 'capture', 'project.ts': 'project',
};
const SUBDIR_ROLES: Record<string, 'sfx' | 'tools' | 'review' | 'media' | 'generated'> = {
  sfx: 'sfx', tools: 'tools', review: 'review', generated: 'generated', out: 'generated',
  captures: 'media', music: 'media', audio: 'media', fixture: 'media', assets: 'media', refs: 'media',
};
const SCENE_DIRS = new Set(['bars', 'scenes']);
const SOURCE_FILE = /^(.+)\.(ts|tsx)$/;
const MODEL_FILE = /^(.+)-model\.ts$/;
const TOOL_CONFIG = /\.config\.[cm]?[jt]s$/;
const WEB_SERVER_MODULE = /^web\/src\/infrastructure\/.+\.server\.tsx?$/;

/**
 * Programs whose interface is the terminal, so a console call is their output, not a stray log: the CLI, the
 * harness, lint's own commands (check-arch.ts, lint.ts) and a project's tools. oxlint's no-console is off in them.
 */
export const TERMINAL_PROGRAM_GLOBS: readonly string[] = ['cli/**', 'harness/**', 'lint/*.ts', 'work/projects/*/tools/**'];

/**
 * Modules loaded by path for their default export, which is their contract: a CLI command (cli/studio.ts), a
 * project's declaration, capture, brand and sounds, a kit's brand, a style and its fidelity grades, Node's stand-in
 * for the `@stamp-paint-styles` module, and lint's oxlint plugin. oxlint's no-default-export is off in them.
 */
export const DEFAULT_EXPORT_MODULE_GLOBS: readonly string[] = [
  'cli/commands/*.ts', 'lint/oxlint/plugin.ts', 'lib/paint/style/engine/node-stamp-paint-styles.ts',
  'work/projects/*/project.ts', 'work/projects/*/capture.ts', 'work/projects/*/brand.ts', 'work/projects/*/sfx/*.ts',
  'work/brands/*/brand.ts', 'work/styles/*/style.ts', 'work/styles/*/fidelity.ts',
];

/** Where the workspace repository is mounted in check:arch's one path space: the folder it is in the checkout. */
export const STUDIO_WORKSPACE_MOUNT = 'work';

/**
 * Project directory name → paths inside the project that are declared shared modules, as each project.ts's `shared`
 * lists them (check-context.ts reads them off the snapshot).
 */
export type DeclaredShared = Readonly<Record<string, readonly string[]>>;

/** The position of a `/`-separated path in check:arch's path space: the studio's own, and the workspace's under `work/`. */
export function classifyStudioPath(path: string, shared: DeclaredShared): StudioPosition {
  const parts = path.split('/');
  const [top, second] = parts;
  if (top === 'scratch' || top === 'node_modules' || top === 'skills') return { kind: 'ungoverned' };
  if (top === 'lint') return { kind: 'lint' };
  if (parts.length === 1) return TOOL_CONFIG.test(top) ? { kind: 'root-config' } : { kind: 'undeclared' };
  if (top === 'lib') {
    if (path === 'lib/api.ts') return { kind: 'studio', barrel: true };
    const [, area, feature, role] = parts;
    if (parts.length < 5 || !LIB_AREAS.includes(area) || !isLibRole(role)) return { kind: 'undeclared' };
    return { kind: role, feature: `${area}/${feature}` };
  }
  if (top === 'cli') return { kind: 'cli' };
  if (top === 'harness') return { kind: 'harness' };
  if (top === 'web') {
    if (parts.length === 2 && TOOL_CONFIG.test(second)) return { kind: 'root-config' };
    const place = second === 'src' ? webPlace(parts.slice(2)) : undefined;
    if (!place) return { kind: 'undeclared' };
    return { kind: WEB_SERVER_MODULE.test(path) ? 'web-server' : 'web-client', ...place };
  }
  if (top === STUDIO_WORKSPACE_MOUNT) {
    const [, , name, ...inside] = parts;
    if (second === 'brands' && inside.length === 1 && inside[0] === 'brand.ts') return { kind: 'brand-kit', kit: name };
    if (second === 'styles' && inside.length && inside[0] !== 'brushes') return { kind: 'style', style: name };
    if (second === 'projects' && inside.length) return { kind: 'project', project: name, ...projectRole(inside, shared[name] ?? []) };
  }
  return { kind: 'undeclared' };
}

/** A web/src/ path's place, from inside src/; undefined when no place names it. */
function webPlace(inside: string[]): WebPlace | undefined {
  const [first, second, third] = inside;
  if (inside.length === 1) {
    if (first === 'routeTree.gen.ts') return { place: 'generated' };
    if (STYLESHEET.test(first)) return { place: 'shared' };
    return WEB_ENTRIES.has(first) ? { place: 'entry' } : undefined;
  }
  if (first === 'routes') return { place: 'route' };
  if (first === 'infrastructure') return { place: 'infrastructure' };
  if (first === 'shared') return second === 'ui' && inside.length > 2 ? { place: 'shared-ui' } : { place: 'shared' };
  if (first !== 'features' || inside.length < 3) return undefined;
  if (inside.length === 3) return third === 'index.ts' ? { place: 'feature', feature: second, layer: 'barrel' } : undefined;
  return isWebFeatureLayer(third) ? { place: 'feature', feature: second, layer: third } : undefined;
}

function projectRole(inside: string[], shared: readonly string[]): ProjectRole {
  const [first, second] = inside;
  if (inside.length === 1) {
    if (ROOT_ROLES[first]) return { role: ROOT_ROLES[first] };
    const spec = /^(.+)\.test\.tsx?$/.exec(first);
    if (spec && Object.keys(ROOT_ROLES).some((root) => root.replace(/\.tsx?$/, '') === spec[1])) return { role: 'spec' };
    return shared.includes(first) ? { role: 'shared' } : { role: 'unclassified' };
  }
  if (SCENE_DIRS.has(first)) {
    if (inside.length > 2) {
      const model = MODEL_FILE.exec(inside.at(-1)!);
      return model ? { role: 'model', scene: second } : { role: 'scene-helper', scene: second };
    }
    const model = MODEL_FILE.exec(second);
    if (model) return { role: 'model', scene: model[1] };
    const scene = SOURCE_FILE.exec(second);
    return scene ? { role: 'scene', scene: scene[1] } : { role: 'unclassified' };
  }
  const role = SUBDIR_ROLES[first];
  if (role) return { role };
  return shared.includes(inside.join('/')) ? { role: 'shared' } : { role: 'unclassified' };
}

/**
 * Expands a `#…` subpath import through package.json's `imports`, by Node's rule: an exact key first, then the `*`
 * pattern with the longest prefix. The result is repo-relative with `./` and `..` resolved, so `#studio` and
 * `../../lib/api.ts` compare equal before any ownership check reads them.
 */
export function expandStudioAlias(specifier: string, imports: Readonly<Record<string, string>>): string | undefined {
  let target = imports[specifier];
  if (target === undefined) {
    let best: { prefix: string; suffix: string; target: string } | undefined;
    for (const [key, value] of Object.entries(imports)) {
      const star = key.indexOf('*');
      if (star < 0) continue;
      const prefix = key.slice(0, star), suffix = key.slice(star + 1);
      if (specifier.length < prefix.length + suffix.length || !specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
      if (!best || prefix.length > best.prefix.length) best = { prefix, suffix, target: value };
    }
    if (!best) return undefined;
    target = best.target.replaceAll('*', specifier.slice(best.prefix.length, specifier.length - best.suffix.length));
  }
  return normalizeRepoPath(target);
}

/** `a/./b/../c` → `a/c`, without Node's path module. A path that climbs above the root keeps its leading `..`. */
export function normalizeRepoPath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..' && out.length && out.at(-1) !== '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

/**
 * The `lib/<area>/<feature>`, or the barrel `lib/api.ts`, that a relative import from `fromPath` climbs into, or
 * undefined when it stays in its own feature. Such an import must use `#lib/*` (or `#studio`): an alias survives a
 * move on either end. The barrel is a unit of its own, reaching and reached by alias.
 */
export function libFeatureCrossedTo(fromPath: string, targetPath: string): string | undefined {
  const feature = (path: string) => {
    if (path === 'lib/api.ts') return path;
    const parts = path.split('/');
    return parts[0] === 'lib' && parts.length >= 4 ? parts.slice(0, 3).join('/') : undefined;
  };
  const to = feature(targetPath);
  return to !== undefined && to !== feature(fromPath) ? to : undefined;
}

/**
 * The inverse of expandStudioAlias: the `#` spelling of a repo path, an exact key first, then the `*` pattern with the
 * longest prefix. Undefined when no key covers the path.
 */
export function aliasForRepoPath(path: string, imports: Readonly<Record<string, string>>): string | undefined {
  let best: { prefix: string; key: string } | undefined;
  for (const [key, value] of Object.entries(imports)) {
    const target = normalizeRepoPath(value);
    if (target === path) return key;
    const star = target.indexOf('*');
    if (star < 0 || target.slice(star + 1) !== '') continue;
    const prefix = target.slice(0, star);
    if (path.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) best = { prefix, key };
  }
  return best && best.key.replace('*', path.slice(best.prefix.length));
}
