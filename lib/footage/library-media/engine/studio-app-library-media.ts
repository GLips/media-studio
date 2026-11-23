// studio-app-library-media.ts: the studio app's Vite plugin serving the library's media at /library-media, where
// library-media.ts names it by default, for the plan page, the review app and the video-preview player. Typed by shape
// rather than by Vite's types: only lib/platform/web/engine/ imports vite.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Effect, ManagedRuntime } from 'effect';
import { libraryMediaServicesLayer, makeLibraryMediaRequestHandler } from './library-media-server.ts';

type StudioAppMiddlewareServer = {
  middlewares: { use: (handle: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void };
  httpServer: { once: (event: 'close', listener: () => void) => void } | null;
};

/** Assignable to Vite's Plugin; vite.config.ts types it as one. */
export type StudioAppLibraryMediaPlugin = { name: string; configureServer: (server: StudioAppMiddlewareServer) => void };

export function studioAppLibraryMediaPlugin(): StudioAppLibraryMediaPlugin {
  return {
    name: 'studio-app-library-media',
    configureServer(server) {
      // The services, frame decoders among them, live as long as Vite's server.
      const runtime = ManagedRuntime.make(libraryMediaServicesLayer);
      const handle = runtime.runSync(makeLibraryMediaRequestHandler());
      server.httpServer?.once('close', () => Effect.runFork(runtime.disposeEffect));
      server.middlewares.use((request, response, next) => {
        if (!handle(request, response)) next();
      });
    },
  };
}
