// vite.config.ts: the studio app, served in-process by `studio review` (lib/platform/web/engine/studio-app-server.ts). tk2's stack: StyleX ahead of
// React, TanStack Start (client-rendered: every screen plays media, so there is nothing to server-render). No Nitro:
// nothing deploys a server (the app runs in-process), and its dev server hands any <video> or <img> fetch to Vite's
// static files, which don't hold the projects' media.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unplugin as stylexUnplugin } from '@stylexjs/unplugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import type { StudioAppProjectModulesPlugin } from '#lib/output/render/engine/studio-app-project-modules.ts';

const WEB_ROOT = import.meta.dirname;
const STUDIO_ROOT = join(WEB_ROOT, '..');

// StyleX resolves `.stylex` imports itself and doesn't read package.json `imports`, so `#web/*` is spelled out for it.
// @stylexjs/unplugin types every bundler entry as `(options?) => any`; the binding confines that `any`.
// oxlint-disable-next-line typescript/no-unsafe-assignment -- see above
const stylexVitePlugin: PluginOption = stylexUnplugin.vite({
  devMode: 'full',
  aliases: { '#web/*': [join(WEB_ROOT, 'src', '*')] },
});

// Vite watches only its root (web/), so a storyboard.ts added under work/ after the server starts never reaches the
// plan page's globs (storyboard-modules.ts) unless it's watched here. Only the globbed files are watched, never
// work/'s footage and renders.
const watchProjectStoryboards: PluginOption = {
  name: 'studio-watch-project-storyboards',
  configureServer(server) {
    const files = ['storyboard.ts', 'audio/manifest.ts', 'music/index.ts', 'audio/take.json'];
    server.watcher.add(files.map((file) => join(STUDIO_ROOT, 'work', 'projects', '*', file)));
  },
};

// What a Remotion bundle aliases, found per project for the video-preview player. Imported as the server starts, not
// bundled into this config: Vite restarts on an edit to any file its config bundles, and this reaches much of lib's
// engine. Warning: Node caches it, so an edit to it takes a fresh `studio review` process.
const projectBundleModules = async (): Promise<Plugin> => {
  const engine = pathToFileURL(join(STUDIO_ROOT, 'lib', 'output', 'render', 'engine', 'studio-app-project-modules.ts')).href;
  // SAFETY: the module at that path, whose plugin's type is imported from it by its specifier.
  const { studioAppProjectModulesPlugin } = (await import(engine)) as { studioAppProjectModulesPlugin: () => StudioAppProjectModulesPlugin };
  return studioAppProjectModulesPlugin();
};

export default defineConfig({
  root: WEB_ROOT,
  // lib/ reaches past web/, and Vite serves only what it's allowed to read.
  server: { fs: { allow: [STUDIO_ROOT] } },
  // The video-preview player's packages, optimized up front: one Vite finds mid-session reloads every open page.
  optimizeDeps: { include: ['remotion', '@remotion/player', '@remotion/media', '@remotion/fonts', '@remotion/paths', 'three', 'three/webgpu', 'three/tsl', 'three/examples/jsm/environments/RoomEnvironment.js'] },
  plugins: [
    stylexVitePlugin,
    tanstackStart({
      // Client-rendered: the server sends a shell and the browser renders every route.
      spa: { enabled: true },
      // The fence between lib's roles, held by the bundler as well as the lint: no browser module may pull in a
      // feature's engine code, its Node-side machinery.
      importProtection: {
        behavior: 'error',
        client: { specifiers: [/^#lib\/[^/]+\/[^/]+\/engine\//], files: ['**/*.server.*'] },
      },
    }),
    viteReact(),
    watchProjectStoryboards,
    projectBundleModules(),
  ],
});
