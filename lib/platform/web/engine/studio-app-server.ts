// studio-app-server.ts: the studio web app (web/), run in-process on Vite for `studio review`. This folder is Vite's
// one owner in the engine.
//
// Negative space: nothing deploys the app as a server. Locally it's Vite's own dev server, bound to this machine;
// Vite's host check refuses a request addressed to any other name, which keeps a DNS-rebinding page out.
import { join } from 'node:path';
import { createServer } from 'vite';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';

const STUDIO_APP_CONFIG = join(STUDIO_ROOT, 'web', 'vite.config.ts');

/** Where the app is, and whether this process serves it (it keeps running) or found it already up (it can exit). */
export type StudioAppServer = { url: string; startedHere: boolean };

/**
 * The app on `port`: this checkout's, if it's already there, else started here. A server on the port that isn't
 * this checkout's app (another worktree's, or anything else) is refused rather than shown files that aren't these.
 */
export async function openStudioAppServer({ port }: { port: number }): Promise<StudioAppServer> {
  const url = `http://localhost:${port}`;
  const running = await askStudioAppIdentity(port);
  if (running === STUDIO_ROOT) return { url, startedHere: false };
  if (running !== undefined) throw new Error(`port ${port} is taken by ${running === null ? 'something other than the studio app' : `the studio app of ${running}`}: pass --port to use another`);
  const server = await createServer({ configFile: STUDIO_APP_CONFIG, server: { host: 'localhost', port, strictPort: true }, logLevel: 'warn' });
  await server.listen();
  // Exits by the signal's code itself: Vite's dependencies listen for these signals too, and studio-temp re-raises one
  // only when no other listener is left, so neither would end the process. Exiting runs studio-temp's cleanup.
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
    process.once(signal, () => void server.close().finally(() => process.exit(code)));
  }
  return { url, startedHere: true };
}

/** The repo root the app on `port` serves; null when something else answers there, undefined when nothing does. */
async function askStudioAppIdentity(port: number): Promise<string | null | undefined> {
  let reply: Response;
  try {
    // localhost, not 127.0.0.1: it may resolve to ::1, where an app bound to `localhost` listens.
    reply = await fetch(`http://localhost:${port}/api/studio`, { signal: AbortSignal.timeout(2000) });
  } catch {
    return undefined;
  }
  // SAFETY: whatever answers is outside this process; the checks below read it as unknown JSON.
  const body = (await reply.json().catch(() => null)) as { app?: unknown; root?: unknown } | null;
  return body?.app === 'studio' && typeof body.root === 'string' ? body.root : null;
}
