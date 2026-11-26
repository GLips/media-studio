// stamp-gate-light-spill.ts: the gate's neon on a wall (shot/light-spill). A dark wall is the back at depth 2; a
// pink and a cyan stroke, turned to neon tubes by `neon`, hang at depth 1 and throw their light on it; an opaque bar
// stands nearer, at depth 0.8. As the camera pans, the spill keeps to the wall (it moves as the wall does, not as the
// tubes do); moving the tubes' own lay moves it with them; the bar hides it; and the lens's bloom adds the same light
// whether the wall is lit or not.

import { paintCameraPlay, type PaintCameraMovePose } from '#lib/paint/animation/models/paint-camera.ts';
import { paintKeyed } from '#lib/paint/animation/models/paint-keyed.ts';
import type { Layer, Mix, PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import { layersOf } from '#lib/paint/document/models/painting-selection.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { TITANIUM_WHITE } from '#lib/paint/materials/models/paint-medium.ts';
import { srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { StampPictureRgba } from '#lib/paint/painting/models/stamp-plane.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { neon } from '#lib/paint/shot/models/shot-neon.ts';
import type { PlaneProps, ThreeSource } from '#lib/paint/shot/models/shot-props.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { stampGateHeronPaper } from './stamp-gate-paper-heron.ts';
import { STAMP_GATE_ROUND_REF } from './stamp-gate-sheets.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

const FRAME = { width: 200, height: 120 } as const;
/** The camera's pan over a second, px at depth 1: the wall, at depth 2, moves half as far as the tubes. */
const PAN = 40;
const WALL_DEPTH = 2, SIGN_DEPTH = 1, BAR_DEPTH = 0.8;
/** How far the wall's painting reaches past the frame each side, px, for the pan. */
const WALL_PAST = 30;
/** How far the tubes' own lay moves them right, px, in the frame that moves them. */
export const STAMP_GATE_LIGHT_SPILL_SIGN_MOVE = 30;
/** The bar, frame px at rest: opaque, beside the tubes, in their spill. */
const BAR = { x0: 136, y0: 0, x1: 150, y1: FRAME.height } as const;
/** The scene seconds read: before and after the pan. */
export const STAMP_GATE_LIGHT_SPILL_AT = { rest: 0, panned: 1 } as const;

const { cadmiumRed, ultramarine, phthaloBlue } = WATERCOLOUR_PIGMENTS;
const PINK: Mix = { parts: [{ pigment: cadmiumRed, amount: 1 }, { pigment: ultramarine, amount: 0.15 }, { pigment: TITANIUM_WHITE, amount: 0.6 }], strength: 0.9 };
const CYAN: Mix = { parts: [{ pigment: phthaloBlue, amount: 1 }, { pigment: TITANIUM_WHITE, amount: 1 }], strength: 0.9 };

/** A gouache stroke layer `key` along `points`. */
const stroke = (key: string, points: readonly { x: number; y: number }[], mix: Mix): Layer => ({
  key, medium: 'gouache', washes: [{ key: `${key}-wash`, applications: [{
    key: `${key}-stroke`, on: 'dry', kind: 'stroke', subpaths: [points], brush: STAMP_GATE_ROUND_REF, diameterPx: 3, seed: key, charge: { kind: 'paint', mix, opacityCap: 1 },
  }] }],
});

/** The sign: a pink zigzag and a cyan bar beside it, frame-sized, the strokes in its middle. */
export const STAMP_GATE_LIGHT_SPILL_SIGN: PaintingSourceModule = {
  default: function gateNeonSign(): PaintingDocument {
    return {
      widthPx: FRAME.width, heightPx: FRAME.height, paper: stampGateHeronPaper('#f3eee2', 1), medium: 'gouache',
      layers: [
        stroke('pink', [{ x: 72, y: 80 }, { x: 72, y: 40 }, { x: 98, y: 80 }, { x: 98, y: 40 }], PINK),
        stroke('cyan', [{ x: 112, y: 40 }, { x: 112, y: 80 }], CYAN),
      ],
    };
  },
};

/** The wall: dark paper, nothing painted on it, reaching WALL_PAST px past the frame each side. */
export const STAMP_GATE_LIGHT_SPILL_WALL: PaintingSourceModule = {
  default: (): PaintingDocument => ({
    widthPx: FRAME.width + 2 * WALL_PAST, heightPx: FRAME.height + 2 * WALL_PAST, paper: stampGateHeronPaper('#4a3c42', 1), medium: 'watercolour', layers: [{ key: 'wall', washes: [] }],
  }),
};

/** The bar: an opaque near-black picture over BAR. */
function barPlane(margin: number): PlaneProps {
  const dark = srgbToLinear(0x14 / 255), w = BAR.x1 - BAR.x0, h = BAR.y1 - BAR.y0;
  const picture: StampPictureRgba = { box: { x: BAR.x0 + margin, y: BAR.y0 + margin, w, h }, rgba: new Float32Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 1 : dark)) };
  const box = { x0: BAR.x0, y0: BAR.y0, x1: BAR.x1, y1: BAR.y1 };
  return { id: 'bar', depth: BAR_DEPTH, source: { kind: 'picture', extent: { kind: 'box', box }, pictureAt: () => Promise.resolve(picture) } };
}

