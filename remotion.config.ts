// Settings for `npx remotion studio` (run it through `npm run studio -- projects/<p>`). scripts/render.ts calls the
// renderer APIs directly and passes its own settings, since this file only configures the CLI.
import { Config } from '@remotion/cli/config';
import { projectWebpackOverride } from './lib/project-bundle.ts';

const project = process.env.PROJECT;
if (!project) throw new Error('PROJECT is not set: open the Studio with npm run studio -- projects/<name>');

Config.setEntryPoint('./lib/studio/index.ts');
Config.overrideWebpackConfig(projectWebpackOverride(project));
