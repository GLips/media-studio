// grade.tsx: what sits over a whole frame to finish it: film grain, so flat colour fields and gradients read as
// photographed rather than drawn (and don't band), and a vignette that holds the eye in.

import { useId } from 'react';
import { useCurrentFrame } from 'remotion';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';

/**
 * Monochrome grain, new every frame and the same on every render of that frame (its noise is seeded by the frame).
 * `amount` 0..1 is its strength: 0.06–0.1 reads as film on a colour field; past 0.15 it's a look. It's an overlay, so
 * it shows on mid-tones and all but vanishes on near-black, as a reel's grain should.
 */
export function FilmGrain({ amount = 0.08, scale = 0.9 }: { amount?: number; scale?: number }) {
  const frame = useCurrentFrame();
  const id = useId();
  const { width, height } = useVideoFormat();
  if (amount <= 0) return null;
  return (
    <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'overlay', opacity: amount * 4 }} width={width} height={height}>
      <filter id={id} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency={scale} numOctaves={2} seed={frame % 997} stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width={width} height={height} filter={`url(#${id})`} />
    </svg>
  );
}

/** Darkens the frame's edges toward `color` (an "r, g, b" string); `amount` is the corners' opacity. */
export function Vignette({ amount = 0.35, color = '0, 0, 0', inner = 0.55 }: { amount?: number; color?: string; inner?: number }) {
  if (amount <= 0) return null;
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      background: `radial-gradient(ellipse 75% 75% at 50% 50%, rgba(${color}, 0) ${inner * 100}%, rgba(${color}, ${amount}) 100%)`,
    }} />
  );
}