/** The neon the case lights the wall with: steady, so frames read alike. */
export const STAMP_GATE_NEON = neon({ palette: ['#ff3fa4', '#3ff0ff'], tube: { width: 2, core: 0.35, intensity: 2 }, spill: { reach: 16, gain: 8, added: 0.3 }, flicker: false });

/**
 * How a frame of the case is drawn: the wall `lit` by the tubes or not; the lens's `bloom` sigma; the bar shown;
 * the camera panning; and the tubes' lay moved right by STAMP_GATE_LIGHT_SPILL_SIGN_MOVE.
 */
export type StampGateLightSpillDrawn = { readonly lit: boolean; readonly bloom: number; readonly bar: boolean; readonly pan: boolean; readonly moved: boolean };

/**
 * The three screen's disc, frame px at rest, and its depth: right of the tubes and clear of them panned or not, in
 * their spill, which past it falls on the wall unlit.
 */
export const STAMP_GATE_LIGHT_SPILL_SCREEN = { x: 150, y: 60, r: 22, depth: 1.6 } as const;

export const STAMP_GATE_LIGHT_SPILL_BASELINE: StampGateLightSpillDrawn = { lit: true, bloom: 4, bar: true, pan: true, moved: false };

/** The case's shot drawn as `drawn` says; given a three `screen`, it stands between wall and tubes and takes the light instead. */
export function stampGateLightSpillShot({ lit, bloom, bar, pan, moved }: StampGateLightSpillDrawn, screen?: ThreeSource): StampGateShot {
  // The stage reaches past the frame as far as the nearest plane travels: the bar, PAN ÷ BAR_DEPTH.
  const stage = stampStage(FRAME, 2 * Math.ceil(PAN / BAR_DEPTH / 2) + 2);
  const move = paintKeyed<PaintCameraMovePose>([{ at: STAMP_GATE_LIGHT_SPILL_AT.rest, value: { pan: { x: 0, y: 0 } } }, { at: STAMP_GATE_LIGHT_SPILL_AT.panned, value: { pan: { x: PAN, y: 0 } } }]);
  const wall: PlaneProps = {
    id: 'wall', depth: WALL_DEPTH, source: layersOf(painting(STAMP_GATE_LIGHT_SPILL_WALL), ['wall']),
    lay: { placement: { x: -WALL_PAST, y: -WALL_PAST, rotation: 0, scale: 1 }, pivot: { x: 0, y: 0 } },
  };
  const sign = STAMP_GATE_NEON.place(layersOf(painting(STAMP_GATE_LIGHT_SPILL_SIGN), ['pink', 'cyan'], { ground: 'transparent' }), {
    id: 'sign', depth: SIGN_DEPTH, ...(moved && { lay: { placement: { x: STAMP_GATE_LIGHT_SPILL_SIGN_MOVE, y: 0, rotation: 0, scale: 1 }, pivot: { x: 0, y: 0 } } }),
  });
  return {
    camera: { stage, fov: 35, lens: { bloom, shutter: 'shut' }, plays: pan ? [paintCameraPlay({ kind: 'move', value: move }, { clock: { at: 0 }, origin: 'pan' })] : [] },
    planes: screen
      ? [wall, (lit ? STAMP_GATE_NEON.light : (plane: PlaneProps) => plane)({ id: 'screen', depth: STAMP_GATE_LIGHT_SPILL_SCREEN.depth, source: screen }, 'sign'), sign]
      : [lit ? STAMP_GATE_NEON.light(wall, 'sign') : wall, sign, ...(bar ? [barPlane(stage.margin)] : [])],
  };
}

