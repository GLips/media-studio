// stamp-gate-animation.ts: the paintings the GPU gate animates and the properties it holds their frames to, none a
// baseline:
//
// - drift: a moving group's texture travels with it (stuck), so frame k moved back by its motion is frame 0;
// - boil: a group boiling on twos holds within an epoch, changes across epochs, leaves a still group alone, and
//   frame 0 drawn again is frame 0;
// - boil-wash: a boiling wash whose marks have nothing random to re-roll draws every epoch as frame 0, its paint
//   flowing as far into the wet paper whichever epoch lays it;
// - sunset: one painting in two palettes lays the same coverage deposit by deposit; only its colour changes.

import { PAINT_MEDIA } from '#lib/picture/paint/models/paint-medium.ts';
import type { PaintPigmentAppearance } from '#lib/picture/paint/models/paint-pigment.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/picture/paint/models/paint-watercolour-pigments.ts';
import { stampLinearDynamics } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { StampGroupBoil, StampGroupMotion } from '#lib/picture/stamp-paint/models/stamp-group-motion.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type PaintMaterial, type StampPaintPaper } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import type { StampGateWashCheck } from './stamp-gate-washes.ts';

/** The scene's frame rate the animations are drawn at. */
export const STAMP_GATE_ANIMATION_FPS = 30;
/** How far a drifted frame may sit from frame 0 moved as far, in levels: the output's dither. */
export const STAMP_GATE_DRIFT_TOLERANCE = 1;
/** The least share of the cloud's pixels a new boil epoch must change by more than 2 levels, so a boil that holds fails. */
export const STAMP_GATE_BOIL_CHANGE = 0.01;

const SIZE = { width: 240, height: 160 };
/** How far the drifting cloud moves each frame, in whole pixels, so frames compare pixel for pixel. */
export const STAMP_GATE_DRIFT_STEP = 6;
/** The frames the drift is drawn at, each against frame 0. */
export const STAMP_GATE_DRIFT_FRAMES = [0, 1, 2, 5];
/** Where the cloud lies in frame 0, with paper about it; the ground's rows (the still group) lie below. */
export const STAMP_GATE_CLOUD_BOX = { x0: 15, x1: 150, y0: 25, y1: 118 };
export const STAMP_GATE_GROUND_FROM_ROW = 132;

// A grained paper, so a cloud whose texture swam over it would show.
const PAPER: StampPaintPaper = { color: '#fbf7ee', grain: { image: { style: 'gate', pack: 'gate', file: 'grain.png' }, scale: 0.2, depth: 0.7 } };
/** A brush whose marks are drawn at random, so a boil's re-seeding shows. */
const RANDOM = stampGateBrush('Random', {
  media: 'wet',
  dynamics: stampLinearDynamics({ size: { random: 0.3 } }), scatter: { count: 2, radius: 0.3, lateral: 0.3 }, rotation: { angle: 0, randomStart: true },
  grain: { kind: 'canvas', image: { style: 'gate', pack: 'gate', file: 'grain.png' }, blend: { family: 'texture', mode: 'multiply' }, scale: 1.5, depth: 0.6, brightness: 0, contrast: 0, contrastPivot: 'midGrey', tiling: 'repeat', offsetJitter: 1 },
});
const mixture = (...parts: { pigment: PaintPigmentAppearance; amount: number }[]): PaintMaterial => ({ kind: 'mixture', parts, strength: 0.8 });

/** A cloud, a wash on paper wetted about it, over a still ground; the cloud moving by `motion` or boiling. */
function cloudPainting(cloud: { motion?: StampGroupMotion; boil?: StampGroupBoil }): StampGatePainting {
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('cloud', { composite: 'glaze', opacity: 1, ...cloud }, (g) => g.wash('puff', { preparation: { region: { kind: 'ellipse', x: 80, y: 70, radiusX: 62, radiusY: 38 } } }, (w) => {
      w.fill('body', { brush: RANDOM, diameter: 24, material: mixture({ pigment: W.ultramarine, amount: 1 }), region: { kind: 'ellipse', x: 80, y: 70, radiusX: 48, radiusY: 24 } });
      w.stamps('dab', { brush: RANDOM, diameter: 22, material: mixture({ pigment: W.burntSienna, amount: 1 }), at: [{ x: 62, y: 64 }, { x: 98, y: 76 }] });
    }));
    p.group('ground', { composite: 'glaze', opacity: 1 }, (g) => g.pass('p', {}, (pass) => pass.stroke('line', {
      brush: RANDOM, diameter: 14, material: mixture({ pigment: W.burntSienna, amount: 1 }), path: [{ x: 5, y: 146 }, { x: 235, y: 142 }],
    })));
  }));
  return { painting, paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W }, ...SIZE, t: 0, images: STAMP_GATE_IMAGES };
}

