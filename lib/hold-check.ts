// hold-check.ts: a scene's `expect: [{ hold }]` against its motion tracks (lib/motion-tracks.ts). Pure;
// lib/render-pipeline.ts measures the frames and prints what comes back.
//
// A contract check, not a style rule: it tests only what a scene declares. It passes when the subject stays steady
// (every channel within tolerance) and visible for the declared time somewhere inside the declared span, and when it
// fails it names the channel that broke the longest steady stretch, when, and by how much.
//
// It says "steady and visible", never "readable": a still, opaque element can still be too small or too faint, and
// only a person looking can tell.
import { motionCurves } from './studio/motion.ts';
import type { TimelineReport } from './studio/Video.tsx';
import type { MotionTracks } from './motion-tracks.ts';

export type HoldExpectation = { scene: string; hold: string; for: number; within?: number; start: number; end: number };
export type HoldProblem = { from: number; to: number; scene: string; problem: string };

// Past these a viewer's eye is still on the move: a camera's zoom off by 0.5% shifts a 1920px frame's edges ~5px.
const DEFAULT_WITHIN_PX = 2;
const VALUE_SHARE = 0.005;
const VISIBLE_OPACITY = 0.95;

type Frame =
  | { shown: false; why: string }
  | { shown: true; channels: Record<string, number | null> };

/** What a frame of `id` is: why it can't be seen, or its channels (screen box and reported values). */
function framesOf(motion: MotionTracks, timeline: Pick<TimelineReport, 'crossfades'>, id: string, scene: string, from: number, to: number): Frame[] {
  const track = motion.tracks.find((t) => t.id === id)!;
  // The next scene is painted over this one as it dissolves in, so what it covers is its dissolve's alpha.
  const fadeOut = timeline.crossfades.find((c) => c.from === scene);
  const covered = (t: number) => (fadeOut && t >= fadeOut.start ? motionCurves.dissolve((t - fadeOut.start) / (fadeOut.end - fadeOut.start)) : 0);
  return Array.from({ length: to - from + 1 }, (_, i): Frame => {
    const f = from + i;
    const seg = track.segments.find((s) => s.start <= f && f <= s.end);
    if (!seg) return { shown: false, why: 'isn\'t drawn' };
    const k = f - seg.start;
    const opacity = seg.screen.opacity[k] * (seg.phase === 'out' ? 1 - covered(f / motion.fps) : 1);
    if (opacity < VISIBLE_OPACITY) {
      return { shown: false, why: seg.phase === 'out' && seg.screen.opacity[k] >= VISIBLE_OPACITY ? 'is under the next scene\'s crossfade' : `is ${Math.round(opacity * 100)}% opaque` };
    }
    const { x, y, w, h } = seg.screen;
    return { shown: true, channels: { x: x[k], y: y[k], width: w[k], height: h[k], ...Object.fromEntries(Object.entries(seg.values).map(([n, v]) => [n, v[k]])) } };
  });
}

const BOX_CHANNELS = ['x', 'y', 'width', 'height'];

/** What stops a stretch from being steady: a channel moving too far across it, or the subject not being seen. */
type HoldBreak = { channel: string; moved: number; tolerance: string } | { why: string };

/** The steady stretch starting at frame `i`: its last frame, and what ends it (null if it runs to the last frame). */
function steadyFrom(frames: readonly Frame[], i: number, withinPx: number): { last: number; ends: HoldBreak | null } {
  const range = new Map<string, { lo: number; hi: number }>();
  for (let j = i; j < frames.length; j++) {
    const f = frames[j];
    if (!f.shown) return { last: j - 1, ends: { why: f.why } };
    const names = new Set([...Object.keys(f.channels), ...range.keys()]);
    for (const name of names) {
      const v = f.channels[name];
      if (v === null || v === undefined || (j > i && !range.has(name))) return { last: j - 1, ends: { why: `doesn't report its ${name} throughout` } };
      const r = range.get(name) ?? { lo: v, hi: v };
      [r.lo, r.hi] = [Math.min(r.lo, v), Math.max(r.hi, v)];
      range.set(name, r);
      const box = BOX_CHANNELS.includes(name);
      const limit = box ? withinPx : VALUE_SHARE * Math.max(1, Math.abs(r.lo), Math.abs(r.hi));
      if (r.hi - r.lo > limit + 1e-9) return { last: j - 1, ends: { channel: name, moved: r.hi - r.lo, tolerance: box ? `${withinPx}px` : `${+limit.toPrecision(2)}` } };
    }
  }
  return { last: frames.length - 1, ends: null };
}

