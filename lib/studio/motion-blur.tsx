// motion-blur.tsx: a shutter for 30 fps. A fast move sampled once per frame strobes (the eye sees it jump); a real
// camera smears it along its path while the shutter is open. ShutterBlur renders a shot at several moments inside the
// frame's open shutter and averages them. For one element, lib/models/motion/shutter.ts sizes a Gaussian from its
// travel instead.

import type { ReactNode } from 'react';
import { FPS } from '#models/frame/frame.ts';
import { motionEchoAttrs } from './motion-tag.ts';

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
