// project-bundle.ts: points a Remotion bundle at one project. The browser entry (lib/studio/Root.tsx) imports
// `@project`, which this aliases to the project's video.tsx.
//
// One project per bundle on purpose: captures and audio are gitignored and imported, so a project that hasn't been
// captured yet would break every other project's Studio and render if they shared a bundle.

import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { webpack, type WebpackOverrideFn } from '@remotion/bundler';
import { HostImportPlugin, HostModuleStubPlugin, HostTsconfigPathsPlugin } from './host-module-resolution.ts';
import { previsFootageModuleFor, writePrevisFootageModule } from './previs-footage.ts';
import { projectHostLink, readProjectHostSpec } from './project-host-spec.ts';

export function projectSlug(project: string) {
  return basename(resolve(project));
}

/** The composition that replays chosen frames in a chosen order (Root.tsx's ReplayVideo). */
export function replaySlug(project: string) {
  return `${projectSlug(project)}-replay`;
}

/** The composition that renders one previs scene's blockout alone (Video.tsx's BlockoutSolo). */
export function blockoutSlug(project: string) {
  return `${projectSlug(project)}-blockout`;
}


// Host components must share the studio's React, and Remotion pins react-dom only at /client, so a host's
// createPortal would load a second copy. No import.meta: the Remotion CLI bundles remotion.config.ts to CommonJS.
const studioReactDom = (entry: string) => dirname(createRequire(entry).resolve('react-dom/package.json'));

// A scene imports its host as `@host/<path from the host root>` (HostImportPlugin; typed in lib/host-modules.d.ts).
// Webpack resolves symlinks, so host files arrive under the link's real path, and the plugins match on that.
function hostResolvePlugins(project: string) {
  const spec = readProjectHostSpec(resolve(project));
  const link = projectHostLink(resolve(project));
  if (!spec || !existsSync(link)) return [];
  const hostRoot = realpathSync(link);
  return [new HostImportPlugin(hostRoot), new HostTsconfigPathsPlugin(hostRoot), new HostModuleStubPlugin(hostRoot, spec.browserStubs ?? [])];
}

export function projectWebpackOverride(project: string): WebpackOverrideFn {
  const entry = join(resolve(project), 'video.tsx');
  const hostPlugins = hostResolvePlugins(project);
  // Written before every bundle, so the import always resolves and never names a deleted file. An open Studio
  // watches it, and picks up footage as `studio gen video` rewrites it.
  writePrevisFootageModule(project);
  return (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: { ...(config.resolve?.alias as Record<string, string>), '@project': entry, '@footage': previsFootageModuleFor(project), 'react-dom': studioReactDom(entry) },
      plugins: [...(config.resolve?.plugins ?? []), ...hostPlugins],
    },
    plugins: [...(config.plugins ?? []), new webpack.DefinePlugin({ PROJECT_SLUG: JSON.stringify(projectSlug(project)), REPLAY_SLUG: JSON.stringify(replaySlug(project)), BLOCKOUT_SLUG: JSON.stringify(blockoutSlug(project)) })],
  });
}
