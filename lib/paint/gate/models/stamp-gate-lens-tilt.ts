// stamp-gate-lens-tilt.ts: the gate's tilted focus (lens/tilt, through a PaintedShot). A still camera, its focus
// tilted so it recedes up the frame, looks at painted stripes at the focus's depth over three.js bars a quarter
// farther, both vertical. Each shows one band sharp, the bars' higher up as farther focus lies there, and blurs away
// from it; a fast frame and a reference frame agree, but for the reference's grain: its exposures leave copies where
// the blur is wide. The bars run past the frame: the fast path keeps a three silhouette's edge against clear.

import { paintCameraLensFocus, paintCameraPlay } from '#lib/paint/animation/models/paint-camera.ts';
import type { Application, Layer, Mix, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { TITANIUM_WHITE } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { StampPictureRgba } from '#lib/paint/painting/models/stamp-plane.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { ThreeSource } from '#lib/paint/shot/models/shot-props.ts';
import { lensDefocusField, lensDefocusFieldAt } from '#lib/picture/lens/models/lens-focus.ts';
import type { LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { stampGateHeronPaper, stampGateHeronPolygon } from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_ROUND_REF } from './stamp-gate-sheets.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

export const STAMP_GATE_LENS_TILT_ID = 'lens/tilt';
export const STAMP_GATE_LENS_TILT_IDS = [STAMP_GATE_LENS_TILT_ID] as const;

/**
 * The shot: frame and field of view; the focus on the stripes, its aperture (frame px of blur at infinity) and tilt
 * blurring the frame's ends a few px; each plane's depth; the stripes' paint and the bars' quad, frame px at rest,
 * and the columns the bars are read over; the frames drawn.
 */
export const STAMP_GATE_LENS_TILT = {
  frame: { width: 192, height: 128 },
  fov: 35,
  focus: { focus: 1, aperture: 8, tilt: { angle: 1.17 } },
  depths: { stripes: 1, bars: 1.25, back: 3 },
  stripes: { x0: 8, x1: 88, y0: 0, y1: 128, period: 10, width: 4 },
  bars: { x0: -40, x1: 232, y0: -40, y1: 168, cell: 8 },
  barsRead: { x0: 100, x1: 188 },
  frames: [{ at: 0, mode: 'fast' }, { at: 0, mode: 'reference' }] satisfies readonly { readonly at: number; readonly mode: LensMode }[],
} as const;

const stage = () => stampStage(STAMP_GATE_LENS_TILT.frame, 40);
const { ultramarine, burntUmber } = WATERCOLOUR_PIGMENTS;
const DARK: Mix = { parts: [{ pigment: ultramarine, amount: 1 }, { pigment: burntUmber, amount: 1 }], strength: 0.95 };
const PALE: Mix = { parts: [{ pigment: TITANIUM_WHITE, amount: 1 }], strength: 0.9 };

/** A gouache layer `key`, each of `boxes` (x0, y0, x1, y1) filled with `mix` once what's under it is dry. */
function gouacheBoxes(key: string, boxes: readonly (readonly [number, number, number, number])[], mix: Mix): Layer {
  const fills = boxes.map(([x0, y0, x1, y1], i): Application => ({
    key: `${key}-${i}`, on: 'dry', kind: 'fill', area: { region: stampGateHeronPolygon(x0, y0, x1, y0, x1, y1, x0, y1) }, brush: STAMP_GATE_ROUND_REF, diameterPx: 6, seed: `${key}-${i}`,
    charge: { kind: 'paint', mix },
  }));
  return { key, medium: 'gouache', washes: [{ key: `${key}-wash`, applications: fills }] };
}

/** The stripes: a pale ground over their box, dark vertical stripes across it, both gouache. */
export const STAMP_GATE_LENS_TILT_PAINTING: PaintingSourceModule = {
  default: function gateLensTilt(): PaintingDocument {
    const { frame, stripes: { x0, x1, y0, y1, period, width } } = STAMP_GATE_LENS_TILT;
    const stripes = Array.from({ length: Math.floor((x1 - x0) / period) }, (_, i) => [x0 + i * period + 3, y0 - 4, x0 + i * period + 3 + width, y1 + 4] as const);
    return {
      widthPx: frame.width, heightPx: frame.height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'watercolour',
      layers: [gouacheBoxes('ground', [[x0, y0 - 4, x1, y1 + 4]], PALE), gouacheBoxes('stripes', stripes, DARK)],
    };
  },
};

/** The back, which a shot must have and the bars hide: a flat grey over the whole stage. */
function stampGateLensTiltBack(): StampPictureRgba {
  const { width: w, height: h } = stage(), rgba = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([0.45, 0.43, 0.4, 1], i * 4);
  return { box: { x: 0, y: 0, w, h }, rgba };
}

/** The shot, its bars' scene built by `bars`. */
export function stampGateLensTiltShot(bars: ThreeSource['build']): StampGateShot {
  const evaluation = painting(STAMP_GATE_LENS_TILT_PAINTING), { fov, focus, depths } = STAMP_GATE_LENS_TILT;
  return {
    camera: { stage: stage(), fov, lens: { bloom: 0, shutter: 'shut' }, plays: [paintCameraPlay({ kind: 'focus', value: focus }, { clock: { at: 0 }, origin: 'the tilted focus' })] },
    planes: [
      { id: 'back', depth: depths.back, source: { kind: 'picture', extent: { kind: 'everywhere' }, pictureAt: () => Promise.resolve(stampGateLensTiltBack()) } },
      { id: 'bars', depth: depths.bars, source: { kind: 'three', build: bars } },
      { id: 'stripes', depth: depths.stripes, source: layersOf(evaluation, ['ground', 'stripes']) },
    ],
  };
}

/** The row where the tilted focus crosses each part's depth down the frame's middle, as the lens model puts it. */
export function stampGateLensTiltSharpRows(): { readonly stripes: number; readonly bars: number } {
  const { frame, fov, focus, depths } = STAMP_GATE_LENS_TILT;
  const lens = paintCameraLensFocus({ stage: stage(), fov }, focus, { pan: { x: 0, y: 0 }, dolly: 0, zoom: 1, roll: 0 }), centre = frame.width / 2;
  const sharpRow = (depth: number) => {
    const field = lensDefocusField(lens, lens.lean!, depth);
    // The signed sigma is affine down the frame: where it crosses 0 down the frame's middle.
    const top = lensDefocusFieldAt(field, { x: centre, y: 0 }), bottom = lensDefocusFieldAt(field, { x: centre, y: frame.height });
    return (top / (top - bottom)) * frame.height;
  };
  return { stripes: sharpRow(depths.stripes), bars: sharpRow(depths.bars) };
}

/** How many frame px a part's band's middle may sit from where the lens model puts it. */
const SHARP_ROW_WITHIN = 4;
/** A part's sharpness at its end farther from its band, at most this share of its band's: the band is plain. */
const ENDS_SOFTER = 0.5;
/**
 * How far the reference frame may sit from the fast one, levels, each averaged over five px square so the
 * reference's grain doesn't count: its mean, and its worst row's. Measured at 2.5 and 4.6.
 */
const FAST_TO_REFERENCE = { mean: 3.5, row: 7, over: 2 };

type Columns = { readonly x0: number; readonly x1: number };
/** The rows each part's sharpness is read over: clear of its paint's or quad's ends. */
const ROWS = { y0: 14, y1: 114 };

/** How sharp each row of RGBA frame `rgba` is across `columns`: the mean difference of neighbouring pixels, levels, over five rows. */
function rowSharpness(rgba: Uint8ClampedArray, { x0, x1 }: Columns): number[] {
  const { width } = STAMP_GATE_LENS_TILT.frame, level = (x: number, y: number) => (rgba[(y * width + x) * 4] + rgba[(y * width + x) * 4 + 1] + rgba[(y * width + x) * 4 + 2]) / 3;
  const raw = Array.from({ length: STAMP_GATE_LENS_TILT.frame.height }, (_, y) => {
    let sum = 0;
    for (let x = x0; x < x1 - 1; x++) sum += Math.abs(level(x + 1, y) - level(x, y));
    return sum / (x1 - x0 - 1);
  });
  return raw.map((_, y) => {
    const near = raw.slice(Math.max(0, y - 2), y + 3);
    return near.reduce((a, b) => a + b, 0) / near.length;
  });
}

/**
 * A part's band within ROWS: its middle, between the first and last rows sharper than halfway from its softest to its
 * sharpest (a flat-topped band has no one sharpest row); how sharp it is there, and at the end farther from it.
 */
function band(rows: readonly number[]) {
  const within = rows.slice(ROWS.y0, ROWS.y1), peak = Math.max(...within), half = (peak + Math.min(...within)) / 2;
  const first = within.findIndex((s) => s >= half), last = within.findLastIndex((s) => s >= half), middle = ROWS.y0 + (first + last) / 2;
  return { middle, peak, end: middle - ROWS.y0 > ROWS.y1 - 1 - middle ? rows[ROWS.y0] : rows[ROWS.y1 - 1] };
}

/** RGBA frame `rgba`'s level (the mean of its channels) at each px, averaged over `over` px each side. */
function boxed(rgba: Uint8ClampedArray, over: number): Float64Array {
  const { width, height } = STAMP_GATE_LENS_TILT.frame, out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, y - over); j <= Math.min(height - 1, y + over); j++) for (let i = Math.max(0, x - over); i <= Math.min(width - 1, x + over); i++, n++) {
      const p = (j * width + i) * 4;
      sum += (rgba[p] + rgba[p + 1] + rgba[p + 2]) / 3;
    }
    out[y * width + x] = sum / n;
  }
  return out;
}

