// render-loopback.ts: a server a render's pages reach on loopback: its placements, its solved-paint cache, its frame
// sink, the GPU probe. Node only.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Listens on a free loopback port and returns it. Neither the server nor any connection to it keeps the process
 * alive: a kept render browser (kept-render-browsers.ts) outlives the render, and its keep-alive connections would hold
 * the render's process open once its work is done.
 */
export async function listenOnRenderLoopback(server: Server): Promise<number> {
  server.on('connection', (socket) => socket.unref());
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  server.unref();
  // SAFETY: a server listening on a TCP port is addressed by an AddressInfo.
  return (server.address() as AddressInfo).port;
}