/** The cloud drifting STAMP_GATE_DRIFT_STEP pixels a frame to the right. */
export function stampGateDriftPainting(): StampGatePainting {
  const second = STAMP_GATE_DRIFT_STEP * STAMP_GATE_ANIMATION_FPS;
  return cloudPainting({ motion: { keys: [{ at: 0, x: 0, y: 0 }, { at: 1, x: second, y: 0 }] } });
}

/** The cloud boiling on twos. */
export const stampGateBoilPainting = () => cloudPainting({ boil: { every: 2 } });

/**
 * Wide dabs of paint into a wet wash, boiling on twos, its brush with nothing random: each dab's paint flows well past
 * where its stamps reach.
 */
export function stampGateBoilWashPainting(): StampGatePainting {
  const steady = stampGateBrush('Steady', { flow: 0.6 });
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('dabs', { composite: 'glaze', opacity: 1, boil: { every: 2 } }, (g) => g.wash('wet', { preparation: { region: stampGatePolygon(0, 0, 240, 0, 240, 160, 0, 160) } }, (w) => {
      w.stamps('dabs', { brush: steady, diameter: 40, material: mixture({ pigment: W.ultramarine, amount: 1 }), at: [{ x: 60, y: 80 }, { x: 170, y: 70 }] });
    }));
  }));
  return { painting, paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W }, ...SIZE, t: 0, images: STAMP_GATE_IMAGES };
}

/** Whether each of a boiling wash's frames (one an epoch) is frame 0, within the output's dither. */
export function checkStampGateBoilWash(frames: readonly Rgba[]): StampGateWashCheck {
  const worst = frames.slice(1).map((rgba) => {
    let max = 0;
    for (let i = 0; i < rgba.length; i++) if (i % 4 !== 3) max = Math.max(max, Math.abs(rgba[i] - frames[0][i]));
    return max;
  });
  return {
    id: 'animation/boil-wash: each epoch flows as far', passed: worst.every((max) => max <= STAMP_GATE_DRIFT_TOLERANCE),
    detail: `epochs 1 to ${worst.length} against frame 0: most ${worst.join(', ')} levels (past ${STAMP_GATE_DRIFT_TOLERANCE} fails)`,
  };
}

/** A sky and hill at `hour`: every deposit the same, only its paint changed. */
export function stampGateSunsetPainting(hour: 'day' | 'dusk'): StampGatePainting {
  const sky: PaintMaterial = hour === 'day' ? { kind: 'color', color: '#6fa8dc' } : { kind: 'color', color: '#e0703a' };
  const ground = hour === 'day' ? mixture({ pigment: W.ultramarine, amount: 1 }) : mixture({ pigment: W.ultramarine, amount: 0.4 }, { pigment: W.burntSienna, amount: 1 });
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('sky', { composite: 'glaze', opacity: 1 }, (g) => g.wash('wash', { preparation: { region: stampGatePolygon(0, 0, 240, 0, 240, 100, 0, 100) } }, (w) => {
      w.fill('body', { brush: RANDOM, diameter: 30, material: sky, region: stampGatePolygon(6, 6, 234, 6, 234, 96, 6, 96) });
      w.stamps('drops', { brush: RANDOM, diameter: 22, material: ground, at: [{ x: 60, y: 40 }, { x: 150, y: 60 }] });
    }));
    p.group('hill', { composite: 'opaque' }, (g) => g.pass('p', {}, (pass) => pass.fill('ground', {
      brush: RANDOM, diameter: 20, material: ground, region: stampGatePolygon(0, 160, 0, 115, 120, 95, 240, 110, 240, 160),
    })));
  }));
  return { painting, paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W }, ...SIZE, t: 1, images: STAMP_GATE_IMAGES };
}

export const STAMP_GATE_ANIMATION_IDS = ['animation/drift', 'animation/boil', 'animation/boil-wash', 'animation/sunset'];

type Rgba = ArrayLike<number>;

