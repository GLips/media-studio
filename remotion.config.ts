// Settings for `remotion studio`, which `studio preview <project>` opens. The other commands call the renderer
// APIs directly (lib/engine/render/render-session.ts) and passes its own settings, since this file only configures the CLI.
import { Config } from '@remotion/cli/config';
import { projectWebpackOverride } from './lib/engine/bundle/project-bundle.ts';

const project = process.env.PROJECT;
if (!project) throw new Error('PROJECT is not set: open the Studio with studio preview <project>');

Config.setEntryPoint('./lib/studio/composition/index.ts');
// Off for the reason studio-bundle.ts gives: webpack's cache is keyed per worktree path and never pruned.
Config.setCachingEnabled(false);
Config.overrideWebpackConfig(projectWebpackOverride(project));
