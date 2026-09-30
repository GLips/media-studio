// flat-blockout-pose.ts: where a 2D blockout's pieces and view are on a frame of the scene's clock (flat-blockout.tsx),
// as pure math. A piece rests at its `pose` and each key moves it, starting on the key's frame (a cue, a beat, a line)
// and taking `over` frames, so a blocked scene reads as a list of what happens on which moment of its timeline:
//
//   keys: [{ at: clock.cues.land, to: { y: 380 } }, { at: clock.beat(4), to: { opacity: 0 }, over: 6 }]

import { lerp, motionCurves, seg, type EaseFn } from '#lib/picture/motion/models/motion.ts';

/** A piece's box on the frame, top-left and size in the video's px, with its opacity, scale and turn about its centre. */
export type FlatPose = { x: number; y: number; w: number; h: number; opacity: number; scale: number; rotateDeg: number };

/**
 * The frame's view: the point of the frame at its centre, and a zoom about it. The frame's own centre at zoom 1 is
 * still: `{ cx: 960, cy: 540, zoom: 1 }` at 1920×1080.
 */
export type FlatView = { cx: number; cy: number; zoom: number };

/** A move to `to`, starting on frame `at` of the scene's clock and taking `over` frames (default 12). Channels it doesn't name hold. */
export type FlatKey<P> = { at: number; to: Partial<P>; over?: number; ease?: EaseFn };

const DEFAULT_OVER = 12;

/**
 * The pose on `frame`: `rest` with every key applied in order of `at`. A key starting before the one before it ends
 * picks up from wherever that one had got to, so overlapping moves blend rather than jump.
 */
export function flatPoseAt<P extends Record<string, number>>(rest: P, keys: readonly FlatKey<P>[], frame: number): P {
  let pose = rest;
  for (const key of keys.toSorted((a, b) => a.at - b.at)) {
    if (frame < key.at) break;
    const k = seg(frame, key.at, key.at + (key.over ?? DEFAULT_OVER), key.ease ?? motionCurves.expressive.standard);
    const next = { ...pose };
    for (const [channel, to] of Object.entries(key.to) as [keyof P, number][]) next[channel] = lerp(pose[channel], to, k) as P[keyof P];
    pose = next;
  }
  return pose;
}
