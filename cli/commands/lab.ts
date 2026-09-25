// studio lab: the Studio Lab, a playground with a tab per capability (curves, staggers, kit pieces, the hold check,
// sound, generated media), each explained in plain words and driven live. `--export <dir>` writes it as static files
// for a host like Cloudflare instead of serving it.
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'lab',
    description: 'The Studio Lab: play with each studio capability (curves and springs, staggers, kit pieces, the hold check, sound, generated media) and see what it is for. Makes no paid calls. Serves it locally, where the cue editor can save; --export <dir> writes a read-only static copy instead (deploying it is up to you).',
  },
  args: {
    port: { type: 'string', default: '4317', description: 'Port to serve on' },
    open: { type: 'boolean', default: true, description: 'Open it in the browser (--no-open to just serve)' },
    export: { type: 'string', description: 'Write the lab as static files into this folder (new or empty) instead of serving it. Read-only: the cue editor downloads its edits.' },
    exclude: { type: 'string', description: 'With --export: comma-separated globs of media to leave out, by path from the repo root (e.g. "scratch/**,**/*.wav")' },
    'media-base': { type: 'string', description: 'With --export: URL the media is hosted under (an R2 bucket\'s public URL, ending in /). The media is then not copied; media-files.txt lists what to upload where.' },
  },
  async run({ args }) {
    if (args.export) return exportLab(args.export, args.exclude, args['media-base']);
    const { startStudioLab } = await import('../../lab/server.ts');
    const { url } = await startStudioLab({ port: Number(args.port) });
    process.stderr.write(`Studio Lab on ${url} (Ctrl-C to stop)\n`);
    if (args.open) {
      const { spawn } = await import('node:child_process');
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    }
    // Serve until interrupted.
    await new Promise(() => {});
  },
});

async function exportLab(out: string, exclude: string | undefined, mediaBase: string | undefined) {
  const { matchesGlob, resolve } = await import('node:path');
  const { exportStudioLab } = await import('../../lab/export.ts');
  const globs = exclude?.split(',').map((g) => g.trim()).filter(Boolean) ?? [];
  const outDir = resolve(out);
  const result = await exportStudioLab({ outDir, include: (path) => !globs.some((g) => matchesGlob(path, g)), mediaBase });
  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  console.log(outDir);
  if (result.uploadList) process.stderr.write(`media not copied: upload the files listed in ${result.uploadList} under ${mediaBase}\n`);
  else process.stderr.write(`${result.files} media files, ${mb(result.bytes)}\n`);
  for (const file of result.tooBig) process.stderr.write(`! ${file} is over Cloudflare's 25 MiB per-file limit: --exclude it, or host media with --media-base\n`);
}
