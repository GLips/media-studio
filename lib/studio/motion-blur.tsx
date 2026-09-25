// motion-blur.tsx: a shutter for 30 fps. A fast move sampled once per frame strobes (the eye sees it jump); a real
// camera smears it along its path while the shutter is open. ShutterBlur renders a shot at several moments inside the
// frame's open shutter and averages them; for one element, the smear helpers size a Gaussian from its travel instead.

import type { ReactNode } from 'react';
import { FPS } from './frame.ts';
import { motionEchoAttrs } from './motion-tag.ts';

/**
 * The reference reel's shutter, 180° at its 60 fps: its smears are this long, so ours match it frame for frame. Our
 * 30 fps jumps twice as far between frames; 1/60 (180° at 30 fps) smears twice as long and strobes less.
 */
export const REEL_SHUTTER = 1 / 120;

/**
 * A Gaussian of σ = 0.312 L has the 10–90% edge ramp (2.563σ) of a box blur L long, which is what an open shutter
 * makes of an edge travelling L px.
 */
export const smearSigma = (travel: number) => 0.312 * Math.abs(travel);

/**
 * When a shutter `shutter` long (in `t`'s units), centred on `t`, opens. A move starting at `start` is drawn whole from
 * its first moment, so the shutter opens no earlier: centred on it, half the exposure would see the move not yet begun.
 */
export const shutterOpensAt = (t: number, shutter: number, start = -Infinity) => Math.max(start, t - shutter / 2);

/** How far the position `at` gives moves while the shutter around `t` is open (as `shutterOpensAt`); 0 before `start`. */
export function shutterTravel(at: (t: number) => number, t: number, shutter: number, start = -Infinity) {
  if (t < start) return 0;
  const open = shutterOpensAt(t, shutter, start);
  return Math.abs(at(open + shutter) - at(open));
}

/**
 * `render(t)` drawn at `samples` times spread over the `shutter` (a fraction of a frame: 0.5 is film's 180°) ending at
 * `t`, averaged. The average is exact only when every sample is opaque over the frame, so `render` must draw its own
 * background: wrap a whole shot, not one element over another shot. Costs `samples` renders; 6–10 is smooth. A still
 * frame is drawn once. Only the sample at `t` is measured; the others are echoes.
 */
export function ShutterBlur({ t, render, shutter = 0.5, samples = 8, moving = true }: {
  t: number;
  render: (t: number) => ReactNode;
  shutter?: number;
  samples?: number;
  /** False where nothing moves this frame, to skip the extra renders. */
  moving?: boolean;
}) {
  if (!moving || samples <= 1 || shutter <= 0) return <>{render(t)}</>;
  const span = shutter / FPS;
  // Each later layer at 1/(i+1) over the ones before leaves every sample an equal share: a running average.
  return (
    <>
      {Array.from({ length: samples }, (_, i) => (
        <div key={i} {...(i < samples - 1 && motionEchoAttrs)} style={{ position: 'absolute', inset: 0, opacity: 1 / (i + 1) }}>
          {render(t - span + (span * (i + 1)) / samples)}
        </div>
      ))}
    </>
  );
}
