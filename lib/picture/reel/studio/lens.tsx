// lens.tsx: the frame post's chromatic aberration, after the reference reel's. At rest the colour channels sit a
// fraction of a pixel apart at the corners (red out, blue in); a cut kicks them wider for a few frames, and a glitch
// splits them sideways. One SVG filter over whatever it wraps, DOM and WebGL canvases alike: the browser's compositor
// does the work, and nothing samples pixels in JS. How far apart the channels sit at `t` is models/reel/lens.ts.

import { useId, type ReactElement, type ReactNode } from 'react';
import type { FrameSize } from '#lib/picture/frame/models/frame.ts';
import { lensFringeAt, lensFringeSubpixelMax, type LensFringeTiming } from '../models/lens.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';
import { pieceMotionAttrs } from '#lib/picture/measurement/studio/motion-tag.ts';

/**
 * Chromatic aberration over `children`: the frame post, above the content and the HUD and under FilmGrain. `t` is
 * the clock `kicks` and `splits` are on. Wrap the whole frame, since the channels are recombined by adding them,
 * exact only over an opaque ground. At rest it costs about 8 ms a frame; `radial={0}` runs it only on kicks and splits.
 */
export function LensFringe({ t, children, motion, ...timing }: LensFringeTiming & { t: number; children: ReactNode; motion?: string | false }) {
  const id = `lens-fringe${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const { fps, width, height } = useVideoFormat(), size = { width, height };
  const fringe = lensFringeAt(t, fps, timing);
  const on = fringe.radial > 0 || fringe.red !== 0 || fringe.blue !== 0;
  // The tag rides on the filter's own svg, not the wrapper, which would make every tagged piece inside its group.
  return (
    <>
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden {...pieceMotionAttrs(motion, 'lens', { kind: 'lens-fringe', values: fringe })}>
        {on && (
          <filter id={id} filterUnits="userSpaceOnUse" x={0} y={0} width={width} height={height} colorInterpolationFilters="sRGB">
            {fringe.red !== 0 || fringe.blue !== 0
              ? channelSplitPrimitives('SourceGraphic', fringe.red, fringe.blue)
              : fringe.radial <= lensFringeSubpixelMax(size)
                ? lensSubpixelPrimitives(fringe.radial, size)
                : lensWholePixelPrimitives(fringe.radial, size)}
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

/**
 * Filter primitives that shift `input`'s red `red` px and its blue `blue` px sideways (whole px) while green holds,
 * then sum them: exact over an opaque input. Each shifted channel lies over its unshifted self, since nothing shifts in
 * from past the frame's edge: alone, red's leaves a strip with none (dark green down a red frame's left edge).
 */
export function channelSplitPrimitives(input: string, red: number, blue: number): ReactElement[] {
  const shifted = (c: 'r' | 'b', dx: number) => [
    <feColorMatrix key={`split-${c}0`} in={input} type="matrix" values={CHANNEL[c]} result={`split-${c}0`} />,
    <feOffset key={`split-${c}1`} in={`split-${c}0`} dx={dx} result={`split-${c}1`} />,
    <feMerge key={`split-${c}`} result={`split-${c}`}><feMergeNode in={`split-${c}0`} /><feMergeNode in={`split-${c}1`} /></feMerge>,
  ];
  return [
    ...shifted('r', red),
    <feColorMatrix key="split-g" in={input} type="matrix" values={CHANNEL.g} result="split-g" />,
    ...shifted('b', blue),
    add('split-r', 'split-g', 'split-rg'),
    add('split-rg', 'split-b'),
  ];
}

/**
 * Green is magnified `radial` px at the corners and red twice that, while blue holds: red out and blue in, relative
 * to green, and nothing samples past the frame's edge. feDisplacementMap samples nearest-neighbour, so its taps move
 * the source one whole px toward the centre (across, down, both) and each pixel mixes them by its bilinear weights.
 */
function lensSubpixelPrimitives(radial: number, { width, height }: FrameSize): ReactElement[] {
  const maps = lensMapUrls({ width, height });
  const r = Math.hypot(width / 2, height / 2);
  // Green's shift at the frame's left and right edges, and at its top and bottom; red's is twice these.
  const gx = (radial * width) / 2 / r, gy = (radial * height) / 2 / r;
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
    <feImage key="ramp" href={maps.ramp} x={0} y={0} width={width} height={height} preserveAspectRatio="none" result="ramp" />,
    <feImage key="toward" href={maps.toward} x={0} y={0} width={width} height={height} preserveAspectRatio="none" result="toward" />,
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
function lensWholePixelPrimitives(radial: number, { width, height }: FrameSize): ReactElement[] {
  const maps = lensMapUrls({ width, height });
  // feDisplacementMap's scale for a channel magnified `px` at the corners: the signed ramp climbs 1 across the width.
  const scale = (px: number) => (-px * width) / Math.hypot(width / 2, height / 2);
  return [
    <feImage key="signed" href={maps.signed} x={0} y={0} width={width} height={height} preserveAspectRatio="none" result="signed" />,
    <feColorMatrix key="r" in="SourceGraphic" type="matrix" values={CHANNEL.r} result="r" />,
    <feDisplacementMap key="r2" in="r" in2="signed" scale={scale(2 * radial)} xChannelSelector="R" yChannelSelector="G" result="r2" />,
    <feColorMatrix key="g" in="SourceGraphic" type="matrix" values={CHANNEL.g} result="g" />,
    <feDisplacementMap key="g2" in="g" in2="signed" scale={scale(radial)} xChannelSelector="R" yChannelSelector="G" result="g2" />,
    <feColorMatrix key="b" in="SourceGraphic" type="matrix" values={CHANNEL.b} result="b" />,
    add('r2', 'g2', 'rg'),
    add('rg', 'b'),
  ];
}

const mapUrls = new Map<string, { ramp: string; toward: string; signed: string }>();

/**
 * The filter's maps, stretched over the frame. `ramp` is each axis's distance from the centre, 0 there and 1 at the
 * edges (R across, G down, B their product); `toward` points one px back at the centre (R left of it, G above it, B
 * neutral); `signed` is the offset from the centre, 0.5 there.
 */
function lensMapUrls({ width, height }: FrameSize) {
  const key = `${width}x${height}`, cached = mapUrls.get(key);
  if (cached) return cached;
  // PNG data URLs: Chrome counts an feImage of an element or an SVG as cross-origin, which turns feDisplacementMap
  // off, and a data URL is ready on the first frame, where a fetched image might not be.
  // 256 cells across: each map is linear (or bilinear) between cell centres, so the stretch keeps it exact.
  const w = 256, h = Math.round((w * height) / width), cellX = width / w, cellY = height / h;
  const draw = (pixel: (x: number, y: number) => [number, number, number]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const [r, g, b] = pixel((i + 0.5) * cellX, (j + 0.5) * cellY);
        img.data.set([r, g, b, 1].map((v) => Math.round(255 * v)), (j * w + i) * 4);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  };
  const vx = (x: number) => Math.abs(x - width / 2) / (width / 2), vy = (y: number) => Math.abs(y - height / 2) / (height / 2);
  const urls = {
    ramp: draw((x, y) => [vx(x), vy(y), vx(x) * vy(y)]),
    toward: draw((x, y) => [x < width / 2 ? 1 : 0, y < height / 2 ? 1 : 0, 0.5]),
    signed: draw((x, y) => [0.5 + (x - width / 2) / width, 0.5 + (y - height / 2) / width, 0]),
  };
  mapUrls.set(key, urls);
  return urls;
}
