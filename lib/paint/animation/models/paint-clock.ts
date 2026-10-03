// paint-clock.ts: the times a painted animation reads (plan 1's timing contract, phase 3). A play's clock is written
// as parts and compiled into steps evaluated in one fixed order, so no part can be written in an order that means
// something else; the interval it writes over follows from the same parts. A node carries only holds and freezes.
//
// Scene seconds, clip seconds and animation frames are kept apart by type where interval arithmetic crosses them.
//
// Negative space: render fps never enters here. A 30 or 60 fps render samples the same held drawings. The clock's
// rate and frame rule (PAINT_ANIMATION_FPS, paintAnimationFrameAt) are painting's, which a recipe's boil counts on too.

import { paintAnimationFrameAt } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';

/** Seconds of the scene's clock, or of a node's time through its holds and freezes, which steps on the same grid. */
export type SceneSeconds = number & { readonly unit: 'scene seconds' };
/** Seconds of a clip's own time, from 0 at its start. */
export type ClipSeconds = number & { readonly unit: 'clip seconds' };
/** A frame of the animation clock: whole frames at the scene's animation fps. */
export type AnimationFrame = number & { readonly unit: 'animation frames' };

// SAFETY: a brand marks which clock a number was read on; the number is unchanged.
export const sceneSeconds = (seconds: number) => seconds as SceneSeconds;
// SAFETY: as sceneSeconds, for a clip's own time.
export const clipSeconds = (seconds: number) => seconds as ClipSeconds;
// SAFETY: as sceneSeconds, for a whole count of frames.
const animationFrame = (frame: number) => frame as AnimationFrame;

/** The animation frame scene time `t` falls in, by painting's rule. */
export const paintAnimationFrameOf = (t: SceneSeconds, animationFps: number) => animationFrame(paintAnimationFrameAt(t, animationFps));

/** When animation frame `frame` starts, in scene seconds. */
export const paintAnimationFrameStart = (frame: AnimationFrame, animationFps: number) => sceneSeconds(frame / animationFps);

/**
 * A node's clock, read by its writers and its boil inside its ancestors': `hold` shows a new drawing every `hold`
 * animation frames on the scene's grid; `freeze` stops it at scene second `freeze`.
 */
export type PaintNodeClock = { readonly hold: number } | { readonly freeze: number };

/** How a play loops: every `period` clip seconds, repeating or reflecting on odd cycles, `times` cycles or forever. */
export type PaintPlayLoop = { readonly period: number; readonly mode?: 'repeat' | 'pingpong'; readonly times?: number };

/**
 * A play's clock, as parts: its clip starts at scene second `at`, runs `rate` times as fast, loops by `loop`, and
 * shows a new drawing every `hold` frames on the scene's grid; or shows clip second `freeze` throughout. It writes
 * until `until` if given, then holds that drawing. Before `at` it reads clip time 0; a finished clip, its end.
 */
export type PaintPlayClock = { readonly at: number; readonly hold?: number; readonly until?: number } & (
  | { readonly rate?: number; readonly loop?: PaintPlayLoop; readonly freeze?: never }
  | { readonly freeze: number; readonly rate?: never; readonly loop?: never }
);

/** A step on scene time, outermost first: a node's holds and freezes, then its play's hold. */
export type PaintSceneStep = { readonly kind: 'hold'; readonly frames: number } | { readonly kind: 'freeze'; readonly time: SceneSeconds };
/** A step on clip time, after the clip's start: its rate, then its loop; or a freeze alone. */
export type PaintClipStep =
  | { readonly kind: 'rate'; readonly rate: number }
  | { readonly kind: 'loop'; readonly period: ClipSeconds; readonly mode: 'repeat' | 'pingpong'; readonly times: number }
  | { readonly kind: 'freeze'; readonly time: ClipSeconds };

/** A play's clock compiled: scene steps, the clip's start, then clip steps, evaluated in that order alone. */
export type CompiledPaintPlayClock = {
  readonly scene: readonly PaintSceneStep[];
  readonly start: SceneSeconds;
  readonly clip: readonly PaintClipStep[];
  /** The scene second it stops writing, the drawing then held; Infinity for none. */
  readonly until: SceneSeconds;
};

/** The half-open scene-second interval a play writes over; `end` is Infinity for one that never stops. */
export type PaintPlayInterval = { readonly start: SceneSeconds; readonly end: SceneSeconds };

const isWholeFrom1 = (n: number) => Number.isInteger(n) && n >= 1;

