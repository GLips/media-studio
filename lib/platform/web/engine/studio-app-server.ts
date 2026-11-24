// studio-app-server.ts: the studio web app (web/) on Vite's dev server, and how a caller tells what holds a port. This
// folder is Vite's one owner in the engine. The main checkout runs it as a managed background process
// (studio-app-daemon.ts); a worktree serves it in its own process (serveStudioAppInProcess).
//
// Negative space: nothing deploys the app as a server. Locally it's Vite's own dev server, bound to this machine;
// Vite's host check refuses a request addressed to any other name, which keeps a DNS-rebinding page out.
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { Result, Schema } from 'effect';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';

const STUDIO_APP_CONFIG = join(STUDIO_ROOT, 'web', 'vite.config.ts');

/** Answered by middleware ahead of TanStack, so it says whose server this is even when the app itself is broken. */
const STUDIO_APP_IDENTITY_PATH = '/__studio/identity';
/** Answered through TanStack: a 200 here means the app's own request path works. */
const STUDIO_APP_READINESS_PATH = '/api/studio';

/** The managed app's port: the main checkout's, and the one Studio Recorder opens. */
export const STUDIO_APP_MAIN_PORT = 4317;

/**
 * True for a primary clone (its `.git` a folder), false for a git worktree (its `.git` a file). Only a primary clone
 * runs the managed app on 4317, so an agent's worktree can never claim the port Graham's app lives on.
 */
export const isStudioMainCheckout = (): boolean => statSync(join(STUDIO_ROOT, '.git')).isDirectory();

/** The port a `studio` verb serves the app on by default: 4317 for the main checkout, one fixed per worktree. */
export function defaultStudioAppPort(): number {
  if (isStudioMainCheckout()) return STUDIO_APP_MAIN_PORT;
  return 4400 + (createHash('sha256').update(STUDIO_ROOT).digest().readUInt32BE(0) % 500);
}

/** What answers on a port: nothing, a studio app (whose, which managed instance, if any), or something else. */
export type StudioAppIdentity =
  | { kind: 'nothing' }
  | { kind: 'studio'; root: string; instanceId: string | null }
  | { kind: 'other'; detail: string };

/** What the identity middleware answers; `instanceId` is null for an in-process app. */
const StudioAppIdentityReply = Schema.Struct({ app: Schema.Literal('studio'), root: Schema.String, instanceId: Schema.NullOr(Schema.String) });
const decodeStudioAppIdentityReply = Schema.decodeUnknownResult(StudioAppIdentityReply);

/** Who holds `port`. A server that accepts but doesn't answer in time is `other`: it can't be told apart. */
export async function askStudioAppIdentity(port: number): Promise<StudioAppIdentity> {
  let reply: Response;
  try {
    // localhost, not 127.0.0.1: it may resolve to ::1, where an app bound to `localhost` listens.
    reply = await fetch(`http://localhost:${port}${STUDIO_APP_IDENTITY_PATH}`, { signal: AbortSignal.timeout(3000) });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') return { kind: 'other', detail: `a server that didn't answer within 3 s` };
    return { kind: 'nothing' };
  }
  const body: unknown = await reply.json().catch(() => null);
  const decoded = decodeStudioAppIdentityReply(body);
  if (reply.ok && Result.isSuccess(decoded)) return { kind: 'studio', root: decoded.success.root, instanceId: decoded.success.instanceId };
  return { kind: 'other', detail: `a server answering ${reply.status} that isn't the studio app (or is one too old to say whose it is)` };
}

/** Why the app on `port` can't serve a page, or null when it can. Its first request compiles routes, hence the wait. */
export async function studioAppReadinessFailure(port: number): Promise<string | null> {
  try {
    const reply = await fetch(`http://localhost:${port}${STUDIO_APP_READINESS_PATH}`, { signal: AbortSignal.timeout(20_000) });
    return reply.ok ? null : `its pages fail: ${STUDIO_APP_READINESS_PATH} answered ${reply.status}`;
  } catch (error) {
    return `its pages don't answer: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Serves STUDIO_APP_IDENTITY_PATH; `instanceId` names a managed instance, null an in-process one. */
const studioAppIdentityPlugin = (instanceId: string | null): Plugin => ({
  name: 'studio-app-identity',
  configureServer(server) {
    server.middlewares.use(STUDIO_APP_IDENTITY_PATH, (_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ app: 'studio', root: STUDIO_ROOT, instanceId }));
    });
  },
});

/** Starts this checkout's app on `port`, failing if the port is taken. It runs until its process ends. */
export async function startStudioAppViteServer({ port, instanceId }: { port: number; instanceId: string | null }): Promise<ViteDevServer> {
  const server = await createServer({
    configFile: STUDIO_APP_CONFIG,
    server: { host: 'localhost', port, strictPort: true },
    logLevel: 'warn',
    plugins: [studioAppIdentityPlugin(instanceId)],
  });
  await server.listen();
  return server;
}

/** Where the app is, and whether this process serves it (it keeps running) or found it already up (it can exit). */
export type StudioAppInProcess = { url: string; startedHere: boolean };

/**
 * A worktree's app on `port`: its own, if it's already there, else served by this process until it ends. A server on
 * the port that isn't this checkout's app is refused rather than shown files that aren't these.
 */
export async function serveStudioAppInProcess({ port }: { port: number }): Promise<StudioAppInProcess> {
  const url = `http://localhost:${port}`;
  const holder = await askStudioAppIdentity(port);
  if (holder.kind === 'studio' && holder.root === STUDIO_ROOT) return { url, startedHere: false };
  if (holder.kind === 'studio') throw new Error(`port ${port} is taken by the studio app of ${holder.root}: pass --port to use another`);
  if (holder.kind === 'other') throw new Error(`port ${port} is taken by ${holder.detail}: pass --port to use another`);
  await startStudioAppViteServer({ port, instanceId: null });
  return { url, startedHere: true };
}
