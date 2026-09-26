// studio lab: the Studio Lab, the studio app's playground with a tab per capability (curves, staggers, kit pieces, the
// hold check, sound, generated media), each explained in plain words and driven live. `--export <dir>` writes it as
// static files for a host like Cloudflare instead of serving it.
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'lab',
    description: 'The Studio Lab: play with each studio capability (curves and springs, staggers, kit pieces, the hold check, sound, generated media) and see what it is for. Makes no paid calls. Opens it in the studio app (the one already serving this checkout, or served here), where the cue editor can save; --export <dir> writes a read-only static copy instead (deploying it is up to you).',
  },
  args: {
    port: { type: 'string', default: '4317', description: 'Port the studio app is on, or is served on (shared with studio review)' },
    open: { type: 'boolean', default: true, description: 'Open it in the browser (--no-open to just serve)' },
    export: { type: 'string', description: 'Write the lab as static files into this folder (new or empty) instead of serving it. Read-only: the cue editor downloads its edits.' },
  },
  async run({ args }) {
    if (args.export) return exportLab(args.export);
    const { openStudioAppServer } = await import('#engine/web/studio-app-server.ts');
    const app = await openStudioAppServer({ port: Number(args.port) });
    const url = `${app.url}/lab`;
    process.stderr.write(`Studio Lab on ${url}${app.startedHere ? ' (Ctrl-C to stop)' : ', in the studio app already running'}\n`);
    if (args.open) {
      const { spawn } = await import('node:child_process');
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    }
    // Serve until interrupted.
    if (app.startedHere) await new Promise(() => {});
  },
});

async function exportLab(out: string) {
  const { resolve } = await import('node:path');
  const { exportStudioLab } = await import('#engine/lab/lab-export.ts');
  const outDir = resolve(out);
  const result = await exportStudioLab({ outDir });
  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  console.log(outDir);
  process.stderr.write(`${result.files} media files, ${mb(result.bytes)}\n`);
  for (const file of result.tooBig) process.stderr.write(`! ${file} is over Cloudflare's 25 MiB per-file limit: host it elsewhere or trim it\n`);
}
