import { ColorSchemeScript, MantineProvider, mantineHtmlProps } from '@mantine/core';
import type { QueryClient } from '@tanstack/react-query';
import { HotkeysProvider } from '@tanstack/react-hotkeys';
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { StudioWaitingTitle, studioQuickOpenEntries } from '#web/features/projects/index.ts';
import { mantineTheme, themeVariables } from '#web/shared/ui/mantine-theme.ts';
import { QuickOpenEntriesProvider } from '#web/shared/ui/quick-open-entries.tsx';
import { StudioOverlaysProvider } from '#web/shared/ui/studio-overlays.tsx';
import appCss from '../styles.css?url';

type RootRouteContext = { queryClient: QueryClient };

export const Route = createRootRouteWithContext<RootRouteContext>()({
  head: () => ({
    // No title: StudioWaitingTitle owns it, counting what waits, and a head title would reset it on a navigation.
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    // An empty icon: the app has none, and without one every page load asks for /favicon.ico and logs its 404. While
    // anything waits, use-studio-waiting-title.ts rewrites its href to a dot.
    links: [{ rel: 'stylesheet', href: appCss }, { rel: 'icon', href: 'data:,' }],
  }),
  shellComponent: RootDocument,
  component: Outlet,
});

/**
 * StyleX's Vite plugin injects its dev tags through `transformIndexHtml`, which Start never runs: it renders the
 * document from this route. The `/@id/` prefix sends the runtime through Vite's pipeline so `import.meta.hot` lives.
 * Always rendered: the app only ever runs on Vite's dev server (lib/platform/web/engine/studio-app-server.ts).
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
          {/* A key bound twice on one target throws, so a collision between two screens' groups shows in dev. */}
          <HotkeysProvider defaultOptions={{ hotkey: { conflictBehavior: 'error' } }}>
            <QuickOpenEntriesProvider source={studioQuickOpenEntries}>
              <StudioWaitingTitle />
              <StudioOverlaysProvider>{children}</StudioOverlaysProvider>
            </QuickOpenEntriesProvider>
          </HotkeysProvider>
        </MantineProvider>
        <Scripts />
      </body>
    </html>
  );
}
