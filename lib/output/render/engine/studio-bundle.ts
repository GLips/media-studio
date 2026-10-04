// studio-bundle.ts: bundles the studio's browser entry for one project, and keeps the bundle between runs. Node
// only. Apart from project-bundle.ts because that file can't use import.meta (the Remotion CLI bundles it to
// CommonJS), and this one needs STUDIO_ROOT.
//
// A kept bundle is reused while every file webpack read for it is unchanged and every path it looked for and didn't
// find is still missing. What Node decides before webpack runs (aliases, the host link, this code) webpack never
// records, so it's fingerprinted apart. Each bundle gets a folder of its own and `current.json` is swapped in whole,
// so a render still serving the previous bundle, or a second bundle of the same project, never reads a half-written one.

import { bundle, type WebpackOverrideFn } from '@remotion/bundler';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { projectWebpackOverride } from './project-bundle.ts';

const KEPT_BUNDLES_DIR = join(STUDIO_ROOT, 'node_modules', '.cache', 'studio-bundle');
/**
 * Bundles kept per project: the three newest, and any younger than an hour, which a render started earlier may still
 * be serving, but never more than eight, so a burst of edits can't pile up ~40 MB bundles for the hour.
 */
const KEPT_BUNDLES = 3, KEPT_BUNDLE_MS = 60 * 60 * 1000, KEPT_BUNDLES_MAX = 8;
/** The Node-side modules that shape a bundle's webpack config. */
const BUNDLE_CONFIG_MODULES = [
  'lib/output/render/engine/project-bundle.ts', 'lib/output/render/engine/studio-bundle.ts',
  'lib/output/render/engine/host-module-resolution.ts', 'lib/output/render/engine/host-modules.d.ts',
  'lib/output/render/engine/tsx-test-hooks.ts', 'lib/footage/previs/engine/previs-footage.ts',
  'lib/picture/brand/engine/project-brand.ts', 'lib/platform/host/engine/hosts.ts',
  'lib/platform/host/engine/project-host-spec.ts', 'lib/output/sfx-cues/engine/cue-module.ts',
].map((path) => join(STUDIO_ROOT, path));

type BundleInput = { path: string; size: number; mtimeMs: number; hash: string };
type KeptBundle = { project: string; dir: string; config: string; inputs: BundleInput[]; missing: string[] };

const hashFile = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** What decides the config before webpack reads a file: the project's entry modules, its host, and the bundle code. */
function bundleConfigFingerprint(project: string): string {
  const dir = resolve(project), host = join(dir, 'host'), spec = join(dir, 'host.json');
  return createHash('sha256').update(JSON.stringify({
    entries: ['video.tsx', 'stills.tsx'].map((file) => existsSync(join(dir, file))),
    host: existsSync(host) ? realpathSync(host) : null,
    spec: existsSync(spec) ? hashFile(spec) : null,
    code: BUNDLE_CONFIG_MODULES.map(hashFile),
  })).digest('hex');
}

/** An input as it is now; its bytes are hashed only when its size or mtime moved, since a rewrite can leave them equal. */
function inputUnchanged(input: BundleInput): boolean {
  if (!existsSync(input.path)) return false;
  const { size, mtimeMs } = statSync(input.path);
  if (size !== input.size) return false;
  return mtimeMs === input.mtimeMs || hashFile(input.path) === input.hash;
}

function readKeptBundle(home: string, config: string): KeptBundle | null {
  const current = join(home, 'current.json');
  if (!existsSync(current)) return null;
  const kept = JSON.parse(readFileSync(current, 'utf8')) as KeptBundle;
  if (kept.config !== config || !existsSync(join(home, kept.dir, 'index.html'))) return null;
  return kept.inputs.every(inputUnchanged) && !kept.missing.some((path) => existsSync(path)) ? kept : null;
}

/**
 * Bundles the studio's browser entry for one project (its video, its stills or both), or reuses the kept bundle when
 * none of its inputs changed; returns the serve URL.
 */
