// shot-warm.ts: what a shot's `warm` span reads, to solve before its first frame shows: the render frames whose scene
// seconds lie in from..to at the composition's fps, and the moments those frames read through each plane's and node's
// clock, an instanced plane's at its shutter's ends too. Warming reports what it kept and promises no residency: a
// span past the cache's budget evicts its beginning, and those frames solve again.

import { paintNodeTimeAt, type PaintSceneStep } from '#lib/paint/animation/models/paint-clock.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { shutterOpensAt } from '#lib/picture/lens/models/lens-shutter.ts';
import type { PaintedShotProps } from './shot-props.ts';

export type ShotWarm = NonNullable<PaintedShotProps['warm']>;

/** Why a shot can't warm `warm`, as it loads: its ends are finite scene seconds, from 0, `from` no later than `to`. */
export function shotWarmProblems({ from, to }: ShotWarm): PaintingProblem[] {
  if (Number.isFinite(from) && Number.isFinite(to) && from >= 0 && from <= to) return [];
  return [paintingProblem('error', 'shot', 'warm', `${from}..${to} isn't a span of scene seconds: from 0 or later, to no earlier than from`)];
}

/** The render frames whose scene seconds lie in `warm` at `fps`, each as the moment it shows, in order. */
export function shotWarmFrames({ from, to }: ShotWarm, fps: number): PaintMoment[] {
  // Within a millionth of a frame counts as on it, so 0.1 s at 30 fps is frame 3 though 0.1 × 30 isn't quite 3.
  const first = Math.ceil(from * fps - 1e-6), last = Math.floor(to * fps + 1e-6);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => paintMoment((first + i) / fps));
}

/**
 * The distinct moments a clock of `steps` (a plane's or node's, outermost first, as paintNodeTimeAt takes them) reads
 * over `frames`, in order. With `shutter` (s; an instanced plane's), each frame's shutter ends too, where its items
 * are read for their travel.
 */
export function shotWarmMoments(frames: readonly PaintMoment[], steps: readonly PaintSceneStep[], animationFps: number, shutter = 0): PaintMoment[] {
  const moments = new Map<string, PaintMoment>();
  for (const frame of frames) {
    const opens = shutterOpensAt(frame.at, shutter);
    const read = shutter > 0 ? [frame, paintMoment(opens, frame.frame), paintMoment(opens + shutter, frame.frame)] : [frame];
    for (const moment of read) {
      const held = paintNodeTimeAt(steps, moment, animationFps);
      moments.set(`${held.at} ${held.frame}`, held);
    }
  }
  return [...moments.values()];
}
