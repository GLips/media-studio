// studio new: starts a project that opens in the Studio on its first run: a video, or with --stills, stills.
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'new',
    description: 'Start projects/<yyyy-mm>-<slug>/ from the kit (a title and an outro) and estimate the timing, so it previews at once. With --url, the title runs over that page, captured as the first shot; without, capture.ts starts empty. With --stills, a stills project instead: a stills.tsx whose one design (a fitted headline on a ground beside a full-bleed field holding the --url page on a tilted card) renders at og and youtube, in the kit brands/<--brand> if given; skills/stills is the workflow. Prints the project directory.',
  },
  args: {
    slug: { type: 'positional', required: true, description: 'Lowercase words joined by dashes, e.g. sale-only-view' },
    url: { type: 'string', description: 'A page to capture as the first shot, `home`. Leave it out for a site that needs a sign-in or a server first' },
    title: { type: 'string', description: 'The video title, or the stills\' first headline (default: the slug, capitalised)' },
    stills: { type: 'boolean', description: 'Start a stills project (OG images, thumbnails, social images), not a video' },
    brand: { type: 'string', valueHint: 'painful-pleasures', description: 'With --stills: the brand kit in brands/ its stills are in' },
  },
  async run({ args }) {
    const { basename } = await import('node:path');
    const { scaffoldStudioProject } = await import('../../lib/new-project.ts');
    const { captureStudioProject } = await import('../../lib/capture.ts');
    const dir = scaffoldStudioProject({ slug: args.slug, url: args.url, title: args.title, stills: args.stills, brand: args.brand });
    if (args.url) await captureStudioProject(dir);
    const name = basename(dir);
    const shotsFirst = args.url ? '' : `
  studio probe ${name} <url>  see a page as capture.ts will, with selectors for its elements, then write its shots
  studio capture ${name}      film them`;
    if (args.stills) {
      console.error(`Next (skills/stills):${shotsFirst}
  studio still ${name} --sheet   render every variant at each preset, with a sheet to pick from
  studio review <sheet>          show the sheet for notes`);
    } else {
      const { voiceStudioProject } = await import('../../lib/voice-project.ts');
      await voiceStudioProject(dir, { mode: 'estimate' });
      console.error(`Next:${shotsFirst}
  studio preview ${name}      watch it, with estimated timing and no voice
  studio voice ${name}        voice it
  studio render ${name}       render it`);
    }
    console.log(dir);
  },
});
