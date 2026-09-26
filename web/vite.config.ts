// vite.config.ts: the studio app, served in-process by `studio review` and `studio lab` (lib/engine/web) and built
// once for `studio lab --export`. tk2's stack: StyleX ahead of React, TanStack Start (client-rendered: every screen
// plays media or a live composition, so there is nothing to server-render). No Nitro: nothing deploys a server (the
// app runs in-process, the export is static), and its dev server hands any <video> or <img> fetch to Vite's static
// files, which don't hold the projects' media.
import { join } from 'node:path';
import { unplugin as stylexUnplugin } from '@stylexjs/unplugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';

const WEB_ROOT = import.meta.dirname;
const STUDIO_ROOT = join(WEB_ROOT, '..');

// StyleX resolves `.stylex` imports itself and doesn't read package.json `imports`, so `#web/*` is spelled out for it.
// @stylexjs/unplugin types every bundler entry as `(options?) => any`; the binding confines that `any`.
// oxlint-disable-next-line typescript/no-unsafe-assignment -- see above
const stylexVitePlugin: PluginOption = stylexUnplugin.vite({
  devMode: 'full',
  aliases: { '#web/*': [join(WEB_ROOT, 'src', '*')] },
});

export default defineConfig({
  root: WEB_ROOT,
  // lib/ reaches past web/, and Vite serves only what it's allowed to read.
  server: { fs: { allow: [STUDIO_ROOT] } },
  // Absolute: Start prerenders the SPA shell from a preview server that resolves a relative outDir against the working
  // directory, not web/. Inside the repo, since the server build it prerenders from imports node_modules.
  build: { outDir: join(WEB_ROOT, 'dist') },
  plugins: [
    stylexVitePlugin,
    tanstackStart({
      // The app's one build is `studio lab --export`: a shell the lab's routes render into on any static host.
      spa: { enabled: true },
      // The fence between the lib split's positions, held by the bundler as well as the lint: no browser module may
      // pull in Node-side machinery.
      importProtection: {
        behavior: 'error',
        client: { specifiers: ['#engine/*'], files: ['**/*.server.*'] },
      },
    }),
    viteReact(),
  ],
});
