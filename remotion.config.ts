// Settings for `remotion studio`, which `studio preview <project>` opens. The other commands call the renderer
// APIs directly (lib/render-session.ts) and passes its own settings, since this file only configures the CLI.
import { Config } from '@remotion/cli/config';
import { projectWebpackOverride } from './lib/project-bundle.ts';

const project = process.env.PROJECT;
if (!project) throw new Error('PROJECT is not set: open the Studio with studio preview <project>');

Config.setEntryPoint('./lib/studio/index.ts');
Config.overrideWebpackConfig(projectWebpackOverride(project));
