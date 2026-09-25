// project-bundle.ts: points a Remotion bundle at one project. The browser entry (lib/studio/Root.tsx) imports
// `@video` and `@stills`, which this aliases to the project's video.tsx and stills.tsx, or to a null module for the one
// it doesn't have.
//
// One project per bundle on purpose: captures and audio are gitignored and imported, so a project that hasn't been
// captured yet would break every other project's Studio and render if they shared a bundle.

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { webpack, type WebpackOverrideFn } from '@remotion/bundler';
import { HostImportPlugin, HostModuleStubPlugin, HostTsconfigPathsPlugin } from './host-module-resolution.ts';
import { previsFootageModuleFor, writePrevisFootageModule } from './previs-footage.ts';
import { projectHostLink, readProjectHostSpec } from './project-host-spec.ts';
import { writeSfxCueModule } from './sfx/cue-module.ts';

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

/**
 * The project's `file`, or generated/absent.ts (a null default export) when it has none. Written into the project, not
 * kept in lib/, because this file can't know its own path (no import.meta).
 */
function projectModule(project: string, file: string) {
  const path = join(resolve(project), file);
  if (existsSync(path)) return path;
  const absent = join(resolve(project), 'generated', 'absent.ts');
  const module = '// Written on every bundle: what @video or @stills is when the project has no video.tsx or stills.tsx.\nexport default null;\n';
  if (!existsSync(absent) || readFileSync(absent, 'utf8') !== module) {
    mkdirSync(dirname(absent), { recursive: true });
    writeFileSync(absent, module);
  }
  return absent;
}

export function projectWebpackOverride(project: string): WebpackOverrideFn {
  const dir = resolve(project);
  if (!existsSync(join(dir, 'video.tsx')) && !existsSync(join(dir, 'stills.tsx'))) throw new Error(`${projectSlug(project)} has neither a video.tsx nor a stills.tsx`);
  const video = projectModule(project, 'video.tsx'), stills = projectModule(project, 'stills.tsx');
  const hostPlugins = hostResolvePlugins(project);
  // Written before every bundle, so the import always resolves and never names a deleted file. An open Studio
  // watches it, and picks up footage as `studio gen video` rewrites it.
  writePrevisFootageModule(project);
  const sfxCues = writeSfxCueModule(project);
  return (config) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: { ...(config.resolve?.alias as Record<string, string>), '@video': video, '@stills': stills, '@footage': previsFootageModuleFor(project), '@sfx-cues': sfxCues, 'react-dom': studioReactDom(join(dir, 'generated')) },
      plugins: [...(config.resolve?.plugins ?? []), ...hostPlugins],
    },
    plugins: [...(config.plugins ?? []), new webpack.DefinePlugin({ PROJECT_SLUG: JSON.stringify(projectSlug(project)), REPLAY_SLUG: JSON.stringify(replaySlug(project)), BLOCKOUT_SLUG: JSON.stringify(blockoutSlug(project)) })],
  });
}
