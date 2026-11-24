// studio-app-open.ts: where a verb that shows a page (`studio review open`, `studio library open`, `studio app open`)
// finds the app. The main checkout's is the managed background app, so the verb returns at once; a worktree's is
// served by the verb itself until Ctrl-C, so an agent's app never outlives its terminal.
import { spawn } from 'node:child_process';
import { ensureStudioAppRunning } from './studio-app-daemon.ts';
import { defaultStudioAppPort, isStudioMainCheckout, serveStudioAppInProcess } from './studio-app-server.ts';

/** Where the app is; `servingHere` when the calling process serves it and must keep running. */
export type StudioAppPlace = { url: string; servingHere: boolean };

/** The app, running on this checkout's code, on `port` or this checkout's default. */
export async function reachStudioApp({ port = defaultStudioAppPort() }: { port?: number } = {}): Promise<StudioAppPlace> {
  if (isStudioMainCheckout()) {
    const status = await ensureStudioAppRunning(port);
    return { url: status.url!, servingHere: false };
  }
  const app = await serveStudioAppInProcess({ port });
  return { url: app.url, servingHere: app.startedHere };
}

/** How the verb tells its caller where the page is and whether to leave it running. */
export function describeStudioAppPlace(place: StudioAppPlace): string {
  if (place.servingHere) return 'served by this command until Ctrl-C';
  return isStudioMainCheckout() ? 'in the studio app (`studio app stop` stops it)' : 'in the studio app already running';
}

/** Opens `url` in the default browser and returns without waiting on it. */
export function openStudioAppPageInBrowser(url: string): void {
  spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
}