/** A frame's RGB bytes as linear luma, texel by texel. */
const linearLuma = (rgb: ArrayLike<number>) =>
  Float64Array.from({ length: rgb.length / 3 }, (_, i) => 0.2126 * srgbToLinear(rgb[i * 3] / 255) + 0.7152 * srgbToLinear(rgb[i * 3 + 1] / 255) + 0.0722 * srgbToLinear(rgb[i * 3 + 2] / 255));

/** `lit` less `unlit`, linear luma, texel by texel. */
const spillOf = (lit: ArrayLike<number>, unlit: ArrayLike<number>) => {
  const a = linearLuma(lit), b = linearLuma(unlit);
  return a.map((v, i) => v - b[i]);
};

/** The rows the tubes leave clear wherever they're laid, above and below them: there the wall shows its spill whole. */
const clearOfTubes = (i: number) => {
  const y = Math.floor(i / FRAME.width);
  return y < 32 || y >= 88;
};

/** Where along x a spill's light lies on average, in rows clear of the tubes: its columns weighed by the light in them. */
function centreX(spill: Float64Array) {
  let sum = 0, weight = 0;
  spill.forEach((v, i) => {
    const w = clearOfTubes(i) ? Math.max(0, v) : 0;
    sum += w * ((i % FRAME.width) + 0.5);
    weight += w;
  });
  return sum / weight;
}

/** `values` over frame px `box`, row by row. */
function boxValues(values: ArrayLike<number>, { x0, y0, x1, y1 }: { x0: number; y0: number; x1: number; y1: number }) {
  const out: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push(values[y * FRAME.width + x]);
  return out;
}

/** The mean of `values` over frame px `box`. */
function boxMean(values: ArrayLike<number>, { x0, y0, x1, y1 }: { x0: number; y0: number; x1: number; y1: number }) {
  let sum = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += values[y * FRAME.width + x];
  return sum / ((x1 - x0) * (y1 - y0));
}

/**
 * The frames the checks read, RGB bytes, each lit and unlit: with no bar, at rest and panned, and with the tubes'
 * lay moved; with the bar at rest; with the bar at rest bloomed (the baseline's lens) and not; the three screen at rest and panned.
 */
export type StampGateLightSpillFrames = Readonly<Record<'rest' | 'panned' | 'moved' | 'barred' | 'bloomed' | 'screen' | 'screenPanned', { readonly lit: ArrayLike<number>; readonly unlit: ArrayLike<number> }>>;

/** px the spill's centre may stray from where the wall, or the tubes' lay, carries it. */
const CENTRE_SLACK = 2;
/** Linear luma the spill must add beside the tubes, and the most it may add under the bar. */
const LIT_LEAST = 0.01, HIDDEN_MOST = 0.0005;
/** Linear luma the spill on the panned three disc may stray by from the rest frame's, moved as the disc moves. */
const SCREEN_SLACK = 0.01;
/** Linear luma the bloom's light may differ by, lit or not, at any texel: two 8-bit steps where the bloom is brightest. */
const BLOOM_SLACK = 0.008;

const f = (value: number, digits = 1) => value.toFixed(digits);

/**
 * shot/light-spill: the spill lights the wall; panning, it moves as the wall does, not as the tubes do; moving the
 * tubes' lay moves it as far; the bar hides it; and the bloom adds the same light to a lit wall as to an unlit one.
 */
