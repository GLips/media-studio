// render-frame-sink.ts: where a render's pages send the frames they composite (picture-frame-sink.ts), instead of
// Remotion screenshotting them. One loopback server a session; each draw opens a route of its own, named in its
// pages' input props, so draws running at once (a chunk's pages beside the next's) never mix their frames. A page's
// POST is answered once the route's handler has taken the frame, so an encoder's backpressure reaches the page.

import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A frame a page sent: its number, and its pixels, `width` × `height` RGBA with straight alpha. */
export type RenderFrame = { readonly frame: number; readonly width: number; readonly height: number; readonly rgba: Buffer };

/** The session's frame sink: `open` a route for a draw, `close` it once the draw is done. */
export type RenderFrameSink = {
  readonly open: (take: (frame: RenderFrame) => Promise<void>) => { readonly url: string; readonly close: () => void };
};

async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  // SAFETY: a request with no encoding set reads as Buffers.
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
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
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  server.unref();
  // SAFETY: a server listening on a TCP port is addressed by an AddressInfo.
  const { port } = server.address() as AddressInfo;
  return {
    open: (take) => {
      const path = `/frames/${++opened}`;
      routes.set(path, take);
      return { url: `http://127.0.0.1:${port}${path}`, close: () => void routes.delete(path) };
    },
  };
}
