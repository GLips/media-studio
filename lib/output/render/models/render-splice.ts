// render-splice.ts: whether a slice can be laid into a cut over its own frames, so the review page plays the cut with
// the slice's picture in that span, under the cut's sound. Pure: it compares the two snapshots' timelines cut to the
// slice's span, so nothing new is stored.
//
// Only what overlaps the span matters: a later scene growing moves frames past it, which the slice never shows. What
// must hold inside it is everything the cut's sound and picture line up on: scene edges and crossfades, voice lines
// and their words, and on a timed project the clock's bars and cues. Sound effects may differ: the slice is then laid
// in picture only, under the cut's (older) effects.
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import { renderSnapshotIsCut, type RenderSnapshot } from './render-snapshot-model.ts';

/**
 * Where slices go unless --out says, inside the project. Only for tidiness: a slice is told from a cut by its
 * snapshot's frames, never by its folder.
 */
export const RENDER_SLICES_DIR = 'out/wip/slices';

/** What a slice holds: frames `from`–`end` (exclusive), or one scene's frames on screen, its crossfades included. */
export type RenderSliceSpan = { from: number; end: number } | { scene: string };

/**
 * The frames `span` names on `timeline`, `end` exclusive: a scene's are those it's on screen, its crossfades either
 * side included. `studio render --scene` renders these and `studio check --scene` checks them.
 */
export function renderSliceFramesOf(timeline: Pick<TimelineReport, 'scenes' | 'durationInFrames'>, span: RenderSliceSpan): { from: number; end: number } {
  if (!('scene' in span)) return span;
  const scene = timeline.scenes.find((s) => s.id === span.scene);
  if (!scene) throw new Error(`there's no scene "${span.scene}": ${timeline.scenes.map((s) => s.id).join(', ')}`);
  return { from: Math.max(0, scene.visible.from), end: Math.min(timeline.durationInFrames, scene.visible.to) };
}

/** A slice's path in the project when --out doesn't name one: `scene-<id>.mp4` or `frames-<a>-<b>.mp4` (b inclusive). */
export const renderSlicePathOf = (span: RenderSliceSpan) =>
  `${RENDER_SLICES_DIR}/${'scene' in span ? `scene-${span.scene}` : `frames-${span.from}-${span.end - 1}`}.mp4`;

/**
 * The reply that hands the slice at `path` over for note `id` (`<id>` when the agent fills it in), once the fix is
 * committed. The render CLI and watch's `fix:` line both print it.
 */
export const formatSliceReplyCommand = (project: string, id: number | '<id>', path: string) =>
  `studio review reply ${project} ${id} "<what changed>" --addressed --commit HEAD --render ${path}`;

/** What the check reads of a render: when it started, the frames it holds, whether it has captions, its timeline and clock. */
export type RenderSpliceSide = Pick<RenderSnapshot, 'started' | 'frames' | 'captions' | 'timeline' | 'clock'>;

/**
 * What the review page does with a render a reply names, given the cut it shows: `cut`, the render is itself one;
 * `retired`, it started no later than the cut, which is the newer picture; `refused`, it plays alone, `refusal` saying
 * why (a clause after "won't splice:"); `laid`, it's laid in, under the cut's sound effects when `pictureOnly`.
 */
export type RenderSpliceVerdict =
  | { kind: 'cut' } | { kind: 'retired' } | { kind: 'refused'; refusal: string } | { kind: 'laid'; pictureOnly: boolean };

/**
 * The one decision on laying `render` into `cut`, which the render CLI, reply and the review page all read. "Newer" is
 * a later start: a render reads its sources as it bundles, so an edit saved while one draws may slip in. A heuristic,
 * accepted rather than freezing inputs.
 */
export function renderSpliceVerdictOf(cut: RenderSpliceSide, render: RenderSpliceSide): RenderSpliceVerdict {
  if (renderSnapshotIsCut(render)) return { kind: 'cut' };
  if (!(render.started > cut.started)) return { kind: 'retired' };
  const refusal = renderSpliceRefusal(cut, render);
  return refusal === null ? { kind: 'laid', pictureOnly: renderSplicePictureOnly(cut, render) } : { kind: 'refused', refusal };
}

type FrameSpan = { from: number; end: number };

const overlaps = (span: FrameSpan, from: number, to: number) => from < span.end && to > span.from;
const secondsOverlap = (span: FrameSpan, fps: number, start: number, end: number) => overlaps(span, Math.floor(start * fps), Math.ceil(end * fps));
const frameRange = (from: number, to: number) => `f${from}–f${to - 1}`;

function renderSpliceRefusal(cut: RenderSpliceSide, slice: RenderSpliceSide): string | null {
  const span = slice.frames, c = cut.timeline, s = slice.timeline;
  if (cut.frames.end < span.end) return `the cut ends at f${cut.frames.end - 1}, before the slice's ${frameRange(span.from, span.end)}`;
  // A slice is opaque H.264: laid over a transparent cut, its span would show a solid ground where the cut has none.
  if (c.transparent || s.transparent) return 'a transparent video\'s slice is opaque, so it would hide the cut\'s alpha';
  if (cut.captions !== slice.captions) return `the cut ${cut.captions ? 'has' : 'has no'} captions burned in and the slice ${slice.captions ? 'has' : 'hasn\'t'}`;
  if (c.fps !== s.fps) return `the slice is ${s.fps} fps and the cut ${c.fps}`;
  if (c.width !== s.width || c.height !== s.height) return `the slice is ${s.width}×${s.height} and the cut ${c.width}×${c.height}`;
  return sceneRefusal(c, s, span) ?? crossfadeRefusal(c, s, span) ?? lineRefusal(c, s, span) ?? clockRefusal(cut, slice, span);
}

