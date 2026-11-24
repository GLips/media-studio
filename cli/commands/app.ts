// studio app: the main checkout's studio app as a background server: start, stop, restart, status, open. The lifecycle
// is lib/platform/web/engine/studio-app-daemon.ts; Studio Recorder's menu runs these verbs.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseOptionsBeforeSubcommand } from '../command-flags.ts';

const portArg = { port: { type: 'string', description: "Port of the app (4317, the main checkout's, by default)" } } as const satisfies ArgsDef;

/** The managed app's port; refuses a worktree, whose `studio review open` serves its own app in its own process. */
async function managedStudioAppPort(port: string | undefined): Promise<number> {
  const { isStudioMainCheckout, STUDIO_APP_MAIN_PORT } = await import('#lib/platform/web/engine/studio-app-server.ts');
  if (!isStudioMainCheckout()) throw new Error('studio app manages the main checkout\'s app; in a worktree, `studio review open` serves its own until Ctrl-C');
  return port === undefined ? STUDIO_APP_MAIN_PORT : Number(port);
}

const startCommand = defineCommand({
  meta: {
    name: 'start',
    description: 'Start the studio app in the background, or restart it if it is unhealthy or its code changed.',
    about: 'Returns once it serves pages, printing its status as JSON. It runs until `studio app stop`. Its output goes to ~/Library/Logs/StudioApp-<port>.log.',
  },
  args: portArg,
  async run({ args }) {
    const { ensureStudioAppRunning } = await import('#lib/platform/web/engine/studio-app-daemon.ts');
    console.log(JSON.stringify(await ensureStudioAppRunning(await managedStudioAppPort(args.port))));
  },
});

const stopCommand = defineCommand({
  meta: { name: 'stop', description: 'Stop the background studio app, if `studio app` started it.', about: 'Leaves alone a server it did not start, saying so.' },
  args: portArg,
  async run({ args }) {
    const { stopStudioApp, studioAppStatus } = await import('#lib/platform/web/engine/studio-app-daemon.ts');
    const port = await managedStudioAppPort(args.port);
    const stopped = await stopStudioApp(port);
    const after = await studioAppStatus(port);
    process.stderr.write(`${stopped ? 'stopped the studio app' : 'the studio app was not running'}${after.state === 'foreign' ? `; ${after.detail}` : ''}\n`);
  },
});

const restartCommand = defineCommand({
  meta: { name: 'restart', description: 'Stop the background studio app and start it again.', about: 'For a fault a health check misses. Prints its status as JSON once it serves pages.' },
  args: portArg,
  async run({ args }) {
    const { ensureStudioAppRunning, stopStudioApp } = await import('#lib/platform/web/engine/studio-app-daemon.ts');
    const port = await managedStudioAppPort(args.port);
    await stopStudioApp(port);
    console.log(JSON.stringify(await ensureStudioAppRunning(port)));
  },
});

const statusCommand = defineCommand({
  meta: {
    name: 'status',
    description: 'Say whether the studio app is running, healthy and on current code.',
    about: 'Only looks: it never starts or stops anything. States: running, stopped, unhealthy (ours, but its pages fail), foreign (something `studio app` did not start holds the port). stale means its code has changed since it started, so the next start or open restarts it.',
  },
  args: { ...portArg, json: { type: 'boolean', description: 'Print the status as one JSON object' } },
  async run({ args }) {
    const { studioAppStatus } = await import('#lib/platform/web/engine/studio-app-daemon.ts');
    const status = await studioAppStatus(await managedStudioAppPort(args.port));
    if (args.json) {
      console.log(JSON.stringify(status));
      return;
    }
    console.log([
      `${status.state}${status.url ? ` on ${status.url}` : ''}${status.pid ? ` (pid ${status.pid}, since ${status.startedAt})` : ''}${status.stale ? ', on old code: the next start restarts it' : ''}`,
      ...(status.detail ? [status.detail] : []),
      `log: ${status.log}`,
    ].join('\n'));
  },
});

const openCommand = defineCommand({
  meta: { name: 'open', description: "Open the studio app's home page in the browser, starting the app if it isn't running.", about: 'Restarts it first when it is unhealthy or its code changed.' },
  args: portArg,
  async run({ args }) {
    const { ensureStudioAppRunning } = await import('#lib/platform/web/engine/studio-app-daemon.ts');
    const { openStudioAppPageInBrowser } = await import('#lib/platform/web/engine/studio-app-open.ts');
    const status = await ensureStudioAppRunning(await managedStudioAppPort(args.port));
    openStudioAppPageInBrowser(status.url!);
    process.stderr.write(`opened ${status.url}\n`);
  },
});

export default defineCommand({
  meta: {
    name: 'app',
    description: 'The studio app (review, library, lab) as a background server: start, stop, restart, status, open.',
    about: "One app, the main checkout's, on port 4317, serves every project's review, the library and the lab. `studio review open` and `studio library open` start it when it isn't running and return at once; it runs until `studio app stop` (or Studio Recorder's menu) stops it. A start or open restarts it when its pages fail or its code has changed. A worktree has no background app: its `studio review open` serves its own on a port of its own until Ctrl-C.",
  },
  setup: refuseOptionsBeforeSubcommand,
  subCommands: { start: startCommand, stop: stopCommand, restart: restartCommand, status: statusCommand, open: openCommand },
});
