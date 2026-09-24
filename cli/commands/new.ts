// studio new: starts a project that opens in the Studio on its first run.
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'new',
    description: 'Start projects/<yyyy-mm>-<slug>/ from the kit (a title and an outro) and estimate the timing, so it previews at once. With --url, the title runs over that page, captured as the first shot; without, capture.ts starts empty. Prints the project directory.',
  },
  args: {
    slug: { type: 'positional', required: true, description: 'Lowercase words joined by dashes, e.g. sale-only-view' },
    url: { type: 'string', description: 'A page to capture as the first shot, `home`. Leave it out for a site that needs a sign-in or a server first' },
    title: { type: 'string', description: 'The video title (default: the slug, capitalised)' },
  },
  async run({ args }) {
    const { basename } = await import('node:path');
    const { scaffoldStudioProject } = await import('../../lib/new-project.ts');
    const { captureStudioProject } = await import('../../lib/capture.ts');
    const { voiceStudioProject } = await import('../../lib/voice-project.ts');
    const dir = scaffoldStudioProject({ slug: args.slug, url: args.url, title: args.title });
    if (args.url) await captureStudioProject(dir);
    await voiceStudioProject(dir, { mode: 'estimate' });
    const name = basename(dir);
    const shotsFirst = args.url ? '' : `
  studio probe ${name} <url>  see a page as capture.ts will, with selectors, then write its shots
  studio capture ${name}      film them`;
    console.error(`Next:${shotsFirst}
  studio preview ${name}      watch it, with estimated timing and no voice
  studio voice ${name}        voice it
  studio render ${name}       render it`);
    console.log(dir);
  },
});