export function checkStampGateLightSpill(frames: StampGateLightSpillFrames): StampGateWashCheck[] {
  const [rest, panned, moved, barred] = (['rest', 'panned', 'moved', 'barred'] as const).map((key) => spillOf(frames[key].lit, frames[key].unlit));
  const below = boxMean(rest, { x0: 70, y0: 88, x1: 116, y1: 100 });
  const wallShift = -PAN / WALL_DEPTH, signShift = -PAN / SIGN_DEPTH;
  const panShift = centreX(panned) - centreX(rest), moveShift = centreX(moved) - centreX(rest);
  const hidden = Math.max(...Array.from({ length: BAR.y1 - BAR.y0 }, (_, y) => Math.max(...Array.from({ length: BAR.x1 - BAR.x0 }, (__, x) => Math.abs(barred[(BAR.y0 + y) * FRAME.width + BAR.x0 + x])))));
  const beside = boxMean(barred, { x0: BAR.x0 - 10, y0: 40, x1: BAR.x0 - 2, y1: 80 });
  const unbloomed = spillOf(frames.barred.lit, frames.barred.unlit), bloomed = spillOf(frames.bloomed.lit, frames.bloomed.unlit);
  // Where a frame clips a channel, its light can't add: those texels are left out.
  const clipped = (i: number) => [frames.barred.lit, frames.bloomed.lit].some((rgb) => Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) >= 250);
  const screen = spillOf(frames.screen.lit, frames.screen.unlit), { x: cx, y: cy, r } = STAMP_GATE_LIGHT_SPILL_SCREEN;
  const onScreen = boxMean(screen, { x0: cx - 5, y0: cy + r - 8, x1: cx + 5, y1: cy + r - 4 });
  const pastScreen = Math.max(...Array.from(boxValues(screen, { x0: cx - 5, y0: cy + r + 4, x1: cx + 5, y1: cy + r + 10 }), Math.abs));
  // Panned, the spill on the screen should be the rest frame's moved as the screen moves; moved as the tubes do, it strays.
  const screenPanned = spillOf(frames.screenPanned.lit, frames.screenPanned.unlit), screenShift = Math.round(-PAN / STAMP_GATE_LIGHT_SPILL_SCREEN.depth);
  // A square well inside the disc: past r/√2 its corners would leave it.
  const half = Math.floor(r * 0.55);
  const strayAt = (shift: number) => Math.max(...boxValues(screen, { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half }).map((v, i) => {
    const x = cx - half + (i % (2 * half)), y = cy - half + Math.floor(i / (2 * half));
    return Math.abs(v - screenPanned[y * FRAME.width + x + shift]);
  }));
  const screenStray = strayAt(screenShift), tubesStray = strayAt(Math.round(signShift));
  const bloomStray = Math.max(...bloomed.map((v, i) => (clipped(i) ? 0 : Math.abs(v - unbloomed[i]))));
  return [
    {
      id: 'shot/light-spill: lights the wall', passed: below >= LIT_LEAST,
      detail: `below the tubes the wall gains ${f(below, 4)} of linear luma lit (${LIT_LEAST} or more wanted)`,
    },
    {
      id: 'shot/light-spill: stays on the wall as the camera pans', passed: Math.abs(panShift - wallShift) <= CENTRE_SLACK,
      detail: `panned ${PAN} px, the spill's centre moves ${f(panShift)} px: the wall moves ${f(wallShift)}, the tubes ${f(signShift)} (${CENTRE_SLACK} px of the wall's allowed)`,
    },
    {
      id: 'shot/light-spill: follows the tubes\' lay', passed: Math.abs(moveShift - STAMP_GATE_LIGHT_SPILL_SIGN_MOVE) <= CENTRE_SLACK,
      detail: `the tubes laid ${STAMP_GATE_LIGHT_SPILL_SIGN_MOVE} px right, the spill's centre moves ${f(moveShift)} px (${CENTRE_SLACK} px of it allowed)`,
    },
    {
      id: 'shot/light-spill: hidden by what stands nearer', passed: hidden <= HIDDEN_MOST && beside >= LIT_LEAST,
      detail: `under the bar the spill adds ${f(hidden, 5)} of linear luma at most (${HIDDEN_MOST} allowed); just beside it, ${f(beside, 4)} (${LIT_LEAST} or more wanted)`,
    },
    {
      id: 'shot/light-spill: lights a three plane where it covers', passed: onScreen >= LIT_LEAST && pastScreen <= HIDDEN_MOST,
      detail: `a three disc lit in frame px gains ${f(onScreen, 4)} of linear luma inside its rim (${LIT_LEAST} or more wanted) and ${f(pastScreen, 5)} at most just past it, where it's clear (${HIDDEN_MOST} allowed)`,
    },
    {
      id: 'shot/light-spill: stays on a three plane as the camera pans', passed: screenStray <= SCREEN_SLACK && tubesStray > 2 * SCREEN_SLACK,
      detail: `panned ${PAN} px, the spill inside the three disc, moved ${screenShift} px as the disc moves, strays ${f(screenStray, 4)} of linear luma at most (${SCREEN_SLACK} allowed); moved as the tubes move, ${f(tubesStray, 4)}`,
    },
    {
      id: 'shot/light-spill: bloom apart from spill', passed: bloomStray <= BLOOM_SLACK,
      detail: `bloomed by the lens, the spill adds light differing by ${f(bloomStray, 4)} of linear luma at most from what it adds unbloomed (${BLOOM_SLACK} allowed): a lit wall emits nothing`,
    },
  ];
}
