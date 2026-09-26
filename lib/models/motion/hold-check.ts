// hold-check.ts: a scene's `expect: [{ hold }]` against its motion tracks (lib/models/motion/motion-tracks.ts). Pure;
// lib/engine/render/render-pipeline.ts measures the frames and prints what comes back.
//
// A contract check, not a style rule: it tests only what a scene declares. It passes when the subject stays steady
// (every channel within tolerance) and visible for the declared time somewhere inside the declared span, and when it
// fails it names the channel that broke the longest steady stretch, when, and by how much.
//
// It says "steady and visible", never "readable": a still, opaque element can still be too small or too faint, and
// only a person looking can tell.
import { motionCurves } from './motion.ts';
import type { TimelineReport } from '#studio/composition/Video.tsx';
import type { MotionTracks } from './motion-tracks.ts';

export type HoldExpectation = { scene: string; hold: string; for: number; within?: number; start: number; end: number };
/** Seconds, end exclusive. */
export type HoldSteadySpan = { from: number; to: number };
/** `steady` is the longest stretch the subject was steady and visible, or null if it never was or wasn't measured. */
export type HoldProblem = { from: number; to: number; scene: string; problem: string; steady: HoldSteadySpan | null };

// Past these a viewer's eye is still on the move: a camera's zoom off by 0.5% shifts a 1920px frame's edges ~5px.
const DEFAULT_WITHIN_PX = 2;
const VALUE_SHARE = 0.005;
const VISIBLE_OPACITY = 0.95;

type Frame =
  | { shown: false; why: string; opacity?: number }
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
      return seg.phase === 'out' && seg.screen.opacity[k] >= VISIBLE_OPACITY
        ? { shown: false, why: 'is under the next scene\'s crossfade' }
        : { shown: false, why: `is ${Math.round(opacity * 100)}% opaque`, opacity };
    }
    const { x, y, w, h } = seg.screen;
    return { shown: true, channels: { x: x[k], y: y[k], width: w[k], height: h[k], ...Object.fromEntries(Object.entries(seg.values).map(([n, v]) => [n, v[k]])) } };
  });
}

const BOX_CHANNELS = ['x', 'y', 'width', 'height'];
// A camera's pan is page pixels, which its zoom magnifies on screen.
const PAGE_CHANNELS = ['cx', 'cy'];

/** How far a channel may move and still hold, and the unit to say it in. */
function toleranceFor(name: string, r: { lo: number; hi: number }, withinPx: number, zoom: number | null | undefined): { limit: number; unit: string } {
  if (BOX_CHANNELS.includes(name)) return { limit: withinPx, unit: 'px' };
  if (PAGE_CHANNELS.includes(name)) return { limit: withinPx / Math.max(1, zoom ?? 1), unit: ' page px' };
  return { limit: VALUE_SHARE * Math.max(1, Math.abs(r.lo), Math.abs(r.hi)), unit: '' };
}

/** What stops a stretch from being steady: a channel moving too far across it, or the subject not being seen. */
type HoldBreak = { channel: string; moved: number; limit: number; unit: string } | { why: string };

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
      const { limit, unit } = toleranceFor(name, r, withinPx, f.channels.zoom);
      if (r.hi - r.lo > limit + 1e-9) return { last: j - 1, ends: { channel: name, moved: r.hi - r.lo, limit, unit } };
    }
  }
  return { last: frames.length - 1, ends: null };
}

const amount = (v: number, unit: string) => `${+v.toFixed(v < 10 ? 2 : 1)}${unit}`;
const describe = (b: HoldBreak) =>
  'why' in b ? `it ${b.why}` : `its ${b.channel} moves ${amount(b.moved, b.unit)} (holds within ${amount(b.limit, b.unit)})`;

/**
 * Each hold that isn't kept, as a problem over its span, and how many were checked. `project` names it in the
 * `studio look` command a problem points at. A hold wholly outside the measured frames is skipped. One partly inside
 * them passes if it's kept on the measured part, and is listed in `unchecked` if not, since it may be kept outside.
 */
