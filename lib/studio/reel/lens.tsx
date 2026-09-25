// lens.tsx: the frame post's chromatic aberration, after the reference reel's. At rest the colour channels sit a
// fraction of a pixel apart at the corners (red out, blue in); a cut kicks them wider for a few frames, and a glitch
// splits them sideways. One SVG filter over whatever it wraps, DOM and WebGL canvases alike: the browser's compositor
// does the work, and nothing samples pixels in JS.

import { useId, type ReactElement, type ReactNode } from 'react';
import { FPS, H, W } from '../frame.ts';
import { motionCurves } from '../motion.ts';
import { pieceMotionAttrs } from '../motion-tag.ts';
import { hashRandom } from '../random.ts';

export type LensFringeTiming = {
  /** Px each of red and blue sits off green at the frame's corners, at rest. Ref ≈0.6; 0.55 keeps it sub-pixel. */
  radial?: number;
  /** Cut times, s: the fringe jumps to `kick` px and eases back to `radial` over `kickDecay` s. Ref 2.5 over 1/6 s. */
  kicks?: readonly number[];
  kick?: number;
  kickDecay?: number;
  /** Glitch times, s: red shifts right and blue left by about `split` px for `splitFor` s. Ref 7 px for 0.05 s. */
  splits?: readonly number[];
  split?: number;
  splitFor?: number;
  /** Seeds each split frame's jitter (the reference's split wanders 4–9 px frame to frame). */
  seed?: string | number;
};

export type LensFringeState = { radial: number; red: number; blue: number };

/** The fringe at `t`: `radial` px at the corners, and the split's red and blue shifts in whole px (red +, blue −). */
export function lensFringeAt(t: number, timing: LensFringeTiming = {}): LensFringeState {
  const { radial = 0.55, kicks = [], kick = 2.5, kickDecay = 1 / 6, splits = [], split = 7, splitFor = 0.05, seed = 'lens' } = timing;
  let px = radial;
  for (const at of kicks) {
    const since = t - at;
    // The kick holds a couple of frames and then falls away; the reference's decay fits 1 − smoothstep within 0.2 px.
    if (since > -1e-6 && since < kickDecay) px = Math.max(px, radial + (kick - radial) * (1 - motionCurves.dissolve(since / kickDecay)));
  }
  const glitch = splits.find((at) => t - at > -1e-6 && t - at < splitFor);
  if (glitch === undefined || split === 0) return { radial: px, red: 0, blue: 0 };
  const frame = Math.floor(t * FPS + 1e-6);
  const wander = (channel: string) => 0.7 + 0.6 * hashRandom(seed, glitch, frame, channel);
  return { radial: px, red: Math.round(split * wander('red')), blue: -Math.round(split * wander('blue')) };
}

/**
 * The widest `radial` drawn sub-pixel, with bilinear weights like a lens. Wider fringes (a kick's first frames) and a
 * split's frames, which drop the radial fringe under the split, move each channel in whole px.
 */
export const LENS_FRINGE_SUBPIXEL_MAX = Math.hypot(W / 2, H / 2) / W;

/**
 * Chromatic aberration over `children`: the frame post, above the content and the HUD and under FilmGrain. `t` is
 * the clock `kicks` and `splits` are on. Wrap the whole frame, since the channels are recombined by adding them,
 * exact only over an opaque ground. At rest it costs about 8 ms a frame; `radial={0}` runs it only on kicks and splits.
 */
export function LensFringe({ t, children, motion, ...timing }: LensFringeTiming & { t: number; children: ReactNode; motion?: string | false }) {
  const id = `lens-fringe${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const fringe = lensFringeAt(t, timing);
  const on = fringe.radial > 0 || fringe.red !== 0 || fringe.blue !== 0;
  // The tag rides on the filter's own svg, not the wrapper, which would make every tagged piece inside its group.
  return (
    <>
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden {...pieceMotionAttrs(motion, 'lens', { kind: 'lens-fringe', values: fringe })}>
        {on && (
          <filter id={id} filterUnits="userSpaceOnUse" x={0} y={0} width={W} height={H} colorInterpolationFilters="sRGB">
            {fringe.red !== 0 || fringe.blue !== 0
              ? lensSplitPrimitives(fringe.red, fringe.blue)
              : fringe.radial <= LENS_FRINGE_SUBPIXEL_MAX
                ? lensSubpixelPrimitives(fringe.radial)
                : lensWholePixelPrimitives(fringe.radial)}
          </filter>
        )}
      </svg>
      {/* The same element whether or not the filter is on, so toggling it never remounts a canvas inside. */}
      <div style={{ position: 'absolute', inset: 0, filter: on ? `url(#${id})` : undefined }}>{children}</div>
    </>
  );
}

const CHANNEL = {
  r: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
  g: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
  b: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
};
const add = (a: string, b: string, result?: string) => (
  <feComposite key={result ?? 'out'} in={a} in2={b} operator="arithmetic" k2={1} k3={1} result={result} />
);

/** Red right and blue left by whole px; green holds. */
function lensSplitPrimitives(red: number, blue: number): ReactElement[] {
  return [
    <feColorMatrix key="r" in="SourceGraphic" type="matrix" values={CHANNEL.r} result="r" />,
    <feOffset key="r2" in="r" dx={red} result="r2" />,
    <feColorMatrix key="g" in="SourceGraphic" type="matrix" values={CHANNEL.g} result="g" />,
    <feColorMatrix key="b" in="SourceGraphic" type="matrix" values={CHANNEL.b} result="b" />,
    <feOffset key="b2" in="b" dx={blue} result="b2" />,
    add('r2', 'g', 'rg'),
    add('rg', 'b2'),
  ];
}

