// paint-clock.ts: the times a painted animation's writers read, as plan 1's timing contract defines them
// (docs/plans/2026-09-30-plan-feat-painted-animation-strokes-and-timing.md, phase 3). A writer's clock (a pose clip,
// a sway, a placement) is a chain of steps from scene time to its clip's own: placed at a cue, retimed, looped, held
// on twos, frozen. A part carries only holds and freezes, so a loop never un-draws its reveal. Steps are data, so a
// scene's timing can be checked and keyed before anything renders.
//
// Negative space: render fps never enters here. A 30 or 60 fps render samples the same held drawings. The clock's
// rate and frame (PAINT_ANIMATION_FPS, paintAnimationFrameAt) are painting's, which a recipe's boil counts on too.

import { paintAnimationFrameAt } from '#lib/paint/painting/models/stamp-group-motion.ts';

/**
 * One step of a clock, from the time it's given to the time it hands on. `at` places a clip at `start` (a cue plus an
 * offset); `rate` plays it faster (> 0); `loop` wraps it, repeating or reflecting, never below 0; `hold` shows a new
 * drawing every `frames` animation frames, on its input's grid; `freeze` always reads `time`.
 */
export type PaintClockStep =
  | { kind: 'at'; start: number }
  | { kind: 'rate'; rate: number }
  | { kind: 'loop'; period: number; mode: 'repeat' | 'pingpong' }
  | { kind: 'hold'; frames: number }
  | { kind: 'freeze'; time: number };

/**
 * A clock as written outermost first: `[hold(2), at(cue), loop(…)]` holds a loop placed at a cue. The hold sees the
 * parent's time, so it steps on the parent's grid; the `at` makes the clip's own time, which the loop wraps.
 */
export type PaintClock = readonly PaintClockStep[];

/** The time `step` hands on when given `time`: each kind's pure function. */
function paintClockStepTime(step: PaintClockStep, time: number, animationFps: number): number {
  switch (step.kind) {
    case 'at': return time - step.start;
    case 'rate': return time * step.rate;
    case 'loop': {
      if (time <= 0) return 0;
      const cycle = Math.floor(time / step.period), within = time - cycle * step.period;
      return step.mode === 'pingpong' && cycle % 2 === 1 ? step.period - within : within;
    }
    case 'hold': return Math.floor(paintAnimationFrameAt(time, animationFps) / step.frames) * step.frames / animationFps;
    case 'freeze': return step.time;
    default: return step satisfies never;
  }
}

/** Why `step` can't be evaluated, or null. */
export function paintClockStepProblem(step: PaintClockStep): string | null {
  const finite = Object.entries(step).filter(([key]) => key !== 'kind' && key !== 'mode').every(([, value]) => Number.isFinite(value));
  if (!finite) return `its ${step.kind} step needs finite numbers`;
  if (step.kind === 'rate' && !(step.rate > 0)) return `its rate is ${step.rate}; a clock only runs forwards`;
  if (step.kind === 'loop' && !(step.period > 0)) return `its loop's period is ${step.period}s`;
  if (step.kind === 'hold' && !(Number.isInteger(step.frames) && step.frames >= 1)) return `its hold is ${step.frames} frames, not a whole number from 1`;
  return null;
}

/** The time `clock` hands its clip when the scene's time is `time`: each step, outermost first. */
export function paintClockTimeAt(clock: PaintClock, time: number, animationFps: number): number {
  return clock.reduce((at, step) => paintClockStepTime(step, at, animationFps), time);
}