const describe = (b: HoldBreak) =>
  'why' in b ? `it ${b.why}` : `its ${b.channel} moves ${+b.moved.toFixed(b.moved < 10 ? 2 : 1)}${BOX_CHANNELS.includes(b.channel) ? 'px' : ''} (holds within ${b.tolerance})`;

/**
 * Each hold that isn't kept, as a problem over its span. `project` names it in the `studio look` command a problem
 * points at. A hold wholly outside the measured frames is skipped; one partly inside them is listed in `unchecked`,
 * since a stretch that starts or ends outside can't be judged.
 */
export function holdProblems(motion: MotionTracks, timeline: Pick<TimelineReport, 'crossfades'>, holds: readonly HoldExpectation[], project: string): { problems: HoldProblem[]; unchecked: string[] } {
  const { fps } = motion;
  const problems: HoldProblem[] = [], unchecked: string[] = [];
  const secs = (f: number) => `${(f / fps).toFixed(2)}s`;
  for (const h of holds) {
    if (!(h.for > 0) || !(h.within === undefined || h.within >= 0)) throw new Error(`scene ${h.scene}: hold "${h.hold}" needs a positive \`for\` and a \`within\` of 0 or more`);
    const id = `${h.scene}/${h.hold}`, span = `${h.start.toFixed(2)}–${h.end.toFixed(2)}s`;
    const from = Math.ceil(h.start * fps - 1e-6), to = Math.ceil(h.end * fps) - 1, need = Math.ceil(h.for * fps - 1e-6);
    if (to < motion.frames.first || from > motion.frames.last) continue;
    if (from < motion.frames.first || to > motion.frames.last) {
      unchecked.push(`hold "${h.hold}" [${h.scene}] (${span}) runs outside the checked frames`);
      continue;
    }
    const fail = (problem: string) => problems.push({ from: h.start, to: h.end, scene: h.scene, problem: `expected "${h.hold}" to hold steady and visible for ${h.for}s (expect hold, ${span}): ${problem}` });
    if (need > to - from + 1) {
      fail(`the span is only ${((to - from + 1) / fps).toFixed(2)}s`);
      continue;
    }
    if (!motion.tracks.some((t) => t.id === id)) {
      const shared = motion.coverage.ambiguous.some((a) => a.id === id);
      const tracked = motion.tracks.filter((t) => t.scene === h.scene).map((t) => t.id.slice(h.scene.length + 1));
      fail(shared
        ? 'it isn\'t tracked: several elements share that name, which the library picked; give the one to hold its own `motion` name'
        : `it isn't tracked: tag it with data-motion or a \`motion\` prop${tracked.length ? ` (tracked in ${h.scene}: ${tracked.join(', ')})` : ''}`);
      continue;
    }

    const frames = framesOf(motion, timeline, id, h.scene, from, to);
    const within = h.within ?? DEFAULT_WITHIN_PX;
    // The longest steady stretch, grown from each frame until something breaks it.
    let best: { first: number; last: number; ends: HoldBreak | null } | null = null;
    for (let i = 0; i < frames.length && !(best && best.last - best.first + 1 >= need); i++) {
      const run = steadyFrom(frames, i, within);
      if (run.last >= i && (!best || run.last - i > best.last - best.first)) best = { first: i, ...run };
    }
    if (best && best.last - best.first + 1 >= need) continue;

    const review = `Review: studio look ${project} --graph=${h.start.toFixed(2)}:${h.end.toFixed(2)} --tracks=${id}`;
    if (!best) {
      const whys = [...new Set(frames.map((f) => (f.shown ? '' : f.why)))].filter(Boolean);
      fail(`it's never steady and visible: it ${whys.join(', then ')}. ${review}`);
      continue;
    }
    const [a, b] = [from + best.first, from + best.last];
    // Stepping back one frame finds what was moving into the stretch.
    const before = best.first > 0 ? steadyFrom(frames.slice(best.first - 1, best.last + 1), 0, within).ends : null;
    fail([
      `it is for ${((b - a + 1) / fps).toFixed(2)}s at most, ${(a / fps).toFixed(2)}–${secs(b + 1)}.`,
      before && `Into it, ${describe(before)};`,
      best.ends ? `at ${secs(b + 1)} ${describe(best.ends)}.` : 'it runs to the end of the span.',
      review,
    ].filter(Boolean).join(' '));
  }
  return { problems, unchecked };
}
