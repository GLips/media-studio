import { QueryClient } from '@tanstack/react-query';

/** The router's context: loaders prime the QueryClient the screens read from, so it's made once and handed to both. */
export function createRouterQueryContext() {
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
    }),
  };
}
