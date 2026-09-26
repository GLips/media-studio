// studio new: starts a project of a declared capability that passes check:arch, typecheck and its tests as written.
import { defineCommand } from 'citty';
import { PROJECT_CAPABILITIES } from '#models/project/capability.ts';

export default defineCommand({
  meta: {
    name: 'new',
    description: 'Start projects/<yyyy-mm>-<slug>/ of one capability, declared in its project.ts, that passes check:arch, typecheck and its tests from its first commit. music-led: timeline.ts with bars on a steady tempo (a fitted track replaces it) and a landmark on the final hit, a file per bar in bars/. voice-led: timeline.ts with scenes on voiceover.json\'s lines, each with a speech cue, a file per scene in scenes/, and the lines\' timing estimated. mixed: voiced scenes around a section of bars. Each scene starts blocked, flat pieces moving on its cues, so `studio render --animatic` and `studio review` work at once; timeline.test.ts registers it with the retime runner. still-only: a stills.tsx whose one design (a fitted headline on a ground beside a full-bleed field holding the --url page on a tilted card) renders at og and youtube, in the kit brands/<--brand> if given; skills/stills is the workflow. With --url, capture.ts films that page as `home`; without, it starts empty. Prints the project directory.',
  },
  args: {
    slug: { type: 'positional', required: true, description: 'Lowercase words joined by dashes, e.g. sale-only-view' },
    capability: { type: 'enum', options: [...PROJECT_CAPABILITIES], required: true, description: 'What drives it: music-led, voice-led, mixed (voice and music), or still-only' },
    url: { type: 'string', description: 'A page to capture as the first shot, `home`. Leave it out for a site that needs a sign-in or a server first' },
    title: { type: 'string', description: 'The video title, or the stills\' first headline (default: the slug, capitalised)' },
    brand: { type: 'string', valueHint: 'painful-pleasures', description: 'Still-only: the brand kit in brands/ its stills are in' },
  },
  async run({ args }) {
    const { basename } = await import('node:path');
    const { scaffoldStudioProject } = await import('#engine/project/new-project.ts');
    const { captureStudioProject } = await import('#engine/capture/capture.ts');
    const { capability } = args;
    const dir = scaffoldStudioProject({ slug: args.slug, capability, url: args.url, title: args.title, brand: args.brand });
    if (args.url) await captureStudioProject(dir);
    const voiced = capability === 'voice-led' || capability === 'mixed';
    if (voiced) {
      const { voiceStudioProject } = await import('#engine/voice/voice-project.ts');
      await voiceStudioProject(dir, { mode: 'estimate' });
    }
    const name = basename(dir);
    const shotsFirst = args.url ? '' : `
  studio probe ${name} <url>        see a page as capture.ts will, with selectors for its elements, then write its shots
  studio capture ${name}            film them`;
    if (capability === 'still-only') {
      console.error(`Next (skills/stills):${shotsFirst}
  studio still ${name} --sheet   render every variant at each preset, with a sheet to pick from
  studio review <sheet>          show the sheet for notes`);
    } else {
      console.error(`Next (skills/video-kickoff):
  studio render ${name} --animatic  the blocked scenes as the video plays now
  studio review ${name}             approve the storyboard on it, then raise each scene in its own file${shotsFirst}${voiced ? `
  studio voice ${name}              voice it` : ''}
  studio clock ${name}              every scene's frames, beats and cues`);
    }
    console.log(dir);
  },
});
