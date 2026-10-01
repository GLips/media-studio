// stamp-gate-animation.ts: the paintings the GPU gate animates and the properties their frames are held to:
//
// - drift: a moving group's texture travels with it, so frame k moved back by its motion is frame 0;
// - boil: a group boiling on twos holds within an epoch, changes across them, leaves a still group alone;
// - boil-wash: a boiling wash with nothing random in its marks flows as far each epoch, only its rim's line re-rolling;
// - bloom-boil: a bloom in it holds within an epoch and re-rolls its front at the next (the epoch's seed);
// - sunset: one painting in two palettes lays the same coverage deposit by deposit;
// - effects-sunset: a sky's bloom and rim change its coverage alike at every hour.

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
/**
 * The most share of the boiling wash's pixels an epoch may change past the dither: its drying rim's line re-rolls
 * each epoch, a few pixels along the dabs' edges, where an epoch whose paint didn't flow would change thousands.
 */
export const STAMP_GATE_BOIL_WASH_RIM_SHARE = 0.001;
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

/** Where the bloom-boil's front lies, its wash's edges (and the drying rim's re-rolled line) well outside. */
export const STAMP_GATE_BLOOM_BOX = { x0: 70, x1: 170, y0: 45, y1: 115 };

/**
 * A drop of water into a damp wash, boiling on twos, its brushes with nothing random: only the bloom's (and the rim's)
 * seed re-rolls.
 */
export function stampGateBloomBoilPainting(): StampGatePainting {
  const steady = stampGateBrush('Steady', { flow: 0.6 });
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('bloom', { composite: 'glaze', opacity: 1, boil: { every: 2 } }, (g) => g.wash('wash', {}, (w) => {
      w.fill('sky', { brush: steady, diameter: 40, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, 230, 10, 230, 150, 10, 150), material: mixture({ pigment: W.ultramarine, amount: 1 }) });
      w.bloom('drop', { brush: steady, diameter: 30, at: [{ x: 120, y: 80 }] });
    }));
  }));
  return { painting, paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W }, ...SIZE, t: 0, images: STAMP_GATE_IMAGES };
}

/**
 * Whether frames 0 and 1 of the bloom-boil (one epoch) are the same, and frame 2 (the next) moves its front: at least
 * STAMP_GATE_BOIL_CHANGE of the bloom's box past 2 levels.
 */
export function checkStampGateBloomBoil([first, same, next]: readonly Rgba[]): StampGateWashCheck {
  const { x0, x1, y0, y1 } = STAMP_GATE_BLOOM_BOX;
  let held = 0, changed = 0;
  for (let i = 0; i < first.length; i++) if (i % 4 !== 3) held = Math.max(held, Math.abs(same[i] - first[i]));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * SIZE.width + x) * 4;
    if ([0, 1, 2].some((c) => Math.abs(next[i + c] - first[i + c]) > 2)) changed++;
  }
  const share = changed / ((x1 - x0) * (y1 - y0));
  return {
    id: 'animation/bloom-boil: its front re-rolls each epoch', passed: held === 0 && share >= STAMP_GATE_BOIL_CHANGE,
    detail: `frames 0 and 1 differ by ${held} (past 0 fails); frame 2 changes ${(share * 100).toFixed(2)}% of the bloom's box past 2 levels (under ${STAMP_GATE_BOIL_CHANGE * 100}% fails)`,
  };
}

