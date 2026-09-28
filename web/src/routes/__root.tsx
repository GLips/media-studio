import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core';
import type { QueryClient } from '@tanstack/react-query';
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { mantineTheme, themeVariables } from '#web/shared/ui/mantine-theme.ts';
import appCss from '../styles.css?url';

type RootRouteContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RootRouteContext>()({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Studio' }],
    // An empty icon: the app has none, and without one every page load asks for /favicon.ico and logs its 404.
    links: [{ rel: 'stylesheet', href: appCss }, { rel: 'icon', href: 'data:,' }],
  }),
  shellComponent: RootDocument,
  component: Outlet,
});

/**
 * StyleX's Vite plugin injects its dev tags through `transformIndexHtml`, which Start never runs: it renders the
 * document from this route. The `/@id/` prefix sends the runtime through Vite's pipeline so `import.meta.hot` lives.
 * Always rendered: the app only ever runs on Vite's dev server (lib/engine/web).
 */
function StylexDevAssets() {
  return (
    <>
      <link rel="stylesheet" href="/virtual:stylex.css" suppressHydrationWarning />
      <script type="module" src="/@id/virtual:stylex:runtime" />
    </>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript forceColorScheme="dark" />
        <HeadContent />
        <StylexDevAssets />
      </head>
      <body>
        <MantineProvider theme={mantineTheme} cssVariablesResolver={themeVariables} forceColorScheme="dark">
          {children}
        </MantineProvider>
        <Scripts />
      </body>
    </html>
  );
}
