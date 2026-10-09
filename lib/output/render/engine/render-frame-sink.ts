// render-frame-sink.ts: where a render's pages send the frames they composite (picture-frame-sink.ts), instead of
// Remotion screenshotting them. One loopback server a session; each draw opens a route of its own, named in its
// pages' input props, so draws running at once (a chunk's pages beside the next's) never mix their frames. A page's
// POST is answered once the route's handler has taken the frame, so an encoder's backpressure reaches the page.
//
// A page lets Remotion move on as soon as a frame's send has started, so Remotion finishing says nothing of what has
// arrived: a draw waits on its route (awaitFramesTaken) for every frame it asked for.

import { createServer, type IncomingMessage } from 'node:http';
import { listenOnRenderLoopback } from '#lib/platform/browser/engine/render-loopback.ts';

/** A frame a page sent: its number, and its pixels, `width` × `height` RGBA with straight alpha. */
export type RenderFrame = { readonly frame: number; readonly width: number; readonly height: number; readonly rgba: Buffer };

/** A draw's route: its `url`, for the pages' input props. `close` it once the draw is done. */
export type RenderFrameRoute = {
  readonly url: string;
  /**
   * Resolves once every one of `frames` has been taken; rejects with the first take that failed, or once
   * RENDER_FRAME_STRAGGLER_MS pass with frames still missing and none arriving.
   */
  readonly awaitFramesTaken: (frames: readonly number[]) => Promise<void>;
  readonly close: () => void;
};

/** The session's frame sink: `open` a route for a draw. */
export type RenderFrameSink = { readonly open: (take: (frame: RenderFrame) => Promise<void>) => RenderFrameRoute };

/**
 * How long a draw waits, once its pages are done, with frames missing and nothing arriving. The last frame's send
 * lands within milliseconds of Remotion finishing; one missing for this long was lost with its page.
 */
export const RENDER_FRAME_STRAGGLER_MS = 30_000;

async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  // SAFETY: a request with no encoding set reads as Buffers.
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** A route's frames as they're taken, and the first take that failed. */
function frameRouteState(take: (frame: RenderFrame) => Promise<void>) {
  const taken = new Set<number>(), changed = new Set<() => void>();
  let failed: Error | null = null;
  const notify = () => {
    for (const listener of changed) listener();
  };
  return {
    take: async (frame: RenderFrame) => {
      try {
        await take(frame);
        taken.add(frame.frame);
      } catch (error) {
        failed ??= error instanceof Error ? error : new Error(String(error));
        throw error;
      } finally {
        notify();
      }
    },
    awaitFramesTaken: (frames: readonly number[]) => new Promise<void>((resolve, reject) => {
      let straggling: NodeJS.Timeout | undefined;
      const check = () => {
        clearTimeout(straggling);
        const missing = frames.filter((frame) => !taken.has(frame));
        if (failed || !missing.length) {
          changed.delete(check);
          if (failed) reject(failed);
          else resolve();
          return;
        }
        straggling = setTimeout(() => {
          changed.delete(check);
          reject(new Error(`frames ${missing.join(', ')} drew but never reached the render: nothing arrived for ${RENDER_FRAME_STRAGGLER_MS / 1000} s`));
        }, RENDER_FRAME_STRAGGLER_MS);
      };
      changed.add(check);
      check();
    }),
  };
}

/** A frame sink listening on loopback for this process's renders. */
export async function serveRenderFrameSink(): Promise<RenderFrameSink> {
  const routes = new Map<string, (frame: RenderFrame) => Promise<void>>();
  let opened = 0;
  const server = createServer((request, response) => {
    const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-type': 'text/plain' };
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1'), take = routes.get(url.pathname);
      const [frame, width, height] = ['frame', 'width', 'height'].map((name) => Number(url.searchParams.get(name)));
      const rgba = await bodyOf(request);
      if (!take) response.writeHead(410, headers).end(`no draw is taking frames at ${url.pathname}`);
      else if (![frame, width, height].every(Number.isInteger) || rgba.byteLength !== width * height * 4) {
        response.writeHead(400, headers).end(`frame ${frame} came as ${rgba.byteLength} bytes for ${width}×${height} RGBA`);
      } else {
        await take({ frame, width, height, rgba }).then(
          () => response.writeHead(200, headers).end(),
          (error: Error) => response.writeHead(500, headers).end(error.message),
        );
      }
    })();
  });
  const port = await listenOnRenderLoopback(server);
  return {
    open: (take) => {
      const path = `/frames/${++opened}`, state = frameRouteState(take);
      routes.set(path, state.take);
      return { url: `http://127.0.0.1:${port}${path}`, awaitFramesTaken: state.awaitFramesTaken, close: () => void routes.delete(path) };
    },
  };
}
