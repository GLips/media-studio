// shot-warm.ts: what a shot's `warm` span solves before its first frame shows: the render frames whose scene seconds
// lie in from..to at the composition's fps, within the scene playing the shot, and of those, for each painted plane,
// the first to pair each set of moments its solve reads on its clocks. Warming reports what it kept and promises no
// residency: a span past the cache's budget evicts its beginning, and those frames solve again.
//
// Negative space: no shutter ends. An instanced plane's items read them, but its variants are finished selections
// solved once, so the moments its items move through solve nothing.

import { paintNodeTimeAt, type PaintSceneStep } from '#lib/paint/animation/models/paint-clock.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { PaintedShotProps } from './shot-props.ts';

export type ShotWarm = NonNullable<PaintedShotProps['warm']>;

/** Why a shot can't warm `warm`, as it loads: its ends are finite scene seconds, from 0, `from` no later than `to`. */
export function shotWarmProblems({ from, to }: ShotWarm): PaintingProblem[] {
  if (Number.isFinite(from) && Number.isFinite(to) && from >= 0 && from <= to) return [];
  return [paintingProblem('error', 'shot', 'warm', `${from}..${to} isn't a span of scene seconds: from 0 or later, to no earlier than from`)];
}

/**
 * A warning for `warm` running past the end of the scene playing the shot, `dur` scene seconds long: a span written
 * in frames, say. The shot warms only to the scene's end (shotWarmFrames) and reports this with its warm's costs.
 */
export function shotWarmPastScene({ to }: ShotWarm, dur: number): PaintingProblem[] {
  return to > dur ? [paintingProblem('warning', 'shot', 'warm', `runs to ${to} s; its scene ends at ${dur} s: warm counts scene seconds, not frames, and stops at the scene's end`)] : [];
}

/**
 * The render frames whose scene seconds lie in `warm` at `fps`, each as the moment it shows, in order; with
 * `sceneDur`, the length of the scene playing the shot, only the frames it shows: none at its end or past it.
 */
export function shotWarmFrames({ from, to }: ShotWarm, fps: number, sceneDur: number | null = null): PaintMoment[] {
  // Within a millionth of a frame counts as on it, so 0.1 s at 30 fps is frame 3 though 0.1 × 30 isn't quite 3.
  const first = Math.ceil(from * fps - 1e-6), inSpan = Math.floor(to * fps + 1e-6);
  const last = sceneDur === null ? inSpan : Math.min(inSpan, Math.ceil(sceneDur * fps - 1e-6) - 1);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => paintMoment((first + i) / fps));
}

/**
 * The frames of `frames` a painted plane's warm solves, in order: each the first to pair its moments on `clocks` (the
 * plane's, as shotPlaneClocks gives them) as it does. A later frame pairing them alike solves alike, and is skipped.
 */
export function shotWarmCombinations(frames: readonly PaintMoment[], clocks: readonly (readonly PaintSceneStep[])[], animationFps: number): PaintMoment[] {
  const paired = new Set<string>();
  return frames.filter((frame) => {
    const key = clocks.map((steps) => {
      const held = paintNodeTimeAt(steps, frame, animationFps);
      return `${held.at} ${held.frame}`;
    }).join('|');
    if (paired.has(key)) return false;
    paired.add(key);
    return true;
  });
}
