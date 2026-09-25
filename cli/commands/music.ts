// studio music: adds a music track to a project, supplied or generated, and fits one to the video's length
// (lib/engine/music/music-track.ts).
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

const add = defineCommand({
  meta: {
    name: 'add',
    description: "Copy a track into the project's music/, measure its loudness, tempo and beats, and write music/index.ts. Use it with defineVideo({ music: { track: music.bed } }). Prints music/index.ts.",
  },
  args: {
    project: studioProjectArg,
    track: { type: 'positional', required: true, description: 'The audio file to add' },
    name: { type: 'string', default: 'bed', description: 'What the video calls it: music.<name>' },
  },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { resolveStudioProject } = await import('../../lib/engine/project/studio-project.ts');
    const { addProjectMusicTrack } = await import('../../lib/engine/music/music-track.ts');
    console.log(addProjectMusicTrack(resolveStudioProject(args.project), resolve(args.track), args.name));
  },
});

const gen = defineCommand({
  meta: {
    name: 'gen',
    description: "Generate a track with Lyria from a prompt (mood, tempo, instruments, structure), then add it like `add` does. A 30 s clip ($0.04) unless --full ($0.08). Cached: the same prompt costs nothing again, and a new one is a new track. Fit it with `fit` before using it. Needs OPENROUTER_API_KEY. Prints music/index.ts.",
  },
  args: {
    project: studioProjectArg,
    prompt: { type: 'positional', required: true, description: 'What to make: mood, tempo, instruments, structure' },
    name: { type: 'string', default: 'bed', description: 'What the video calls it: music.<name>' },
    full: { type: 'boolean', description: 'A full-length track (lyria-3-pro) rather than a 30 s clip, for music that has to go somewhere' },
  },
  async run({ args }) {
    const { resolveStudioProject } = await import('../../lib/engine/project/studio-project.ts');
    const { generateProjectMusicTrack } = await import('../../lib/engine/music/music-track.ts');
    console.log(await generateProjectMusicTrack(resolveStudioProject(args.project), { prompt: args.prompt, name: args.name, full: Boolean(args.full) }));
  },
});

const fit = defineCommand({
  meta: {
    name: 'fit',
    description: "Cut a track to exactly the video's length, ending on its own ending: its intro, whole bars dropped or repeated by jumping between like-sounding downbeats, then its outro. Or play its bars in the order --bars gives, when the picture needs the time in particular places. Adds it beside the original as music.<as>, with the spans it was cut from. Prints the file, its seams, and each cut and `expect` against the nearest downbeat.",
  },
  args: {
    project: studioProjectArg,
    name: { type: 'string', default: 'bed', description: 'The track to fit: music.<name>' },
    as: { type: 'string', description: 'What the video calls the fit: music.<as>. Default <name>-fit' },
    seconds: { type: 'string', description: "Fit to this length instead of the video's, e.g. to audition a length. Skips the downbeat report" },
    bars: {
      type: 'string', valueHint: '1-3,3,4,8-13',
      description: "Play the source's bars in this order instead (bar 1 starts on its first downbeat), for a picture that needs time in particular places; its length is theirs. Prints how alike each seam's sides sound. Skips the downbeat report",
    },
    tail: { type: 'string', valueHint: '1', description: "With --bars: seconds of silence after the track's ending, for a picture that holds past it" },
  },
  async run({ args }) {
    const { resolveStudioProject } = await import('../../lib/engine/project/studio-project.ts');
    const { fitProjectMusicTrack, formatMusicFitReport } = await import('../../lib/engine/music/music-track.ts');
    const as = args.as ?? `${args.name}-fit`;
    if (args.bars !== undefined) {
      if (args.seconds !== undefined) throw new Error('give --bars or --seconds, not both: bars set their own length');
      const tailSeconds = Number(args.tail ?? 0);
      if (!(tailSeconds >= 0)) throw new Error(`--tail must be seconds, 0 or more, not ${args.tail}`);
      printFit(fitProjectMusicTrack(resolveStudioProject(args.project), { name: args.name, as, shape: { bars: parseMusicBars(args.bars), tailSeconds } }));
      return;
    }
    if (args.tail !== undefined) throw new Error('--tail goes with --bars');
    if (args.seconds !== undefined) {
      const seconds = Number(args.seconds);
      if (!(seconds > 0)) throw new Error(`--seconds must be a positive number, not ${args.seconds}`);
      printFit(fitProjectMusicTrack(resolveStudioProject(args.project), { name: args.name, as, shape: { seconds } }));
      return;
    }
    const { openStudioRenderSession } = await import('../project-arg.ts');
    const session = await openStudioRenderSession(args.project);
    const timeline = await session.readTimeline();
    const result = fitProjectMusicTrack(session.project, { name: args.name, as, shape: { seconds: timeline.durationInFrames / timeline.fps } });
    printFit(result);
    const moments = [
      ...timeline.scenes.filter((s) => s.start > 0).map((s) => ({ label: `cut to ${s.id}`, at: s.start })),
      ...timeline.expectations.map((e) => ({ label: `${e.scene}: ${'see' in e ? `see ${e.see}` : `hold ${e.hold}`}`, at: e.start })),
    ].sort((a, b) => a.at - b.at);
    console.log(['', 'Against the downbeats (a report only: nudge a lead or tail, or leave it):', ...formatMusicFitReport(result.track, moments)].join('\n'));

    function printFit({ file, index, track, seamDb, worstSeamDb }: ReturnType<typeof fitProjectMusicTrack>) {
      const { fit } = track;
      const seams = fit.seams.map((at, i) => `${at} (${Number.isNaN(seamDb[i]) ? 'unmeasured' : `${seamDb[i]} dB`})`);
      console.log([
        file,
        index,
        `music.${as}: ${track.duration} s from music.${fit.source}, ${track.lufs} LUFS`,
        `spans (source s): ${fit.spans.map((s) => `${s.from}–${s.to}`).join(', ')}`,
        `seams (this track s, how far apart its sides sound per band): ${seams.length ? `${seams.join(', ')}; the worst ${worstSeamDb} dB` : 'none'}`,
        `downbeats are a guess from bass hits and chord changes; confirm by ear that ${fit.downbeats[0]} s is a beat 1`,
      ].join('\n'));
    }
  },
});

/** `1-3,3,4,8-13` as the bars it lists, in order: [1, 2, 3, 3, 4, 8, 9, 10, 11, 12, 13]. */
function parseMusicBars(list: string): number[] {
  return list.split(',').flatMap((part) => {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) throw new Error(`--bars is bar numbers and ranges like 1-3,3,4,8-13, not ${list}`);
    const [from, to] = [Number(m[1]), Number(m[2] ?? m[1])];
    if (to < from) throw new Error(`--bars range ${part.trim()} runs backwards`);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  });
}

export default defineCommand({
  meta: { name: 'music', description: "Music tracks for a project: `add` one or `gen` one with Lyria, then `fit` it to the video's length." },
  subCommands: { add, gen, fit },
});