function renderSplicePictureOnly(cut: RenderSpliceSide, slice: RenderSpliceSide): boolean {
  const span = slice.frames, fps = slice.timeline.fps;
  const soundsIn = (t: TimelineReport) => t.sounds.filter((x) => secondsOverlap(span, fps, x.at, x.at)).map((x) => `${x.id}@${x.at}:${x.sound}`).toSorted();
  return soundsIn(cut.timeline).join('\n') !== soundsIn(slice.timeline).join('\n');
}

function sceneRefusal(cut: TimelineReport, slice: TimelineReport, span: FrameSpan): string | null {
  const shown = (t: TimelineReport) => t.scenes.filter((x) => overlaps(span, x.visible.from, x.visible.to));
  const ids = [...new Set([...shown(slice), ...shown(cut)].map((x) => x.id))];
  for (const id of ids) {
    const before = cut.scenes.find((x) => x.id === id), now = slice.scenes.find((x) => x.id === id);
    if (!before) return `scene ${id} is new since the cut`;
    if (!now) return `scene ${id} is gone since the cut`;
    if (now.to - now.from !== before.to - before.from) return `scene ${id} is ${now.to - now.from} frames now, ${before.to - before.from} in the cut`;
    if (now.visible.from !== before.visible.from || now.visible.to !== before.visible.to) {
      return `scene ${id} shows ${frameRange(now.visible.from, now.visible.to)} now, ${frameRange(before.visible.from, before.visible.to)} in the cut`;
    }
  }
  return null;
}

type Crossfade = TimelineReport['crossfades'][number];
const sameCrossfade = (a: Crossfade, b: Crossfade) => a.from === b.from && a.to === b.to && a.start === b.start && a.end === b.end;

function crossfadeRefusal(cut: TimelineReport, slice: TimelineReport, span: FrameSpan): string | null {
  const within = (t: TimelineReport) => t.crossfades.filter((x) => secondsOverlap(span, t.fps, x.start, x.end));
  for (const now of within(slice)) if (!cut.crossfades.some((x) => sameCrossfade(x, now))) return `the crossfade from ${now.from} to ${now.to} isn't where it is in the cut`;
  for (const before of within(cut)) if (!slice.crossfades.some((x) => sameCrossfade(x, before))) return `the crossfade from ${before.from} to ${before.to} has moved since the cut`;
  return null;
}

function lineRefusal(cut: TimelineReport, slice: TimelineReport, span: FrameSpan): string | null {
  const within = (t: TimelineReport) => t.cues.filter((x) => secondsOverlap(span, t.fps, x.start, x.end));
  const ids = [...new Set([...within(slice), ...within(cut)].map((x) => x.id))];
  for (const id of ids) {
    const before = cut.cues.find((x) => x.id === id), now = slice.cues.find((x) => x.id === id);
    if (!before || !now) return `line ${id} is ${before ? 'gone' : 'new'} since the cut, so the cut's voice wouldn't match`;
    if (now.start !== before.start || now.end !== before.end) return `line ${id} is spoken at ${now.start.toFixed(2)}–${now.end.toFixed(2)} s now, ${before.start.toFixed(2)}–${before.end.toFixed(2)} s in the cut`;
    if (now.text !== before.text || JSON.stringify(now.words) !== JSON.stringify(before.words)) return `line ${id}'s words have changed since the cut`;
  }
  return null;
}

function clockRefusal(cut: RenderSpliceSide, slice: RenderSpliceSide, span: FrameSpan): string | null {
  if (!cut.clock && !slice.clock) return null;
  if (!cut.clock || !slice.clock) return `the ${slice.clock ? 'cut' : 'slice'} was made with no timeline.ts clock`;
  const before = cut.clock, now = slice.clock;
  const bars = [...new Set([...now.bars, ...before.bars].filter((b) => overlaps(span, b.visible.from, b.visible.to)).map((b) => b.id))];
  for (const id of bars) {
    const a = before.bars.find((b) => b.id === id), b = now.bars.find((x) => x.id === id);
    if (JSON.stringify(a) !== JSON.stringify(b)) return `bar ${b?.n ?? a?.n} (${id})'s beats, cues or lines have moved on the clock since the cut`;
  }
  const cuesIn = (cues: Record<string, number>) => Object.entries(cues).filter(([, at]) => at >= span.from && at < span.end).map(([name, at]) => `${name}@${at}`).toSorted();
  const moved = cuesIn(now.cues).filter((x) => !cuesIn(before.cues).includes(x)).concat(cuesIn(before.cues).filter((x) => !cuesIn(now.cues).includes(x)));
  return moved.length ? `cue ${moved[0].split('@')[0]} has moved since the cut` : null;
}
