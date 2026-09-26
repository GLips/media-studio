import { queryOptions } from '@tanstack/react-query';
import type { LabCatalog } from '#models/lab/lab-catalog.ts';
import { fetchStudioUrl } from '#web/infrastructure/api-client.ts';
import { readLabCatalogResponse } from './lab-catalog-schema.ts';

/**
 * The lab's catalog: a server route here, a file beside the pages in an export, one URL either way. Fetched once a
 * page: what it lists changes only when a project renders or generates, and a reload picks that up.
 */
export const labCatalogQueryOptions = queryOptions({
  queryKey: ['lab-catalog'],
  queryFn: async (): Promise<LabCatalog> => {
    return readLabCatalogResponse(await fetchStudioUrl('/lab-catalog.json'));
  },
  staleTime: Infinity,
});
