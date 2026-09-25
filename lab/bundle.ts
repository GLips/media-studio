// bundle.ts: how esbuild builds the Studio Lab's page, shared by the dev server (watching) and the static export.
import type { BuildOptions } from 'esbuild';
import { join } from 'node:path';
import { STUDIO_ROOT } from '../lib/studio-project.ts';

export const LAB_APP_DIR = join(STUDIO_ROOT, 'lab', 'app');

export function labBundleOptions({ outdir, production }: { outdir: string; production: boolean }): BuildOptions {
  return {
    entryPoints: [join(LAB_APP_DIR, 'main.tsx')],
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
