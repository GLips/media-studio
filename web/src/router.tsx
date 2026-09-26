import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { createRouterQueryContext } from '#web/infrastructure/providers/query-client.ts';
import { RouteErrorPage } from '#web/shared/ui/route-error-page.tsx';
import { RouteNotFoundPage } from '#web/shared/ui/route-not-found-page.tsx';
import { RoutePendingPage } from '#web/shared/ui/route-pending-page.tsx';
import { routeTree } from './routeTree.gen.ts';

export function getRouter() {
  const context = createRouterQueryContext();
  return createTanStackRouter({
    routeTree,
    context,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: RoutePendingPage,
    defaultErrorComponent: RouteErrorPage,
    defaultNotFoundComponent: RouteNotFoundPage,
    Wrap: ({ children }) => <QueryClientProvider client={context.queryClient}>{children}</QueryClientProvider>,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
