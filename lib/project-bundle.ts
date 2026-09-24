// project-bundle.ts: points a Remotion bundle at one project. The browser entry (lib/studio/Root.tsx) imports
// `@project`, which this aliases to the project's video.tsx.
//
// One project per bundle on purpose: captures and audio are gitignored and imported, so a project that hasn't been
// captured yet would break every other project's Studio and render if they shared a bundle.

import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { webpack, type WebpackOverrideFn } from '@remotion/bundler';

export function projectSlug(project: string) {
  return basename(resolve(project));
}

/** The composition that replays chosen frames in a chosen order (Root.tsx's ReplayVideo). */
export function replaySlug(project: string) {
  return `${projectSlug(project)}-replay`;
}

// Host components must share the studio's React, and Remotion pins react-dom only at /client, so a host's
// createPortal would load a second copy. No import.meta: the Remotion CLI bundles remotion.config.ts to CommonJS.
const studioReactDom = (entry: string) => dirname(createRequire(entry).resolve('react-dom/package.json'));

export function projectWebpackOverride(project: string): WebpackOverrideFn {
  const entry = join(resolve(project), 'video.tsx');
  return (config) => ({
    ...config,
    resolve: { ...config.resolve, alias: { ...(config.resolve?.alias as Record<string, string>), '@project': entry, 'react-dom': studioReactDom(entry) } },
    plugins: [...(config.plugins ?? []), new webpack.DefinePlugin({ PROJECT_SLUG: JSON.stringify(projectSlug(project)), REPLAY_SLUG: JSON.stringify(replaySlug(project)) })],
  });
}
