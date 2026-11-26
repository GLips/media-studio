// vite.config.ts: the studio app, served in-process by `studio review` (lib/platform/web/engine/studio-app-server.ts). tk2's stack: StyleX ahead of
// React, TanStack Start (client-rendered: every screen plays media, so there is nothing to server-render). No Nitro:
// nothing deploys a server (the app runs in-process), and its dev server hands any <video> or <img> fetch to Vite's
// static files, which don't hold the projects' media.
import { isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unplugin as stylexUnplugin } from '@stylexjs/unplugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import type { StudioAppLibraryMediaPlugin } from '#lib/footage/library-media/engine/studio-app-library-media.ts';
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

// Vite watches only web/, so a project's storyboard.ts added after the server starts reaches the plan page's globs
// (storyboard-modules.ts) only if watched here. Warning: Vite's watcher disables globbing, so work/projects/*/… would
// be a literal path. work/projects is watched whole instead, ignoring all but the globbed files, never footage.
const PROJECTS_ROOT = join(STUDIO_ROOT, 'work', 'projects');
const watchedInProject = new Set(['storyboard.ts', 'audio', 'audio/manifest.ts', 'music', 'music/index.ts']);
const ignoredInProjects = (path: string): boolean => {
  const inside = relative(PROJECTS_ROOT, path);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return false;
  const [, ...rest] = inside.split(sep);
  return rest.length > 0 && !watchedInProject.has(rest.join('/'));
};
const watchProjectStoryboards: PluginOption = {
  name: 'studio-watch-project-storyboards',
  config: () => ({ server: { watch: { ignored: [ignoredInProjects] } } }),
  configureServer(server) {
    server.watcher.add(PROJECTS_ROOT);
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

// The library's media, from its media folder, where library-media.ts names it. Imported as the server starts, as above.
const libraryMedia = async (): Promise<Plugin> => {
  const engine = pathToFileURL(join(STUDIO_ROOT, 'lib', 'footage', 'library-media', 'engine', 'studio-app-library-media.ts')).href;
  // SAFETY: the module at that path, whose plugin's type is imported from it by its specifier.
  const { studioAppLibraryMediaPlugin } = (await import(engine)) as { studioAppLibraryMediaPlugin: () => StudioAppLibraryMediaPlugin };
  return studioAppLibraryMediaPlugin();
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
    libraryMedia(),
  ],
});
