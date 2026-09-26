// export.ts: the Studio Lab as static files, for a host like Cloudflare Pages: the built page, a read-only
// lab-manifest.json, and the media it lists. Everything runs in the browser; the cue editor offers its edits as a
// download instead of saving. It only writes a folder: deploying it is a person's step.
//
// With `mediaBase` the media isn't copied: the manifest points at that URL (an R2 bucket, say), and media-files.txt
// says which file goes to which key, for whoever uploads them. Copied WAVs are encoded as FLAC: lossless, so a fit's
// seams land on the same samples, and about half the size, which brings a long music fit under Pages' per-file limit.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildLabPage, LAB_APP_DIR } from '#engine/bundle/lab-bundle.ts';
import { buildLabManifest, type LabMediaFilter } from './manifest.ts';
import { runFfmpeg } from '#engine/ffmpeg/ffmpeg.ts';

/** Cloudflare Pages refuses any single file bigger than this. */
const PAGES_FILE_LIMIT = 25 * 1024 * 1024;

export type StudioLabExport = { files: number; bytes: number; tooBig: string[]; uploadList: string | null };

export async function exportStudioLab({ outDir, include, mediaBase = '' }: { outDir: string; include?: LabMediaFilter; mediaBase?: string }): Promise<StudioLabExport> {
  if (existsSync(outDir) && readdirSync(outDir).length) throw new Error(`${outDir} isn't empty: export into a new or empty folder`);
  mkdirSync(outDir, { recursive: true });
  await buildLabPage({ outdir: outDir });
  copyFileSync(join(LAB_APP_DIR, 'index.html'), join(outDir, 'index.html'));

  const { manifest, files } = buildLabManifest({ writable: false, include, mediaBase, wavAsFlac: !mediaBase });
  writeFileSync(join(outDir, 'lab-manifest.json'), JSON.stringify(manifest));
  let uploadList: string | null = null;
  const copied: { key: string; bytes: number }[] = [];
  if (mediaBase) {
    uploadList = join(outDir, 'media-files.txt');
    writeFileSync(uploadList, [...files].map(([key, file]) => `${decodeURIComponent(key)}\t${file}\n`).join(''));
  } else {
    for (const [key, file] of files) {
      const to = join(outDir, ...key.split('/').map(decodeURIComponent));
      mkdirSync(dirname(to), { recursive: true });
      if (key.endsWith('.flac') && file.endsWith('.wav')) runFfmpeg(['-v', 'error', '-i', file, '-c:a', 'flac', '-compression_level', '8', to]);
      else copyFileSync(file, to);
      copied.push({ key, bytes: statSync(to).size });
    }
  }
  return {
    files: copied.length,
    bytes: copied.reduce((sum, m) => sum + m.bytes, 0),
    tooBig: copied.filter((m) => m.bytes > PAGES_FILE_LIMIT).map((m) => decodeURIComponent(m.key)),
    uploadList,
  };
}
