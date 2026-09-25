// ─── The studio's declared tree: where a repo path sits ───────────────
//
// The one answer to "what position is this file in" (plan §4), and the one
// alias expansion. Runtime-neutral: no Node APIs, no AST types, no import from
// either tier, so the structural checks and a later oxlint tier hand it the same
// repo-relative string and reach one verdict.
//
// `lib-unsplit` holds today's `lib/*.ts`, `lib/sfx` and `lib/paint` until the lib
// split slices move them into models/studio/engine. It is declared, so its files
// are checked, not reported as unknown.

import { DECLARED_SHARED_MODULES } from './declared-shared.ts';

export type ProjectRole =
  | { role: 'timeline' | 'video' | 'stills' | 'brand' | 'capture' }
  /** A spec beside a root module (`timeline.test.ts`): run by `node --test`, it may bind the whole project; nothing imports it. */
  | { role: 'spec' }
  /** `bars/<id>.tsx` or `scenes/<id>.tsx`: one scene per file. */
  | { role: 'scene'; scene: string }
  /** A file in `bars/<id>/` or `scenes/<id>/`: that scene's own helper. */
  | { role: 'scene-helper'; scene: string }
  /** A project-specific `x-model.ts`, in its scene's folder or beside its scene file. */
  | { role: 'model'; scene: string }
  /** Listed in `declared-shared.ts`: scenes may import it; it never imports back into one. */
  | { role: 'shared' }
  | { role: 'sfx' | 'tools' | 'review' }
  /** Ingested or recorded input the picture reads: captures, music, voice audio, fixtures, reference media. */
  | { role: 'media' }
  /** Generated modules and render output (`generated/`, `out/`), exempt from every check. */
  | { role: 'generated' }
  /** A project file no role names. A scene that reaches one fails scene ownership. */
  | { role: 'unclassified' };

export type StudioPosition =
  | { kind: 'models' }
  | { kind: 'studio'; barrel: boolean }
  | { kind: 'engine' }
  | { kind: 'lib-unsplit' }
  | { kind: 'cli' }
  | { kind: 'lab-server' | 'lab-app' }
  | { kind: 'brand-kit'; kit: string }
  | ({ kind: 'project'; project: string } & ProjectRole)
  /** The checks themselves. Their fixtures name every violation on purpose. */
  | { kind: 'lint' }
  /** Root tool config (`remotion.config.ts`). */
  | { kind: 'root-config' }
  /** Deliberately ungoverned (§4): `scratch/`, `node_modules/`, `skills/`. */
  | { kind: 'ungoverned' }
  | { kind: 'undeclared' };

const ROOT_ROLES: Record<string, 'timeline' | 'video' | 'stills' | 'brand' | 'capture'> = {
  'timeline.ts': 'timeline', 'video.tsx': 'video', 'stills.tsx': 'stills', 'brand.ts': 'brand', 'capture.ts': 'capture',
};
const SUBDIR_ROLES: Record<string, 'sfx' | 'tools' | 'review' | 'media' | 'generated'> = {
  sfx: 'sfx', tools: 'tools', review: 'review', generated: 'generated', out: 'generated',
  captures: 'media', music: 'media', audio: 'media', fixture: 'media', assets: 'media', refs: 'media',
};
const SCENE_DIRS = new Set(['bars', 'scenes']);
const SOURCE_FILE = /^(.+)\.(ts|tsx)$/;
const MODEL_FILE = /^(.+)-model\.ts$/;

/** Project directory name → paths inside the project that are declared shared modules. */
export type DeclaredShared = Readonly<Record<string, readonly string[]>>;

/** The position of a repo-relative, `/`-separated path. */
export function classifyStudioPath(path: string, shared: DeclaredShared = DECLARED_SHARED_MODULES): StudioPosition {
  const parts = path.split('/');
  const [top, second] = parts;
  if (top === 'scratch' || top === 'node_modules' || top === 'skills') return { kind: 'ungoverned' };
  if (top === 'lint') return { kind: 'lint' };
  if (parts.length === 1) return /\.config\.[cm]?[jt]s$/.test(top) ? { kind: 'root-config' } : { kind: 'undeclared' };
  if (top === 'lib') {
    if (second === 'models') return { kind: 'models' };
    if (second === 'studio') return { kind: 'studio', barrel: path === 'lib/studio/api.ts' };
    if (second === 'engine') return { kind: 'engine' };
    return { kind: 'lib-unsplit' };
  }
  if (top === 'cli') return { kind: 'cli' };
  if (top === 'lab') return second === 'app' || (second === 'review' && parts[2] === 'app') ? { kind: 'lab-app' } : { kind: 'lab-server' };
  if (top === 'brands') return parts.length === 3 && parts[2] === 'brand.ts' ? { kind: 'brand-kit', kit: second } : { kind: 'undeclared' };
  if (top === 'projects' && parts.length > 2) return { kind: 'project', project: second, ...projectRole(parts.slice(2), shared[second] ?? []) };
  return { kind: 'undeclared' };
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
 * `../../lib/studio/api.ts` compare equal before any ownership check reads them.
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
