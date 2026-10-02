// motion-blur.tsx: a shutter for the video's frame rate. A fast move sampled once per frame strobes (the eye sees it jump); a real
// camera smears it along its path while the shutter is open. ShutterBlur renders a shot at several moments inside the
// frame's open shutter, centred on its time as every sampler's is (lens-shutter.ts), and averages them. For one
// element, lib/picture/lens/models/lens-shutter.ts sizes a Gaussian from its travel instead.

import type { ReactNode } from 'react';
import { lensExposures } from '#lib/picture/lens/models/lens-exposures.ts';
import { shutterMomentAt } from '#lib/picture/lens/models/lens-shutter.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import { motionEchoAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';

/**
 * `render(t)` averaged over `samples` moments of the `shutter` (a share of a frame: 0.5 is film's 180°). The average
 * is exact only when every sample is opaque, so `render` draws its own background: wrap a whole shot. An even count
 * takes one more, so a sample sits on `t`: only that one is measured.
 */
export function ShutterBlur({ t, render, shutter = 0.5, samples = 9, moving = true }: {
  t: number;
  render: (t: number) => ReactNode;
  shutter?: number;
  samples?: number;
  /** False where nothing moves this frame, to skip the extra renders. */
  moving?: boolean;
}) {
  const { fps } = useVideoFormat();
  if (!moving || samples <= 1 || shutter <= 0) return <>{render(t)}</>;
  const exposures = lensExposures(samples % 2 ? samples : samples + 1), middle = (exposures.length - 1) / 2;
  // Each later layer at 1/(i+1) over the ones before leaves every sample an equal share: a running average.
  return (
    <>
      {exposures.map((exposure, i) => (
        <div key={i} {...(i !== middle && motionEchoAttrs)} style={{ position: 'absolute', inset: 0, opacity: 1 / (i + 1) }}>
          {render(i === middle ? t : shutterMomentAt(t, shutter / fps, exposure.shutter))}
        </div>
      ))}
    </>
  );
}
