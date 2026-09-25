// bar-clock.ts: the reel's clock as JSON, for the tools that aren't TypeScript (join-bars.sh, attacks.py) and
// `studio look --bar`/`--motion`: each bar's frames as the bars export them, every beat's hit frame, the fade and the end.
// timeline.ts's bar table is the one statement of the reel's structure, so no tool writes a frame number of its own.
//   node projects/2026-09-motion-showcase/tools/bar-clock.ts
import '../../../lib/studio/tsx-test-hooks.ts';
import type { Bar } from '../bar.ts';

const { FPS } = await import('../../../lib/studio/api.ts');
const { showcaseBars }: { showcaseBars: Bar[] } = await import('../video.tsx');
const { BAR_TABLE, END_FRAME, FADE_TO_BLACK, barBeatFrame, barStartBeat, grid, track } = await import('../timeline.ts');

// Bar 1 opens on a pickup, so the video's first beats come before its downbeat (beat 0).
const beats: number[] = [];
for (let n = -4; barBeatFrame(1, n) < END_FRAME; n++) if (barBeatFrame(1, n) >= 0) beats.push(barBeatFrame(1, n));

// Which beat of the music's own bar each bar cuts in on, 1 being its downbeat: a bar off the downbeat moves every
// later cut off it too, unless another bar makes up the difference. The tracker's downbeats wander off the steady
// grid by up to a quarter beat (drive's bar 3 by 0.126 s), so each is taken as its nearest beat.
const downbeats = track.fit.downbeats.map((t: number) => Math.round(grid.beatOf(t)));
const musicBeatOf = (beat: number) => Math.round((beat - downbeats.filter((d: number) => d <= beat + 0.1).at(-1)! + 1) * 4) / 4;

console.log(JSON.stringify({
  fps: FPS, end: END_FRAME, fade: FADE_TO_BLACK, beats,
  bars: showcaseBars.map((bar, i) => {
    const { beats: length, cutIn = 0 } = BAR_TABLE[i];
    return { n: i + 1, id: bar.id, from: bar.from, to: bar.to, beats: length, musicBeat: musicBeatOf(barStartBeat(i + 1) + cutIn) };
  }),
}));