export function holdProblems(motion: MotionTracks, timeline: Pick<TimelineReport, 'crossfades'>, holds: readonly HoldExpectation[], project: string): { problems: HoldProblem[]; unchecked: string[]; checked: number } {
  const { fps } = motion;
  const problems: HoldProblem[] = [], unchecked: string[] = [];
  let checked = 0;
  const secs = (f: number) => `${(f / fps).toFixed(2)}s`;
  for (const h of holds) {
    const id = `${h.scene}/${h.hold}`, span = `${h.start.toFixed(2)}–${h.end.toFixed(2)}s`;
    // The frames shown within [start, end), as checkedFrames counts them; the epsilons absorb float sums like 0.1 + 0.2.
    const whole = { from: Math.ceil(h.start * fps - 1e-6), to: Math.ceil(h.end * fps - 1e-6) - 1 }, need = Math.ceil(h.for * fps - 1e-6);
    if (whole.to < motion.frames.first || whole.from > motion.frames.last) continue;
    const from = Math.max(whole.from, motion.frames.first), to = Math.min(whole.to, motion.frames.last);
    const partial = from !== whole.from || to !== whole.to;
    const fail = (problem: string, steady: HoldSteadySpan | null = null) => {
      if (partial) unchecked.push(`hold "${h.hold}" [${h.scene}] (${span}) isn't kept in the checked frames, and runs outside them`);
      else problems.push({ from: h.start, to: h.end, scene: h.scene, problem: `expected "${h.hold}" to hold steady and visible for ${h.for}s (expect hold, ${span}): ${problem}`, steady });
    };
    if (!partial) checked++;
    if (need > whole.to - whole.from + 1) {
      fail(`the span is only ${((whole.to - whole.from + 1) / fps).toFixed(2)}s`);
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
    if (best && best.last - best.first + 1 >= need) {
      if (partial) checked++;
      continue;
    }

    const review = `Review: studio look ${project} --graph=${h.start.toFixed(2)}:${h.end.toFixed(2)} --tracks=${id}`;
    if (!best) {
      const faint = frames.filter((f) => !f.shown && f.opacity !== undefined).map((f) => (f.shown ? 0 : f.opacity!));
      const whys = [...new Set(frames.map((f) => (f.shown ? '' : f.opacity !== undefined ? `never gets past ${Math.round(Math.max(...faint) * 100)}% opaque` : f.why)))];
      fail(`it's never steady and visible: it ${whys.filter(Boolean).join(', and ')}. ${review}`);
      continue;
    }
    const [a, b] = [from + best.first, from + best.last];
    fail([
      `it is for ${((b - a + 1) / fps).toFixed(2)}s at most, ${(a / fps).toFixed(2)}–${secs(b + 1)}.`,
      best.first > 0 && `Until ${secs(a)} ${arrival(frames[best.first - 1], frames[best.first], steadyFrom(frames.slice(best.first - 1, best.last + 1), 0, within).ends!)};`,
      best.ends ? `at ${secs(b + 1)} ${describe(best.ends)}.` : 'it runs to the end of the span.',
      review,
    ].filter(Boolean).join(' '), { from: a / fps, to: (b + 1) / fps });
  }
  return { problems, unchecked, checked };
}

/**
 * What the frame before a steady stretch shows: why it wasn't seen, or the channel that kept it out of the stretch
 * and its step into it. The step alone can be under tolerance when it drifts in, so the stretch's own spread is named.
 */
function arrival(prev: Frame, first: Frame, breaks: HoldBreak): string {
  if (!prev.shown || !first.shown || 'why' in breaks) return describe(breaks);
  const step = Math.abs(prev.channels[breaks.channel]! - first.channels[breaks.channel]!);
  return step > breaks.limit
    ? `its ${breaks.channel} is moving (${amount(step, breaks.unit)} in its last frame)`
    : `its ${breaks.channel} drifts (${amount(breaks.moved, breaks.unit)} with the stretch, holds within ${amount(breaks.limit, breaks.unit)})`;
}
