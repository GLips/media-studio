// project-bundle.ts: points a Remotion bundle at one project. The browser entry (lib/studio/Root.tsx) imports
// `@project`, which this aliases to the project's video.tsx.
//
// One project per bundle on purpose: captures and audio are gitignored and imported, so a project that hasn't been
// captured yet would break every other project's Studio and render if they shared a bundle.

import { basename, join, resolve } from 'node:path';
import { webpack, type WebpackOverrideFn } from '@remotion/bundler';

export function projectSlug(project: string) {
  return basename(resolve(project));
}

export function projectWebpackOverride(project: string): WebpackOverrideFn {
  const entry = join(resolve(project), 'video.tsx');
  return (config) => ({
    ...config,
    resolve: { ...config.resolve, alias: { ...(config.resolve?.alias as Record<string, string>), '@project': entry } },
    plugins: [...(config.plugins ?? []), new webpack.DefinePlugin({ PROJECT_SLUG: JSON.stringify(projectSlug(project)) })],
  });
}
