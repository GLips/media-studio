// lab-export.ts: `studio lab --export`, the lab as static files for a host like Cloudflare: the app's shell at /lab and
// each tab's URL, lab-catalog.json with `exported` set (the cue editor downloads its edits instead of saving), and
// exactly the media the catalog lists. It only writes a folder: deploying it is a person's step.
//
// Copied WAVs are encoded as FLAC: lossless, so a fit's seams land on the same samples, and about half the size, which
// brings a long music fit under a static host's per-file limit.
//
// Negative space: the export serves the lab alone. Its root sends a visitor to /lab; the review screen needs the
// studio's own files and a server, so its routes are in the bundle but nothing links there.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LAB_TABS } from '#models/lab/lab-tabs.ts';
import { runFfmpeg } from '#engine/ffmpeg/ffmpeg.ts';
import { buildStudioAppShell } from '#engine/web/studio-app-server.ts';
import { buildLabCatalog } from './lab-catalog.ts';

/** Cloudflare refuses any single static file bigger than this. */
const STATIC_HOST_FILE_LIMIT = 25 * 1024 * 1024;

export type StudioLabExport = { files: number; bytes: number; tooBig: string[] };

export async function exportStudioLab({ outDir }: { outDir: string }): Promise<StudioLabExport> {
  if (existsSync(outDir) && readdirSync(outDir).length) throw new Error(`${outDir} isn't empty: export into a new or empty folder`);
  mkdirSync(outDir, { recursive: true });
  const { shell } = await buildStudioAppShell(outDir);
  for (const path of ['lab', ...LAB_TABS.map((t) => `lab/${t.id}`)]) {
    mkdirSync(join(outDir, path), { recursive: true });
    copyFileSync(shell, join(outDir, path, 'index.html'));
  }
  rmSync(shell);
  writeFileSync(join(outDir, 'index.html'), '<!doctype html><meta http-equiv="refresh" content="0; url=/lab/"><a href="/lab/">Studio Lab</a>\n');

  const { catalog, files } = buildLabCatalog({ exported: true });
  writeFileSync(join(outDir, 'lab-catalog.json'), JSON.stringify(catalog));
  const copied = [...files].map(([url, file]) => {
    const to = join(outDir, ...url.split('/').map(decodeURIComponent));
    mkdirSync(dirname(to), { recursive: true });
    if (url.endsWith('.flac') && file.endsWith('.wav')) runFfmpeg(['-v', 'error', '-i', file, '-c:a', 'flac', '-compression_level', '8', to]);
    else copyFileSync(file, to);
    return { url, bytes: statSync(to).size };
  });
  return {
    files: copied.length,
    bytes: copied.reduce((sum, m) => sum + m.bytes, 0),
    tooBig: copied.filter((m) => m.bytes > STATIC_HOST_FILE_LIMIT).map((m) => decodeURIComponent(m.url)),
  };
}