/** How far RGBA frames `a` and `b` lie apart, levels, each averaged over FAST_TO_REFERENCE.over px each side: the mean, and the worst row's. */
function fastToReference(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  const { width, height } = STAMP_GATE_LENS_TILT.frame, boxedA = boxed(a, FAST_TO_REFERENCE.over), boxedB = boxed(b, FAST_TO_REFERENCE.over);
  let sum = 0, row = 0;
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) rowSum += Math.abs(boxedA[y * width + x] - boxedB[y * width + x]);
    sum += rowSum;
    row = Math.max(row, rowSum / width);
  }
  return { mean: sum / (width * height), row };
}

/**
 * Whether, in each frame, the stripes and the bars are each sharp in a band where the tilted focus crosses their
 * depth and soft at their ends; and whether the reference frame agrees with the fast one.
 */
export function checkStampGateLensTilt(frames: readonly Uint8ClampedArray[]): StampGateWashCheck[] {
  const { stripes } = STAMP_GATE_LENS_TILT, wanted = stampGateLensTiltSharpRows();
  const parts = [{ name: 'stripes', columns: stripes, row: wanted.stripes }, { name: 'bars', columns: STAMP_GATE_LENS_TILT.barsRead, row: wanted.bars }] as const;
  const bands = STAMP_GATE_LENS_TILT.frames.flatMap(({ mode }, f) => parts.map(({ name, columns, row }) => {
    const seen = band(rowSharpness(frames[f], columns));
    return {
      id: `${STAMP_GATE_LENS_TILT_ID}: ${name} band, ${mode}`, passed: Math.abs(seen.middle - row) <= SHARP_ROW_WITHIN && seen.end <= ENDS_SOFTER * seen.peak,
      detail: `its sharp band's middle at row ${seen.middle} (${row.toFixed(1)} wanted, within ${SHARP_ROW_WITHIN}), ${seen.peak.toFixed(1)} levels between neighbours at most, ${seen.end.toFixed(1)} at its farther end (at most ${ENDS_SOFTER} of it wanted)`,
    };
  }));
  const apart = fastToReference(frames[0], frames[1]);
  return [
    ...bands,
    {
      id: `${STAMP_GATE_LENS_TILT_ID}: fast as reference`, passed: apart.mean <= FAST_TO_REFERENCE.mean && apart.row <= FAST_TO_REFERENCE.row,
      detail: `averaged over ${2 * FAST_TO_REFERENCE.over + 1} px square, the reference frame lies ${apart.mean.toFixed(2)} levels from the fast one, ${apart.row.toFixed(2)} on its worst row (${FAST_TO_REFERENCE.mean} and ${FAST_TO_REFERENCE.row} allowed)`,
    },
  ];
}