/** Whether each of a boiling wash's frames (one an epoch) is frame 0, within the output's dither. */
export function checkStampGateBoilWash(frames: readonly Rgba[]): StampGateWashCheck {
  const pixels = frames[0].length / 4;
  const changed = frames.slice(1).map((rgba) => {
    let count = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (Math.max(...[0, 1, 2].map((c) => Math.abs(rgba[i + c] - frames[0][i + c]))) > STAMP_GATE_DRIFT_TOLERANCE) count++;
    }
    return count;
  });
  return {
    id: 'animation/boil-wash: each epoch flows as far', passed: changed.every((count) => count <= STAMP_GATE_BOIL_WASH_RIM_SHARE * pixels),
    detail: `epochs 1 to ${changed.length} against frame 0: ${changed.join(', ')} pixels past ${STAMP_GATE_DRIFT_TOLERANCE} level (past ${STAMP_GATE_BOIL_WASH_RIM_SHARE * pixels} fails)`,
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

type Parts = readonly (readonly [PaintPigmentAppearance, number])[];
/** The effects sunset's hours: each element's paint as strong at every one, only its hue moving toward dusk. */
export const STAMP_GATE_EFFECTS_SUNSET_HOURS: readonly { hour: string; sky: Parts; sun: Parts }[] = [
  { hour: 'afternoon', sky: [[W.cerulean, 0.3]], sun: [[W.hansaYellow, 0.3]] },
  { hour: 'sunset', sky: [[W.quinacridoneRose, 0.15], [W.hansaYellow, 0.15]], sun: [[W.quinacridoneRose, 0.15], [W.hansaYellow, 0.15]] },
  { hour: 'dusk', sky: [[W.ultramarine, 0.18], [W.quinacridoneRose, 0.12]], sun: [[W.quinacridoneRose, 0.22], [W.burntSienna, 0.08]] },
];
const partsPaint = (parts: Parts): PaintMaterial => ({
  kind: 'mixture', parts: parts.map(([pigment, amount]) => ({ pigment, amount })), strength: parts.reduce((sum, [, amount]) => sum + amount, 0),
});
export const STAMP_GATE_EFFECTS_SUNSET_TOLERANCE = 0.01;

/**
 * A sky puddled on dry paper, so it rims, its sun's glow stroked in and water dropped in at damp, a bloom, at an hour:
 * every deposit the same, only its pigments changed.
 */
export function stampGateEffectsSunsetPainting({ sky, sun }: (typeof STAMP_GATE_EFFECTS_SUNSET_HOURS)[number]): StampGatePainting {
  const steady = stampGateBrush('Steady', { flow: 0.6 });
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('sky', { composite: 'glaze', opacity: 1 }, (g) => g.wash('sky', {}, (w) => {
      w.fill('sky', { brush: steady, diameter: 40, application: { kind: 'flood' }, region: stampGatePolygon(16, 16, 224, 12, 226, 144, 14, 140), material: partsPaint(sky), water: 1 });
      w.stroke('glow', { brush: steady, diameter: 30, material: partsPaint(sun), path: [{ x: 30, y: 110 }, { x: 90, y: 104 }, { x: 150, y: 112 }, { x: 210, y: 106 }] });
      w.bloom('sun', { brush: steady, diameter: 36, at: [{ x: 160, y: 60 }] });
    }));
  }));
  return { painting, paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W }, ...SIZE, t: 1, images: STAMP_GATE_IMAGES };
}

/**
 * Whether the bloom and drying rim change the sky's coverage alike at every hour: each hour's coverage with them less
 * its coverage without, against the first hour's, within STAMP_GATE_EFFECTS_SUNSET_TOLERANCE.
 */
export function checkStampGateEffectsSunset(hours: readonly { on: ArrayLike<number>; off: ArrayLike<number> }[]): StampGateWashCheck {
  const [first, ...rest] = hours;
  let peak = 0;
  for (let i = 0; i < first.on.length; i++) peak = Math.max(peak, Math.abs(first.on[i] - first.off[i]));
  const worst = rest.map(({ on, off }) => {
    let max = 0;
    for (let i = 0; i < on.length; i++) max = Math.max(max, Math.abs(on[i] - off[i] - (first.on[i] - first.off[i])));
    return max;
  });
  return {
    id: 'animation/effects-sunset: blooms and rims hold their shape as the colour changes',
    // An effect that changed no coverage would hold its shape trivially.
    passed: peak > 0.05 && worst.every((max) => max <= STAMP_GATE_EFFECTS_SUNSET_TOLERANCE),
    detail: `the effects change coverage by up to ${peak.toFixed(3)} (0.05 or less fails); against ${STAMP_GATE_EFFECTS_SUNSET_HOURS[0].hour}, ${worst.map((max, k) => `${STAMP_GATE_EFFECTS_SUNSET_HOURS[k + 1].hour} differs by ${max.toFixed(4)}`).join(', ')} (past ${STAMP_GATE_EFFECTS_SUNSET_TOLERANCE} fails)`,
  };
}

export const STAMP_GATE_ANIMATION_IDS = ['animation/drift', 'animation/boil', 'animation/boil-wash', 'animation/bloom-boil', 'animation/sunset', 'animation/effects-sunset'];

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