export async function bundleStudioProject(project: string): Promise<string> {
  // Before the kept bundle is judged: the override writes the generated modules the bundle imports, which are inputs.
  const override = projectWebpackOverride(project);
  const home = join(KEPT_BUNDLES_DIR, createHash('sha256').update(resolve(project)).digest('hex').slice(0, 16));
  const config = bundleConfigFingerprint(project);
  const kept = readKeptBundle(home, config);
  if (kept) return join(home, kept.dir);

  console.error(`bundling ${project}…`);
  // Inputs are stat'd once webpack is done, so one saved while it ran would be recorded as what it bundled.
  const started = Date.now();
  const dir = `${started}-${process.pid}`;
  let recorded: { files: string[]; missing: string[] } | undefined;
  const recording: WebpackOverrideFn = async (config) => {
    const overridden = await override(config);
    return {
      ...overridden,
      plugins: [...(overridden.plugins ?? []), {
        apply: (compiler) => compiler.hooks.done.tap('studio-kept-bundle', ({ compilation }) => {
          recorded = { files: [...compilation.fileDependencies], missing: [...compilation.missingDependencies] };
        }),
      }],
    };
  };
  mkdirSync(home, { recursive: true });
  // Webpack's persistent cache is off: keyed on absolute paths, it grew ~240 MB per worktree and project, unpruned,
  // and an unchanged project reuses the kept bundle without webpack at all.
  const serveUrl = await bundle({ entryPoint: join(STUDIO_ROOT, 'lib/picture/composition/studio/index.ts'), webpackOverride: recording, outDir: join(home, dir), enableCaching: false });
  if (!recorded) throw new Error('webpack finished without reporting what it read, so the bundle can\'t be kept');
  // Webpack judges node_modules by package version, not file by file, so an install is judged by the lockfile.
  const inputs = [...recorded.files, join(STUDIO_ROOT, 'package-lock.json')].filter((path) => existsSync(path) && statSync(path).isFile()).map((path) => {
    const { size, mtimeMs } = statSync(path);
    return { path, size, mtimeMs, hash: hashFile(path) };
  });
  if (inputs.every((input) => input.mtimeMs < started) && bundleConfigFingerprint(project) === config) {
    // Looks wrong: webpack counts a folder it probed as a file (node_modules/zod, tried as zod.js…) as missing, and a
    // folder always exists, so kept, it would refuse the bundle every run. Only what's absent now can appear.
    const record: KeptBundle = { project: resolve(project), dir, config, inputs, missing: recorded.missing.filter((path) => !existsSync(path)) };
    const written = join(home, `current.json.${process.pid}`);
    writeFileSync(written, JSON.stringify(record));
    renameSync(written, join(home, 'current.json'));
  } else console.error('a file changed while bundling, so this bundle serves this run only');
  const others = readdirSync(home).filter((name) => /^\d+-\d+$/.test(name) && name !== dir)
    .map((name) => ({ name, finished: statSync(join(home, name)).mtimeMs })).toSorted((a, b) => b.finished - a.finished);
  const stale = others.filter((o, i) => i >= KEPT_BUNDLES_MAX - 1 || (i >= KEPT_BUNDLES - 1 && Date.now() - o.finished > KEPT_BUNDLE_MS));
  for (const old of stale) {
    rmSync(join(home, old.name), { recursive: true, force: true });
  }
  forgetGoneProjects();
  return serveUrl;
}

/**
 * Drops the bundles of projects that are gone, such as a removed worktree's or a test's temporary project, so the cache
 * holds at most KEPT_BUNDLES_MAX bundles per project that still exists.
 */
function forgetGoneProjects() {
  for (const name of readdirSync(KEPT_BUNDLES_DIR)) {
    const home = join(KEPT_BUNDLES_DIR, name), current = join(home, 'current.json');
    // Another process forgetting at once (tests bundle in parallel) may drop this home after it's listed.
    const made = statSync(home, { throwIfNoEntry: false });
    let kept: string | null;
    try {
      kept = readFileSync(current, 'utf8');
    } catch (error) {
      // SAFETY: node:fs throws ErrnoExceptions.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      kept = null;
    }
    if (!made) continue;
    // A home with no kept bundle (each one failed or went stale while bundling, or one is starting) is judged by age.
    // SAFETY: current.json is only ever written by bundleStudioProject, as a KeptBundle.
    const gone = kept === null ? Date.now() - made.mtimeMs > KEPT_BUNDLE_MS : !existsSync((JSON.parse(kept) as KeptBundle).project);
    if (gone) rmSync(home, { recursive: true, force: true });
  }
}