/**
 * Green is magnified `radial` px at the corners and red twice that, while blue holds: red out and blue in, relative
 * to green, and nothing samples past the frame's edge. feDisplacementMap samples nearest-neighbour, so its taps move
 * the source one whole px toward the centre (across, down, both) and each pixel mixes them by its bilinear weights.
 */
function lensSubpixelPrimitives(radial: number): ReactElement[] {
  const maps = lensMapUrls();
  const r = Math.hypot(W / 2, H / 2);
  // Green's shift at the frame's left and right edges, and at its top and bottom; red's is twice these.
  const gx = (radial * W) / 2 / r, gy = (radial * H) / 2 / r;
  // Bilinear weights from the ramp's Vx, Vy and Vx·Vy, for a shift of ax·Vx across and ay·Vy down.
  const weights = (ax: number, ay: number) => [
    [1, -ax, -ay, ax * ay], // the source
    [0, ax, 0, -ax * ay], // one px across
    [0, 0, ay, -ax * ay], // one px down
    [0, 0, 0, ax * ay], // both
  ];
  const red = weights(2 * gx, 2 * gy), green = weights(gx, gy);
  const row = ([bias, vx, vy, vxy]: number[]) => `${vx} ${vy} ${vxy} 0 ${bias}`;
  const taps = ['SourceGraphic', 'across', 'down', 'both'];
  // Every tap reads the source: Chrome re-runs a step once for each step that reads it, so a chain of one-px stages
  // would double its cost with every stage.
  return [
    <feImage key="ramp" href={maps.ramp} x={0} y={0} width={W} height={H} preserveAspectRatio="none" result="ramp" />,
    <feImage key="toward" href={maps.toward} x={0} y={0} width={W} height={H} preserveAspectRatio="none" result="toward" />,
    <feDisplacementMap key="across" in="SourceGraphic" in2="toward" scale={2} xChannelSelector="R" yChannelSelector="B" result="across" />,
    <feDisplacementMap key="down" in="SourceGraphic" in2="toward" scale={2} xChannelSelector="B" yChannelSelector="G" result="down" />,
    <feDisplacementMap key="both" in="SourceGraphic" in2="toward" scale={2} xChannelSelector="R" yChannelSelector="G" result="both" />,
    ...taps.flatMap((tap, i) => [
      // Blue keeps the source whole.
      <feColorMatrix key={`w${i}`} in="ramp" type="matrix" values={`${row(red[i])}  ${row(green[i])}  0 0 0 0 ${i === 0 ? 1 : 0}  0 0 0 0 1`} result={`w${i}`} />,
      <feComposite key={`p${i}`} in={tap} in2={`w${i}`} operator="arithmetic" k1={1} result={`p${i}`} />,
    ]),
    add('p0', 'p1', 's1'),
    add('s1', 'p2', 's2'),
    add('s2', 'p3'),
  ];
}

/** The same magnification, rounded to whole px by the nearest-neighbour sampling: past a px, the rounding hides. */
function lensWholePixelPrimitives(radial: number): ReactElement[] {
  const maps = lensMapUrls();
  // feDisplacementMap's scale for a channel magnified `px` at the corners: the signed ramp climbs 1 across W.
  const scale = (px: number) => (-px * W) / Math.hypot(W / 2, H / 2);
  return [
    <feImage key="signed" href={maps.signed} x={0} y={0} width={W} height={H} preserveAspectRatio="none" result="signed" />,
    <feColorMatrix key="r" in="SourceGraphic" type="matrix" values={CHANNEL.r} result="r" />,
    <feDisplacementMap key="r2" in="r" in2="signed" scale={scale(2 * radial)} xChannelSelector="R" yChannelSelector="G" result="r2" />,
    <feColorMatrix key="g" in="SourceGraphic" type="matrix" values={CHANNEL.g} result="g" />,
    <feDisplacementMap key="g2" in="g" in2="signed" scale={scale(radial)} xChannelSelector="R" yChannelSelector="G" result="g2" />,
    <feColorMatrix key="b" in="SourceGraphic" type="matrix" values={CHANNEL.b} result="b" />,
    add('r2', 'g2', 'rg'),
    add('rg', 'b'),
  ];
}

let mapUrls: { ramp: string; toward: string; signed: string } | undefined;

/**
 * The filter's maps, stretched over the frame. `ramp` is each axis's distance from the centre, 0 there and 1 at the
 * edges (R across, G down, B their product); `toward` points one px back at the centre (R left of it, G above it, B
 * neutral); `signed` is the offset from the centre, 0.5 there.
 */
function lensMapUrls() {
  if (mapUrls) return mapUrls;
  // PNG data URLs: Chrome counts an feImage of an element or an SVG as cross-origin, which turns feDisplacementMap
  // off, and a data URL is ready on the first frame, where a fetched image might not be.
  // 256 × 144 cells of 7.5 px: each map is linear (or bilinear) between cell centres, so the stretch keeps it exact.
  const w = 256, h = 144, cell = W / w;
  const draw = (pixel: (x: number, y: number) => [number, number, number]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const [r, g, b] = pixel((i + 0.5) * cell, (j + 0.5) * cell);
        img.data.set([r, g, b, 1].map((v) => Math.round(255 * v)), (j * w + i) * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  };
  const vx = (x: number) => Math.abs(x - W / 2) / (W / 2), vy = (y: number) => Math.abs(y - H / 2) / (H / 2);
  mapUrls = {
    ramp: draw((x, y) => [vx(x), vy(y), vx(x) * vy(y)]),
    toward: draw((x, y) => [x < W / 2 ? 1 : 0, y < H / 2 ? 1 : 0, 0.5]),
    signed: draw((x, y) => [0.5 + (x - W / 2) / W, 0.5 + (y - H / 2) / W, 0]),
  };
  return mapUrls;
}
