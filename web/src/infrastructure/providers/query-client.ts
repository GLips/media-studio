import { QueryClient } from '@tanstack/react-query';

/**
 * The router's context: loaders prime the QueryClient the screens read from, so it's made once and handed to both.
 * No retries: the server is this machine reading its own files, so a failure is an answer (a missing file), not a
 * blip. A retry would also pause while the tab is hidden, holding a loader's skeleton up for good.
 */
export function createRouterQueryContext() {
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } },
    }),
  };
}
