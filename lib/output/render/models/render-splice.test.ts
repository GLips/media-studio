// A slice lays into a cut only where everything the cut's sound and picture line up on is the same inside its span;
// what moved outside it doesn't matter.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import { defineTimeline, fixedSpan, timelineClockTable } from '#lib/timing/timeline/models/timeline.ts';
import { renderSpliceVerdictOf, type RenderSpliceSide } from './render-splice.ts';

type Seconds = { intro: number; ink: number; outro: number };

/**
 * A render of three fixed scenes (30 fps), `ink` crossfading in over `fade` s, with a line spoken at `lineAt` s,
 * started at `started` with captions burned in unless `captions` is false.
 */
function renderOf({ intro, ink, outro }: Seconds, { fade = 0.4, lineAt = 3.2, captions = true, started = '2026-10-11T12:05:00.000Z' } = {}): RenderSpliceSide {
  const clock = timelineClockTable(defineTimeline({ scenes: { intro: fixedSpan(intro), ink: fixedSpan(ink, { crossfade: fade }), outro: fixedSpan(outro) } }));
  const fps = clock.fps, at = (frame: number) => frame / fps;
  const scenes = clock.bars.map((b) => ({ id: b.id, from: b.from, to: b.to, visible: b.visible, start: at(b.from), dur: at(b.to - b.from), lines: [] }));
  const crossfades = clock.bars.slice(1).flatMap((b, k) => (b.visible.from < b.from ? [{ from: clock.bars[k].id, to: b.id, start: at(b.visible.from), end: at(clock.bars[k].visible.to) }] : []));
  const timeline: TimelineReport = {
    title: 'splice', fps, width: 1920, height: 1080, transparent: false, duration: at(clock.end), durationInFrames: clock.end, scenes, crossfades,
    cues: [{ id: 'ink-1', start: lineAt, end: lineAt + 1, text: 'ink it', voiced: true, words: [{ text: 'ink', start: lineAt, end: lineAt + 0.4 }, { text: 'it', start: lineAt + 0.5, end: lineAt + 1 }] }],
    captions: null, expectations: [], sfxCueList: false, beatClicks: false, sounds: [],
  };
  return { started, frames: { from: 0, end: clock.end }, captions, timeline, clock };
}

const lengths: Seconds = { intro: 2, ink: 3, outro: 2 };
const cut = renderOf(lengths, { started: '2026-10-11T12:00:00.000Z' });
/** `ink`'s slice as `studio render --scene ink` makes it: its visible frames, crossfades included. */
const inkSliceOf = (side: RenderSpliceSide): RenderSpliceSide => {
  const { visible } = side.timeline.scenes.find((s) => s.id === 'ink')!;
  return { ...side, frames: { from: visible.from, end: visible.to } };
};
/** Why the slice won't lay into the cut, or null when it's laid in. */
const refusalOf = (slice: RenderSpliceSide) => {
  const verdict = renderSpliceVerdictOf(cut, slice);
  return verdict.kind === 'laid' ? null : verdict.kind === 'refused' ? verdict.refusal : verdict.kind;
};

test('a slice of a scene rendered on the same timeline splices', () => {
  assert.equal(refusalOf(inkSliceOf(renderOf(lengths))), null);
});

test("a slice whose scene's length changed is refused, naming the scene and both lengths", () => {
  assert.equal(refusalOf(inkSliceOf(renderOf({ ...lengths, ink: 3.4 }))), 'scene ink is 102 frames now, 90 in the cut');
});

test('a slice whose line moved is refused: the cut\'s voice would no longer match its picture', () => {
  assert.match(refusalOf(inkSliceOf(renderOf(lengths, { lineAt: 3.5 }))) ?? '', /^line ink-1 is spoken at 3\.50/);
});

test("a later scene's length changing leaves the slice splicing: only what overlaps its span matters", () => {
  assert.equal(refusalOf(inkSliceOf(renderOf({ ...lengths, outro: 3 }))), null);
});

test("a neighbour's crossfade into the scene moving is refused", () => {
  assert.notEqual(refusalOf(inkSliceOf(renderOf(lengths, { fade: 0.8 }))), null);
});

test('a slice drawn without the captions the cut burns in is refused, and one started before the cut is retired by it', () => {
  assert.match(refusalOf(inkSliceOf(renderOf(lengths, { captions: false }))) ?? '', /captions/);
  assert.equal(refusalOf(inkSliceOf(renderOf(lengths, { started: '2026-10-11T11:00:00.000Z' }))), 'retired');
});
