import { createServerOnlyFn } from '@tanstack/react-start';
import { buildLabCatalog } from '#web/infrastructure/studio-engine.server.ts';

/** The lab's catalog, built fresh on each request. `studio lab --export` writes the same document as a file. */
export const respondWithLabCatalog = createServerOnlyFn(
  (): Response => Response.json(buildLabCatalog({ exported: false }).catalog, { headers: { 'cache-control': 'no-store' } }),
);
