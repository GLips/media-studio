// paint-clock.ts: the times a painted animation reads (plan 1's timing contract, phase 3). A play's clock is written
// as parts and compiled into steps evaluated in one fixed order, so no part can be written in an order that means
// something else; the interval it writes over follows from the same parts. A node carries only holds and freezes.
//
// Scene seconds, clip seconds and animation frames are kept apart by type where interval arithmetic crosses them.
//
// Negative space: render fps never enters here. A 30 or 60 fps render samples the same held drawings.

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

/** Frames per second of the animation clock unless a scene says otherwise: "on twos" is 2/24 s at any render rate. */
export const PAINT_ANIMATION_FPS = 24;

/** The animation frame scene time `t` falls in; the epsilon puts 2/24 s on frame 2, not 1. */
export const paintAnimationFrameAt = (t: SceneSeconds, animationFps: number) => animationFrame(Math.floor(t * animationFps + 1e-6));

/** When animation frame `frame` starts, in scene seconds. */
export const paintAnimationFrameStart = (frame: AnimationFrame, animationFps: number) => sceneSeconds(frame / animationFps);

/**
 * A node's clock, read by its writers and its boil inside its ancestors': `hold` shows a new drawing every `hold`
 * animation frames on the scene's grid; `freeze` stops it at scene second `freeze`. Never its reveal: revealing is
 * the score's (vid-114) on scene time, as wet paint lands in the painting's order.
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

/** The time a scene step hands on. */
function sceneStepTime(step: PaintSceneStep, time: SceneSeconds, animationFps: number): SceneSeconds {
  if (step.kind === 'freeze') return step.time;
  const frame = paintAnimationFrameAt(time, animationFps);
  return paintAnimationFrameStart(animationFrame(Math.floor(frame / step.frames) * step.frames), animationFps);
}

/** A node's time at scene time `t`: through each of its steps, outermost first. */
export const paintNodeTimeAt = (steps: readonly PaintSceneStep[], t: SceneSeconds, animationFps: number) =>
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
 * The clip time `clock` hands its clip at scene time `t`, through its scene steps (its node's holds and its own):
 * past `until`, the time shown at `until`. Before its start it reads below 0, which a clip reads as 0.
 */
export function paintPlayClipTimeAt(clock: CompiledPaintPlayClock, t: SceneSeconds, animationFps: number): ClipSeconds {
  const held = paintNodeTimeAt(clock.scene, sceneSeconds(Math.min(t, clock.until)), animationFps);
  return clock.clip.reduce((time, step) => clipStepTime(step, time), clipSeconds(held - clock.start));
}

/**
 * A group's boil epoch at its node's time `time`: 0, its seed as written, until the first grid step after its reveal
 * ends at `revealEnd`, so it doesn't pop to a new seed as it finishes; then one more every `every` animation frames,
 * on the grid, so boiling groups change together.
 */
export function paintBoilEpochAt(time: SceneSeconds, revealEnd: SceneSeconds, every: number, animationFps: number): number {
  if (time < revealEnd) return 0;
  return Math.floor(paintAnimationFrameAt(time, animationFps) / every) - Math.floor(paintAnimationFrameAt(revealEnd, animationFps) / every);
}