/** Whether each drawn frame of the drift, moved back by its motion, is frame 0 within STAMP_GATE_DRIFT_TOLERANCE over the cloud. */
export function checkStampGateDrift(frames: readonly { frame: number; rgba: Rgba }[], width: number): StampGateWashCheck {
  const [first, ...rest] = frames, { x0, x1, y0, y1 } = STAMP_GATE_CLOUD_BOX;
  const shifted = rest.map(({ frame, rgba }) => {
    const dx = frame * STAMP_GATE_DRIFT_STEP;
    let max = 0, over = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) {
      const d = Math.abs(rgba[(y * width + x + dx) * 4 + c] - first.rgba[(y * width + x) * 4 + c]);
      max = Math.max(max, d);
      if (d > STAMP_GATE_DRIFT_TOLERANCE) over++;
    }
    return { frame, max, over };
  });
  return {
    id: 'animation/drift: its texture travels with it', passed: shifted.every(({ max }) => max <= STAMP_GATE_DRIFT_TOLERANCE),
    detail: shifted.map(({ frame, max, over }) => `frame ${frame} moved back ${frame * STAMP_GATE_DRIFT_STEP} px: max ${max}, ${over} channels past ${STAMP_GATE_DRIFT_TOLERANCE}`).join('; '),
  };
}

/** The most any channel differs, the most any in the ground's rows does, and the share of the cloud box's channels differing by more than 2 levels. */
function boilDifference(a: Rgba, b: Rgba, width: number, height: number) {
  const { x0, x1, y0, y1 } = STAMP_GATE_CLOUD_BOX;
  let changed = 0, still = 0, max = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
    const d = Math.abs(a[(y * width + x) * 4 + c] - b[(y * width + x) * 4 + c]);
    max = Math.max(max, d);
    if (y >= STAMP_GATE_GROUND_FROM_ROW) still = Math.max(still, d);
    if (d > 2 && x >= x0 && x < x1 && y >= y0 && y < y1) changed++;
  }
  return { max, still, changed: changed / ((x1 - x0) * (y1 - y0) * 3) };
}

/**
 * Whether frames 0, 1, 2… of a cloud boiling on twos hold within an epoch and change across one, the ground below never
 * changing, and whether frame 0 drawn again after them is frame 0.
 */
export function checkStampGateBoil(frames: readonly Rgba[], again: Rgba, width: number, height: number): StampGateWashCheck {
  const steps = frames.slice(1).map((rgba, k) => {
    const { max, still, changed } = boilDifference(frames[k], rgba, width, height);
    return { from: k, to: k + 1, newEpoch: (k + 1) % 2 === 0, max, still, changed };
  });
  const back = boilDifference(frames[0], again, width, height);
  const problems = [
    ...steps.filter((s) => !s.newEpoch && s.max > 0).map((s) => `frames ${s.from} and ${s.to} share an epoch and differ by ${s.max}`),
    ...steps.filter((s) => s.newEpoch && s.changed < STAMP_GATE_BOIL_CHANGE).map((s) => `frame ${s.to} starts an epoch and changes only ${(s.changed * 100).toFixed(2)}% of the cloud`),
    ...steps.filter((s) => s.still > 0).map((s) => `the ground changed by ${s.still} from frame ${s.from} to ${s.to}`),
    ...(back.max > 0 ? [`frame 0 drawn again differs by ${back.max}`] : []),
  ];
  return {
    id: 'animation/boil: on twos', passed: !problems.length,
    detail: problems.length ? problems.join('; ') : steps.map((s) => `${s.from}→${s.to} ${s.newEpoch ? `${(s.changed * 100).toFixed(1)}% changed` : 'held'}`).join(', ') + '; the ground held; frame 0 again identical',
  };
}

/** Whether each deposit's traced coverage in one palette is its coverage in the other. */
export function checkStampGateSunset(day: readonly ArrayLike<number>[], dusk: readonly ArrayLike<number>[]): StampGateWashCheck {
  if (day.length !== dusk.length) throw new Error(`stamp gate: the sunset's palettes traced ${day.length} and ${dusk.length} deposits`);
  const worst = day.map((coverage, i) => {
    let max = 0;
    for (let k = 0; k < coverage.length; k++) max = Math.max(max, Math.abs(coverage[k] - dusk[i][k]));
    return max;
  });
  return {
    id: 'animation/sunset: only the colour changes', passed: worst.every((max) => max === 0),
    detail: `${worst.length} deposits, the most any coverage differs ${Math.max(...worst)}`,
  };
}
