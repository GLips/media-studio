// lab-bundle.ts: how esbuild builds the Studio Lab's pages: watched for `studio lab` and `studio review`, once for the
// static export.
import { build, context, type BuildOptions } from 'esbuild';
import { join } from 'node:path';
import { STUDIO_ROOT } from '../project/studio-project.ts';

export const LAB_APP_DIR = join(STUDIO_ROOT, 'lab', 'app');

function labBundleOptions({ outdir, production, entry }: { outdir: string; production: boolean; entry: string }): BuildOptions {
  return {
    entryPoints: [entry],
    bundle: true,
    outdir,
    format: 'esm',
    jsx: 'automatic',
    minify: production,
    sourcemap: production ? false : 'linked',
    loader: { '.ttf': 'file', '.png': 'file', '.jpg': 'file', '.webp': 'file', '.svg': 'file', '.mp3': 'file', '.wav': 'file' },
    // lib/ modules read these at render time; in the lab there's no project bundle, so pin them.
    define: {
      'process.env.NODE_ENV': production ? '"production"' : '"development"',
      PROJECT_SLUG: '"lab"', REPLAY_SLUG: '"lab-replay"', BLOCKOUT_SLUG: '"lab-blockout"',
    },
    logLevel: 'warning',
  };
}

/** The lab page (or another page on its stack, `entry`) built once into `outdir`, minified. */
export async function buildLabPage({ outdir, entry = join(LAB_APP_DIR, 'main.tsx') }: { outdir: string; entry?: string }): Promise<void> {
  await build(labBundleOptions({ outdir, production: true, entry }));
}

/** The page rebuilt into `outdir` on every save until `dispose`. */
export async function watchLabPage({ outdir, entry = join(LAB_APP_DIR, 'main.tsx') }: { outdir: string; entry?: string }): Promise<{ dispose: () => Promise<void> }> {
  const bundle = await context(labBundleOptions({ outdir, production: false, entry }));
  await bundle.watch();
  return bundle;
}
