// studio-bundle.ts: bundles the studio's browser entry for one project, for the renderer to serve, and keeps the
// bundle between runs. Node only.
//
// Apart from project-bundle.ts because that file can't use import.meta (the Remotion CLI bundles it to CommonJS),
// and this one needs STUDIO_ROOT.
//
// A kept bundle is reused while every file webpack read for it is unchanged and every path it looked for and didn't
// find is still missing: webpack's own record of its inputs, so a re-render of one bar after another costs a stat per
// input rather than a bundle. Each bundle goes to a folder of its own and `current.json` is swapped in whole, so a
// render still serving the previous bundle, or a second bundle of the same project at once, never reads a half-written
// one.
import { bundle, type WebpackOverrideFn } from '@remotion/bundler';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { STUDIO_ROOT } from '../project/studio-project.ts';
import { projectWebpackOverride } from './project-bundle.ts';

const KEPT_BUNDLES_DIR = join(STUDIO_ROOT, 'node_modules', '.cache', 'studio-bundle');
/** Bundles kept per project: the newest and the two before it, which a render started earlier may still be serving. */
const KEPT_BUNDLES = 3;

type BundleInput = { path: string; size: number; mtimeMs: number; hash: string };
type KeptBundle = { project: string; dir: string; inputs: BundleInput[]; missing: string[] };

const hashFile = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** An input as it is now; its bytes are hashed only when its size or mtime moved, since a rewrite can leave them equal. */
function inputUnchanged(input: BundleInput): boolean {
  if (!existsSync(input.path)) return false;
  const { size, mtimeMs } = statSync(input.path);
  if (size !== input.size) return false;
  return mtimeMs === input.mtimeMs || hashFile(input.path) === input.hash;
}

function readKeptBundle(home: string): KeptBundle | null {
  const current = join(home, 'current.json');
  if (!existsSync(current)) return null;
  const kept = JSON.parse(readFileSync(current, 'utf8')) as KeptBundle;
  if (!existsSync(join(home, kept.dir, 'index.html'))) return null;
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
  const kept = readKeptBundle(home);
  if (kept) return join(home, kept.dir);

  console.error(`bundling ${project}…`);
  const dir = `${Date.now()}-${process.pid}`;
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
  const serveUrl = await bundle({ entryPoint: join(STUDIO_ROOT, 'lib/studio/index.ts'), webpackOverride: recording, outDir: join(home, dir) });
  if (!recorded) throw new Error('webpack finished without reporting what it read, so the bundle can\'t be kept');
  // Webpack judges node_modules by package version, not file by file, so an install is judged by the lockfile.
  const inputs = [...recorded.files, join(STUDIO_ROOT, 'package-lock.json')].filter((path) => existsSync(path) && statSync(path).isFile()).map((path) => {
    const { size, mtimeMs } = statSync(path);
    return { path, size, mtimeMs, hash: hashFile(path) };
  });
  const record: KeptBundle = { project: resolve(project), dir, inputs, missing: recorded.missing };
  const written = join(home, `current.json.${process.pid}`);
  writeFileSync(written, JSON.stringify(record));
  renameSync(written, join(home, 'current.json'));
  for (const old of readdirSync(home).filter((name) => /^\d+-\d+$/.test(name)).sort().reverse().slice(KEPT_BUNDLES)) {
    rmSync(join(home, old), { recursive: true, force: true });
  }
  forgetGoneProjects();
  return serveUrl;
}

/** Drops the bundles of projects that are gone, such as a tool's or a test's temporary project. */
function forgetGoneProjects() {
  for (const name of readdirSync(KEPT_BUNDLES_DIR)) {
    const current = join(KEPT_BUNDLES_DIR, name, 'current.json');
    if (existsSync(current) && !existsSync((JSON.parse(readFileSync(current, 'utf8')) as KeptBundle).project)) {
      rmSync(join(KEPT_BUNDLES_DIR, name), { recursive: true, force: true });
    }
  }
}
