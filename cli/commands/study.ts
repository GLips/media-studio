// studio study: slice a reference video (a reel to learn from, not one of ours) into what a frame-by-frame study needs.
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'study',
    description: 'Study a reference video: its cuts against the beat, and per section a dense strip of frames, a sheet, the motion vectors drawn on frames, a per-frame plot of motion energy, cut scores, colour and loudness, and each section\'s palette. Writes them with index.md beside the video (study/, cleared first) and prints index.md. Open the images with the Read tool.',
  },
  args: {
    video: { type: 'positional', required: true, description: 'The video file' },
    at: { type: 'string', valueHint: '0:16', description: 'Study only this stretch of seconds; its audio alone sets the beat grid (a reel of reels changes track)' },
    sections: { type: 'string', valueHint: '0:2.5,2.5:5', description: 'Sections in seconds (default: the stretches between cuts, none under 1.2 s)' },
    bpm: { type: 'string', description: 'Lay the beat grid at this tempo, phased to the detected beats (default: the detected tempo)' },
    'strip-fps': { type: 'string', default: '15', description: 'Frames per second in each section\'s strip' },
    out: { type: 'string', description: 'Output directory (default: study/ beside the video)' },
  },
  async run({ args }) {
    const { dirname, join, resolve } = await import('node:path');
    const { existsSync } = await import('node:fs');
    const video = resolve(args.video);
    if (!existsSync(video)) throw new Error(`no video at ${video}`);
    const bpm = args.bpm === undefined ? undefined : Number(args.bpm);
    if (bpm !== undefined && !(bpm >= 40 && bpm <= 240)) throw new Error(`--bpm is a tempo like 128, not ${args.bpm}`);
    const stripFps = Number(args['strip-fps']);
    if (!(stripFps > 0 && stripFps <= 60)) throw new Error(`--strip-fps is frames per second like 15, not ${args['strip-fps']}`);
    const at = args.at?.split(':').map(Number);
    if (at && !(at.length === 2 && at.every(Number.isFinite) && at[0] < at[1])) throw new Error(`--at is a stretch of seconds like 0:16, not ${args.at}`);
    const { studyReel } = await import('../../lib/reel-study-files.ts');
    console.log(await studyReel(video, { at: at && [at[0], at[1]], sections: args.sections, bpm, stripFps, out: resolve(args.out ?? join(dirname(video), 'study')) }));
  },
});
