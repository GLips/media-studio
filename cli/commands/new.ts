// studio new: starts a project that opens in the Studio on its first run.
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'new',
    description: 'Start projects/<yyyy-mm>-<slug>/ from the kit (a title, the page, an outro), capture the page and estimate the timing, so it previews at once. Prints the project directory.',
  },
  args: {
    slug: { type: 'positional', required: true, description: 'Lowercase words joined by dashes, e.g. sale-only-view' },
    url: { type: 'string', required: true, description: 'The page the first capture films' },
    title: { type: 'string', description: 'The video title (default: the slug, capitalised)' },
  },
  async run({ args }) {
    const { basename } = await import('node:path');
    const { scaffoldStudioProject } = await import('../../lib/new-project.ts');
    const { captureStudioProject } = await import('../../lib/capture.ts');
    const { voiceStudioProject } = await import('../../lib/voice-project.ts');
    const dir = scaffoldStudioProject({ slug: args.slug, url: args.url, title: args.title });
    await captureStudioProject(dir);
    await voiceStudioProject(dir, { mode: 'estimate' });
    const name = basename(dir);
    console.error(`Next:
  studio preview ${name}      watch it, with estimated timing and no voice
  studio voice ${name}        voice it
  studio render ${name}       render it`);
    console.log(dir);
  },
});