/** Why `clock` can't be a node's, or null. */
export function paintNodeClockProblem(clock: PaintNodeClock): string | null {
  if ('hold' in clock) return isWholeFrom1(clock.hold) ? null : `its hold is ${clock.hold} frames, not a whole number from 1`;
  return Number.isFinite(clock.freeze) ? null : `its freeze is at ${clock.freeze}s, not a finite time`;
}

/** Why `clock` can't be played, or null. */
export function paintPlayClockProblem(clock: PaintPlayClock): string | null {
  if (!Number.isFinite(clock.at)) return `its clock starts at ${clock.at}s, not a finite time`;
  if (clock.hold !== undefined && !isWholeFrom1(clock.hold)) return `its hold is ${clock.hold} frames, not a whole number from 1`;
  if (clock.until !== undefined && !(clock.until > clock.at)) return `it stops at ${clock.until}s, not after it starts at ${clock.at}s`;
  if (clock.freeze !== undefined) return Number.isFinite(clock.freeze) && clock.freeze >= 0 ? null : `its freeze is at clip second ${clock.freeze}, not finite from 0`;
  if (clock.rate !== undefined && !(clock.rate > 0 && Number.isFinite(clock.rate))) return `its rate is ${clock.rate}; a clock only runs forwards`;
  if (clock.loop && !(clock.loop.period > 0 && Number.isFinite(clock.loop.period))) return `its loop's period is ${clock.loop.period}s`;
  if (clock.loop?.times !== undefined && !isWholeFrom1(clock.loop.times)) return `its loop runs ${clock.loop.times} times, not a whole number from 1`;
  return null;
}

/** A node's clock as a scene step. */
export const paintNodeClockStep = (clock: PaintNodeClock): PaintSceneStep =>
  'hold' in clock ? { kind: 'hold', frames: clock.hold } : { kind: 'freeze', time: sceneSeconds(clock.freeze) };

/** A node's `clock` as steps: none for no clock, or one paintNodeClockProblem refuses (it's reported apart). */
export const paintNodeClockSteps = (clock: PaintNodeClock | undefined): PaintSceneStep[] => (clock && !paintNodeClockProblem(clock) ? [paintNodeClockStep(clock)] : []);

/** `clock` compiled under its node's steps (ancestors' outermost); check it first with paintPlayClockProblem. */
export function compilePaintPlayClock(clock: PaintPlayClock, node: readonly PaintSceneStep[]): CompiledPaintPlayClock {
  const scene: readonly PaintSceneStep[] = clock.hold === undefined ? node : [...node, { kind: 'hold', frames: clock.hold }];
  const clip: PaintClipStep[] = [];
  if (clock.freeze !== undefined) clip.push({ kind: 'freeze', time: clipSeconds(clock.freeze) });
  else {
    if (clock.rate !== undefined && clock.rate !== 1) clip.push({ kind: 'rate', rate: clock.rate });
    if (clock.loop) clip.push({ kind: 'loop', period: clipSeconds(clock.loop.period), mode: clock.loop.mode ?? 'repeat', times: clock.loop.times ?? Infinity });
  }
  return { scene, start: sceneSeconds(clock.at), clip, until: sceneSeconds(clock.until ?? Infinity) };
}

/**
 * The interval a compiled clock writes over, for a clip `length` clip seconds long (Infinity for a generator): from
 * its start to `until`, else to where its clip time reaches its last: the loop's last cycle's end, or the clip's.
 */
export function paintPlayInterval(clock: CompiledPaintPlayClock, length: ClipSeconds): PaintPlayInterval {
  if (Number.isFinite(clock.until)) return { start: clock.start, end: clock.until };
  let clipEnd: number = length, rate = 1;
  for (const step of clock.clip) {
    if (step.kind === 'freeze') clipEnd = Infinity;
    else if (step.kind === 'rate') rate = step.rate;
    else clipEnd = step.period * step.times;
  }
  return { start: clock.start, end: sceneSeconds(clock.start + clipEnd / rate) };
}

/**
 * The scene seconds `clock` first hands its clip each of `clipTimes` (within one loop's cycle, which every other
 * repeats), within the interval it writes; a frozen clock hands one time throughout, so its start stands for all.
 * A hold shows the drawing at the grid frame before, which the grid's own samples cover.
 */
