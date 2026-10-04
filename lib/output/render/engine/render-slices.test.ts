// A join reads its timeline from the slices' snapshots, so each slice's clock must be the project's now: a cue moved
// in a later bar since one slice rendered leaves that slice's picture off the mix made now, however alike the rest.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import { defineTimeline, fixedSpan, timelineClockTable } from '#lib/timing/timeline/models/timeline.ts';
import { joinedRenderSlices, type RenderSlice } from './render-slices.ts';

const timeline: TimelineReport = {
  title: 'bars', fps: 30, width: 1920, height: 1080, transparent: false, duration: 2, durationInFrames: 60, scenes: [], cues: [], crossfades: [], expectations: [], sfxCueList: false, beatClicks: false, sounds: [], captions: null,
};
const clockWithCue = (at: number) => timelineClockTable(defineTimeline({ scenes: { one: fixedSpan(1), two: fixedSpan(1, { cues: { hit: at } }) } }));
const gpu = 'ANGLE (Apple M1 Max); WebGPU apple metal-3';

test("a slice rendered on another clock than the project's now is refused, naming it, though the first is current", () => {
  const now = clockWithCue(0.5), before = clockWithCue(0.25);
  const slice = (name: string, from: number, clock: RenderSlice['clock']): RenderSlice => ({ name, from, end: from + 30, timeline, clock, gpu });
  const current = [slice('01.lossless.mkv', 0, now), slice('02.lossless.mkv', 30, now)];
  assert.equal(joinedRenderSlices(current, { dir: 'bars', clock: now }).timeline, timeline);
  assert.throws(() => joinedRenderSlices([current[0], slice('02.lossless.mkv', 30, before)], { dir: 'bars', clock: now }), {
    message: "02.lossless.mkv (frames 30–59) was rendered on another clock than the project's now (a retime moves every later bar and cue): render it again",
  });
});
