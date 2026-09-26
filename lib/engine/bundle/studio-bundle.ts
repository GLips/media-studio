// studio-bundle.ts: bundles the studio's browser entry for one project, for the renderer to serve, and keeps the
// bundle between runs. Node only.
//
// Apart from project-bundle.ts because that file can't use import.meta (the Remotion CLI bundles it to CommonJS),
// and this one needs STUDIO_ROOT.
//
// A kept bundle is reused while every file webpack read for it is unchanged and every path it looked for and didn't
// find is still missing: webpack's own record of its inputs, so a re-render of one bar after another costs a stat per
// input rather than a bundle. What Node decides before webpack runs (which of video.tsx and stills.tsx the aliases
// point at, the host link, the bundle code itself) webpack never records, so it's fingerprinted apart. Each bundle goes to a folder of its own and `current.json` is swapped in whole, so a
// render still serving the previous bundle, or a second bundle of the same project at once, never reads a half-written
// one.
//
// Webpack's own persistent cache is off. Remotion keys it on the whole config, entry and aliases by absolute path, so
// every worktree and project wrote another ~240 MB to the shared node_modules/.cache/webpack and nothing pruned it. It
// only helps a bundle after an edit (1.5 s rather than 3.3 s for fidelity-ladder); an unchanged project reuses the
// kept bundle here without webpack at all.
import { bundle, type WebpackOverrideFn } from '@remotion/bundler';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { STUDIO_ROOT } from '../project/studio-project.ts';
import { projectWebpackOverride } from './project-bundle.ts';

const KEPT_BUNDLES_DIR = join(STUDIO_ROOT, 'node_modules', '.cache', 'studio-bundle');
/**
 * Bundles kept per project: the three newest, and any younger than an hour, which a render started earlier may still
 * be serving, but never more than eight, so a burst of edits can't pile up ~40 MB bundles for the hour.
 */
const KEPT_BUNDLES = 3, KEPT_BUNDLE_MS = 60 * 60 * 1000, KEPT_BUNDLES_MAX = 8;
/** The Node-side modules that shape a bundle's webpack config. */
const BUNDLE_CONFIG_MODULES = ['lib/engine/bundle', 'lib/engine/host'].flatMap((dir) =>
  readdirSync(join(STUDIO_ROOT, dir)).filter((name) => name.endsWith('.ts')).map((name) => join(STUDIO_ROOT, dir, name)))
  .concat(join(STUDIO_ROOT, 'lib/sfx/cue-module.ts'));

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
  const serveUrl = await bundle({ entryPoint: join(STUDIO_ROOT, 'lib/studio/composition/index.ts'), webpackOverride: recording, outDir: join(home, dir), enableCaching: false });
  if (!recorded) throw new Error('webpack finished without reporting what it read, so the bundle can\'t be kept');
  // Webpack judges node_modules by package version, not file by file, so an install is judged by the lockfile.
  const inputs = [...recorded.files, join(STUDIO_ROOT, 'package-lock.json')].filter((path) => existsSync(path) && statSync(path).isFile()).map((path) => {
    const { size, mtimeMs } = statSync(path);
    return { path, size, mtimeMs, hash: hashFile(path) };
  });
  if (inputs.every((input) => input.mtimeMs < started) && bundleConfigFingerprint(project) === config) {
    const record: KeptBundle = { project: resolve(project), dir, config, inputs, missing: recorded.missing };
    const written = join(home, `current.json.${process.pid}`);
    writeFileSync(written, JSON.stringify(record));
    renameSync(written, join(home, 'current.json'));
  } else console.error('a file changed while bundling, so this bundle serves this run only');
  const others = readdirSync(home).filter((name) => /^\d+-\d+$/.test(name) && name !== dir)
    .map((name) => ({ name, finished: statSync(join(home, name)).mtimeMs })).sort((a, b) => b.finished - a.finished);
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
    // A home with no kept bundle (each one failed or went stale while bundling, or one is starting) is judged by age.
    const gone = existsSync(current)
      ? !existsSync((JSON.parse(readFileSync(current, 'utf8')) as KeptBundle).project)
      : Date.now() - statSync(home).mtimeMs > KEPT_BUNDLE_MS;
    if (gone) rmSync(home, { recursive: true, force: true });
  }
}
