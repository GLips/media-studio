import { queryOptions } from '@tanstack/react-query';
import { fetchProjectListing, fetchProjectListings } from './project-listings.ts';

/** The front page's list, fresh on each visit: a render lands on disk while the app is open. */
export const projectListingsQueryOptions = queryOptions({
  queryKey: ['project-listings'],
  queryFn: () => fetchProjectListings(),
  staleTime: 0,
});

export const projectListingQueryOptions = (project: string) => queryOptions({
  queryKey: ['project-listing', project],
  queryFn: () => fetchProjectListing({ data: { project } }),
  staleTime: 0,
});
