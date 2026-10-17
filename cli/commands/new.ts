// studio new: starts a project of a declared capability that passes check:arch, typecheck and its tests as written.
import { defineCommand } from 'citty';
import { PROJECT_CAPABILITIES } from '#lib/platform/project/models/capability.ts';

export default defineCommand({
  meta: {
    name: 'new',
    description: "Start a project of one capability that passes every check from its first commit.",
    about: "Makes work/projects/<yyyy-mm>-<slug>/, its capability declared in its project.ts, and for a video its plan in storyboard.ts: the brief, then a row per scene (on screen, motion, and what times it, with the cues its picture moves on):\n- music-led: bars on a steady tempo (a fitted track replaces it) and a landmark on the final hit, a file per bar in bars/.\n- voice-led: scenes on voiced lines, each with a word cue, timed from their word counts until `studio voice` reads them, a file per scene in scenes/.\n- mixed: voiced scenes around a section of bars.\n- silent: scenes of fixed seconds, a file per scene in scenes/, and no voice, music or sound, so it delivers with no audio track.\n- still-only: a stills.tsx whose one design (a fitted headline on a ground beside a full-bleed field holding the --url page on a tilted card) renders at og and youtube, in the brand kit --brand names.\n\nEach timed scene starts blocked, flat pieces moving on its cues and its row as its note, so `studio render --animatic` and `studio review open` work at once; the workspace's retime check times its storyboard. With --url, capture.ts films that page as `home`; without, it starts empty. Prints the project directory, and the next commands on stderr.",
  },
  args: {
    slug: { type: 'positional', required: true, description: 'Lowercase words joined by dashes, e.g. spring-launch' },
    capability: { type: 'enum', options: [...PROJECT_CAPABILITIES], required: true, description: 'What drives it: music-led, voice-led, mixed (voice and music), silent (fixed spans, no sound), or still-only' },
    url: { type: 'string', description: 'A page to capture as the first shot, `home`. Leave it out for a site that needs a sign-in or a server first' },
    title: { type: 'string', description: 'The video title, or the stills\' first headline (default: the slug, capitalised)' },
    brand: { type: 'string', valueHint: 'kit', description: 'Still-only: the brand kit in work/brands/ its stills are in' },
  },
  async run({ args }) {
    const { basename } = await import('node:path');
    const { scaffoldStudioProject } = await import('#lib/platform/scaffold/engine/new-project.ts');
    const { captureStudioProject } = await import('#lib/footage/capture/engine/capture.ts');
    const { capability } = args;
    const dir = scaffoldStudioProject({ slug: args.slug, capability, url: args.url, title: args.title, brand: args.brand });
    if (args.url) await captureStudioProject(dir);
    const voiced = capability === 'voice-led' || capability === 'mixed';
    const name = basename(dir);
    const shotsFirst = args.url ? '' : `
  studio probe ${name} <url>        see a page as capture.ts will, with selectors for its elements, then write its shots
  studio capture ${name}            film them`;
    if (capability === 'still-only') {
      console.error(`Next (the stills skill):${shotsFirst}
  studio still ${name} --sheet   render every variant at each preset, with a sheet to pick from
  studio review open <sheet>     show the sheet for notes`);
    } else {
      console.error(`Next (the video-kickoff skill):
  studio render ${name} --animatic  the blocked scenes as the video plays now
  studio review open ${name}        approve the storyboard on it, then raise each scene in its own file${shotsFirst}${voiced ? `
  studio voice ${name}              voice it` : ''}
  studio clock ${name}              every scene's frames, beats and cues`);
    }
    console.log(dir);
  },
});