export function paintPlayClipSceneTimes(clock: CompiledPaintPlayClock, clipTimes: readonly number[]): SceneSeconds[] {
  if (clock.clip.some((step) => step.kind === 'freeze')) return [clock.start];
  const rate = clock.clip.reduce((r, step) => (step.kind === 'rate' ? step.rate : r), 1);
  const period = clock.clip.reduce((p, step) => (step.kind === 'loop' ? step.period : p), Infinity);
  return clipTimes.filter((k) => k >= 0 && k <= period).map((k) => sceneSeconds(clock.start + k / rate)).filter((t) => t <= clock.until);
}

/** The moment a scene step hands on. */
function sceneStepTime(step: PaintSceneStep, time: PaintMoment, animationFps: number): PaintMoment {
  if (step.kind === 'freeze') return { at: step.time, frame: step.time };
  const frame = paintAnimationFrameOf(sceneSeconds(time.frame), animationFps);
  const held = paintAnimationFrameStart(animationFrame(Math.floor(frame / step.frames) * step.frames), animationFps);
  return { at: held, frame: held };
}

/** A node's time at moment `t`: through each of its steps, outermost first. */
export const paintNodeTimeAt = (steps: readonly PaintSceneStep[], t: PaintMoment, animationFps: number) =>
  steps.reduce((time, step) => sceneStepTime(step, time, animationFps), t);

/**
 * The time a clip step hands on. A loop never runs below 0; past its last cycle it reads that cycle's end, so a
 * finished loop holds its final drawing.
 */
function clipStepTime(step: PaintClipStep, time: ClipSeconds): ClipSeconds {
  switch (step.kind) {
    case 'rate': return clipSeconds(time * step.rate);
    case 'freeze': return step.time;
    case 'loop': {
      if (time <= 0) return clipSeconds(0);
      const cycle = Math.min(Math.floor(time / step.period), step.times - 1), within = Math.min(time - cycle * step.period, step.period);
      return clipSeconds(step.mode === 'pingpong' && cycle % 2 === 1 ? step.period - within : within);
    }
    default: return step satisfies never;
  }
}

/**
 * The clip time `clock` hands its clip at moment `t`, through its scene steps (its node's holds and its own): past
 * `until`, the time shown at `until`. Before its start it reads below 0, which a clip reads as 0.
 */
export function paintPlayClipTimeAt(clock: CompiledPaintPlayClock, t: PaintMoment, animationFps: number): ClipSeconds {
  return clock.clip.reduce((time, step) => clipStepTime(step, time), clipSeconds(paintPlayHeldTime(clock, t, animationFps) - clock.start));
}

/** The scene second `clock` reads at moment `t`: through its scene steps, held at `until` past it. */
function paintPlayHeldTime(clock: CompiledPaintPlayClock, t: PaintMoment, animationFps: number): SceneSeconds {
  const until = (time: number) => Math.min(time, clock.until);
  return sceneSeconds(paintNodeTimeAt(clock.scene, { at: until(t.at), frame: until(t.frame) }, animationFps).at);
}

/**
 * A group's boil epoch at its node's time `time`: 0, its seed as written, then one more every `every` animation
 * frames, on the grid, so boiling groups change together.
 */
export const paintBoilEpochAt = (time: SceneSeconds, every: number, animationFps: number) =>
  Math.max(0, Math.floor(paintAnimationFrameOf(time, animationFps) / every));

/** A play compiled: its clip, its clock under its node's, and the interval it writes over. */
export type CompiledPaintPlay<C> = { readonly clip: C; readonly clock: CompiledPaintPlayClock; readonly interval: PaintPlayInterval; readonly origin: string };

/** Plays writing one thing on one target, sorted by start. */
export type PaintLane<C> = readonly CompiledPaintPlay<C>[];

/**
 * The play writing `lane` at moment `t`, and the clip time it hands its clip: the latest to have started by its own
 * held time (paintPlayClipTimeAt's), or before any has, the first. Chosen through its holds, so where one held play
 * hands on to the next mid-shutter, the frame's drawing still holds through it.
 */
export function paintLaneClipAt<C>(lane: PaintLane<C>, t: PaintMoment, animationFps: number): { play: CompiledPaintPlay<C>; time: ClipSeconds } | undefined {
  const play = lane.findLast((each) => paintPlayHeldTime(each.clock, t, animationFps) >= each.interval.start) ?? lane[0];
  return play && { play, time: paintPlayClipTimeAt(play.clock, t, animationFps) };
}

/** `lane` sorted by start, as a lane is kept. */
export const paintLaneByStart = <C>(lane: PaintLane<C>) => lane.toSorted((a, b) => a.interval.start - b.interval.start);
