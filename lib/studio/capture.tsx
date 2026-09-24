// capture.tsx: captures on screen, through a view (see camera.ts).
//
// The image is laid out at its on-screen size rather than scaled with a transform, so CSS lengths on it, a blur
// radius included, are frame pixels at any zoom.

import { Img } from 'remotion';
import { lerpCam, scaleFor, type Cam, type View } from './camera.ts';
import { clamp, ease, seg } from './motion.ts';

/** A capture through a view, clipped to the view's box. `blur` is in frame pixels. */
export function Capture({ view, alpha = 1, blur = 0 }: { view: View; alpha?: number; blur?: number }) {
  if (alpha <= 0) return null;
  const { shot, cam, box } = view;
  const k = scaleFor(shot, cam.zoom);
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, overflow: 'hidden', opacity: alpha }}>
      <Img
        src={shot.src}
        style={{
          position: 'absolute',
          left: box.w / 2 - cam.cx * k,
          top: box.h / 2 - cam.cy * k,
          width: shot.w * k,
          height: shot.h * k,
          maxWidth: 'none',
          filter: blur ? `blur(${blur}px)` : undefined,
        }}
      />
    </div>
  );
}

/**
 * A capture moving from camera `from` to `to`, `k` 0..1 of the way, with directional motion blur: `samples` exposures
 * spread back along the last `shutter` of the path, fading as they trail, the way a real camera smears a fast pan.
 */
export function CaptureMotion({ view, from, to, k, shutter = 0.12, samples = 14, alpha = 1 }: {
  view: View;
  from: Cam;
  to: Cam;
  k: number;
  shutter?: number;
  samples?: number;
  alpha?: number;
}) {
  return (
    <>
      {Array.from({ length: samples }, (_, i) => (
        <Capture key={i} view={{ ...view, cam: lerpCam(from, to, clamp(k - shutter * (i / (samples - 1)))) }} alpha={alpha / (i + 1)} />
      ))}
    </>
  );
}

/**
 * Crossfades through states of one page under one camera: `[shot, fromTime]`, the first shown from the start. The
 * way to show a page changing as someone uses it.
 */
export function CaptureStates({ view, t, states, fade = 0.3 }: { view: View; t: number; states: readonly (readonly [View['shot'], number])[]; fade?: number }) {
  return (
    <>
      {states.map(([shot, at], i) => (
        <Capture key={i} view={{ ...view, shot }} alpha={i === 0 ? 1 : seg(t, at, at + fade)} />
      ))}
    </>
  );
}

/** One capture into another under the same view: a "the page updated" moment. `k` 0..1. */
export function CaptureSwap({ from, to, k }: { from: View; to: View; k: number }) {
  return (
    <>
      <Capture view={from} />
      <Capture view={to} alpha={ease(k)} />
    </>
  );
}
