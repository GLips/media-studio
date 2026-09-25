// studio lab: the Studio Lab, a playground with a tab per capability (curves, staggers, kit pieces, the hold check,
// sound, generated media), each explained in plain words and driven live.
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'lab',
    description: 'Open the Studio Lab: play with each studio capability (curves and springs, staggers, kit pieces, the hold check, sound, generated media) and see what it is for. Makes no paid calls.',
  },
  args: {
    port: { type: 'string', default: '4317', description: 'Port to serve on' },
    open: { type: 'boolean', default: true, description: 'Open it in the browser (--no-open to just serve)' },
  },
  async run({ args }) {
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
