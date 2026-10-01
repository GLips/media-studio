// stamp-gate-animation.ts: the paintings the GPU gate animates and the properties their frames are held to:
//
// - drift: a moving group's texture travels with it;
// - boil: a group boiling on twos holds within an epoch and changes across them;
// - boil-wash: a boiling wash without random marks flows as far each epoch;
// - bloom-boil: a bloom holds within an epoch and re-rolls its front at the next;
// - sunset: one painting in two palettes lays the same coverage deposit by deposit;
// - effects-sunset: a bloom and rim change coverage alike at every hour;
// - recolour: keyed day to dusk, it's the halfway paint halfway, in any frame order;
// - cut-out: a group carries its own paper;
// - knockout: what a group takes from behind moves with it.

import { PAINT_MEDIA } from '#lib/picture/paint/models/paint-medium.ts';
import { paintMixtureAmounts } from '#lib/picture/paint/models/paint-mixture.ts';
import type { PaintPigmentAppearance } from '#lib/picture/paint/models/paint-pigment.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/picture/paint/models/paint-watercolour-pigments.ts';
import { stampLinearDynamics } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { StampGroupBoil, StampGroupMotion, StampGroupPaper } from '#lib/picture/stamp-paint/models/stamp-group-motion.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type PaintMaterial, type StampPaintMaterial, type StampPaintPaper } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
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
  return sunsetPainting(sky, hour === 'day' ? DAY_GROUND : DUSK_GROUND, 1);
}

const DAY_GROUND = mixture({ pigment: W.ultramarine, amount: 1 }), DUSK_GROUND = mixture({ pigment: W.ultramarine, amount: 0.4 }, { pigment: W.burntSienna, amount: 1 });
const DAY_SKY = mixture({ pigment: W.ultramarine, amount: 0.3 }), DUSK_SKY = mixture({ pigment: W.quinacridoneRose, amount: 0.5 }, { pigment: W.burntSienna, amount: 0.3 });
/** When the recolouring sunset's keys fall, s: day at the first, dusk at the second. */
export const STAMP_GATE_RECOLOUR_KEYS = [0.2, 1.2] as const;

/** The mixture halfway from `a` to `b`: each pigment's absolute amount eased, as a keyed material eases between keys. */
function halfwayMixture(a: PaintMaterial, b: PaintMaterial): PaintMaterial {
  if (a.kind !== 'mixture' || b.kind !== 'mixture') throw new Error('stamp gate: the recolour eases mixtures');
  const amounts = new Map<PaintPigmentAppearance, number>();
  for (const { pigment, amount } of [...paintMixtureAmounts(a), ...paintMixtureAmounts(b)]) amounts.set(pigment, (amounts.get(pigment) ?? 0) + amount / 2);
  const parts = [...amounts].map(([pigment, amount]) => ({ pigment, amount }));
  return { kind: 'mixture', parts, strength: parts.reduce((sum, { amount }) => sum + amount, 0) };
}

/**
 * The sunset recoloured over its scene, its sky and ground keyed from day to dusk (`keyed`), or painted still in the
 * paint the keys have halfway (`halfway`), which the keyed painting halfway must match.
 */
export function stampGateRecolourPainting(paint: 'keyed' | 'halfway'): StampGatePainting {
  const [from, to] = STAMP_GATE_RECOLOUR_KEYS;
  const keyed = (day: PaintMaterial, dusk: PaintMaterial): StampPaintMaterial => ({ kind: 'keys', keys: [{ at: from, material: day }, { at: to, material: dusk }] });
  return paint === 'keyed'
    ? sunsetPainting(keyed(DAY_SKY, DUSK_SKY), keyed(DAY_GROUND, DUSK_GROUND), from)
    : sunsetPainting(halfwayMixture(DAY_SKY, DUSK_SKY), halfwayMixture(DAY_GROUND, DUSK_GROUND), from);
}

/** The sunset's sky wash, with drops of the ground's paint, over an opaque hill, drawn at `t`. */
function sunsetPainting(sky: StampPaintMaterial, ground: StampPaintMaterial, t: number): StampGatePainting {
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('sky', { composite: 'glaze', opacity: 1 }, (g) => g.wash('wash', { preparation: { region: stampGatePolygon(0, 0, 240, 0, 240, 100, 0, 100) } }, (w) => {
      w.fill('body', { brush: RANDOM, diameter: 30, material: sky, region: stampGatePolygon(6, 6, 234, 6, 234, 96, 6, 96) });
      w.stamps('drops', { brush: RANDOM, diameter: 22, material: ground, at: [{ x: 60, y: 40 }, { x: 150, y: 60 }] });
    }));
    p.group('hill', { composite: 'opaque' }, (g) => g.pass('p', {}, (pass) => pass.fill('ground', {
      brush: RANDOM, diameter: 20, material: ground, region: stampGatePolygon(0, 160, 0, 115, 120, 95, 240, 110, 240, 160),
    })));
  }));
  return { painting, paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W }, ...SIZE, t, images: STAMP_GATE_IMAGES };
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
/**
 * How far the effects' coverage change may differ between two hours, anywhere: the flow before them leaves a fringe's
 * coverage a little different by the pigments' granulation, and the rim and bloom may carry that, not amplify it.
 */
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


/** The cut-out's hull in frame 0, and its lights' cores, where the lift takes all and the fluid holds all off. */
const CUT_OUT_HULL = { x: 80, y: 108, radiusX: 52, radiusY: 16 };
/** Where the cut-out wholly covers the sky in frame 0, as a test of a pixel: its hull's body. */
const coveredByCutOut = (x: number, y: number) => ((x - CUT_OUT_HULL.x) / (CUT_OUT_HULL.radiusX - 20)) ** 2 + ((y - CUT_OUT_HULL.y) / (CUT_OUT_HULL.radiusY - 8)) ** 2 <= 1;

/** A circle of radius `r` about a point, as a region. */
const disc = ({ x, y }: { x: number; y: number }, r: number) => ({ kind: 'ellipse' as const, x, y, radiusX: r, radiusY: r });
const steadyBrush = () => stampGateBrush('Steady', { flow: 0.6 });
const flood = (region: ReturnType<typeof disc>) => ({ kind: 'fill' as const, brush: steadyBrush(), diameter: 20, application: { kind: 'flood' as const }, region });
const gatePainting = (painting: StampGatePainting['painting']): StampGatePainting => ({
  painting, paper: { ...PAPER, image: { style: 'gate', pack: 'gate', file: 'photograph.png' } }, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W }, ...SIZE, t: 0, images: STAMP_GATE_IMAGES,
});
/** Moving STAMP_GATE_DRIFT_STEP pixels a frame. */
const drifting: StampGroupMotion = { keys: [{ at: 0, x: 0, y: 0 }, { at: 1, x: STAMP_GATE_DRIFT_STEP * STAMP_GATE_ANIMATION_FPS, y: 0 }] };

/** A granulating sky glazed over the paper's photograph, under an opaque, granulating hull drifting on `paper`. */
export function stampGateCutOutPainting(paper: StampGroupPaper): StampGatePainting {
  return gatePainting(compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('sky', { composite: 'glaze', opacity: 1 }, (g) => g.pass('wash', {}, (pass) => pass.fill('sky', {
      brush: steadyBrush(), diameter: 40, application: { kind: 'flood' }, material: mixture({ pigment: W.ultramarine, amount: 1 }), region: stampGatePolygon(0, 0, 240, 0, 240, 160, 0, 160),
    })));
    p.group('cut-out', { composite: 'opaque', paper, motion: drifting }, (g) => g.wash('boat', {}, (w) => w.fill('hull', {
      brush: steadyBrush(), diameter: 24, application: { kind: 'flood' }, material: mixture({ pigment: W.ultramarine, amount: 1 }, { pigment: W.burntSienna, amount: 1 }),
      region: { kind: 'ellipse', ...CUT_OUT_HULL },
    })));
  })));
}

/** The most a drifted frame, moved back by its motion, differs from frame 0 where the cut-out wholly covers the sky, in levels. */
function cutOutDrift(first: Rgba, { frame, rgba }: { frame: number; rgba: Rgba }, width: number) {
  const dx = frame * STAMP_GATE_DRIFT_STEP;
  let max = 0;
  for (let y = 0; y < SIZE.height; y++) for (let x = 0; x < width - dx; x++) {
    if (!coveredByCutOut(x, y)) continue;
    for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(rgba[(y * width + x + dx) * 4 + c] - first[(y * width + x) * 4 + c]));
  }
  return max;
}

/**
 * Whether a cut-out on its own paper drifts with its paper (each frame moved back is frame 0 within the dither) and
 * draws frame 0 again the same; whether on the ground's paper it doesn't, so the check bites; and whether, unmoved,
 * it's the ground's exactly.
 */
export function checkStampGateCutOut({ own, ground, width }: {
  own: { frames: readonly { frame: number; rgba: Rgba }[]; again: Rgba }; ground: { frames: readonly { frame: number; rgba: Rgba }[] }; width: number;
}): StampGateWashCheck {
  const [first, ...rest] = own.frames;
  const drift = Math.max(...rest.map((drawn) => cutOutDrift(first.rgba, drawn, width)));
  const groundDrift = Math.max(...ground.frames.slice(1).map((drawn) => cutOutDrift(ground.frames[0].rgba, drawn, width)));
  const again = mostApart(own.again, first.rgba), papers = mostApart(first.rgba, ground.frames[0].rgba);
  const problems = [
    ...(drift > STAMP_GATE_DRIFT_TOLERANCE ? [`its own paper drifts by up to ${drift} levels (past ${STAMP_GATE_DRIFT_TOLERANCE} fails)`] : []),
    ...(groundDrift <= STAMP_GATE_DRIFT_TOLERANCE ? [`on the ground's paper it drifts by only ${groundDrift}, so the photograph doesn't show under it and the check can't bite`] : []),
    ...(again > 0 ? [`frame 0 drawn again after the rest differs by ${again}`] : []),
    ...(papers > 0 ? [`unmoved, its own paper differs from the ground's by ${papers}`] : []),
  ];
  return {
    id: 'animation/cut-out: it carries its paper', passed: !problems.length,
    detail: problems.length ? problems.join('; ') : `drifts within ${drift} (the ground's paper: ${groundDrift}); frame 0 again identical; unmoved, the ground's exactly`,
  };
}

/**
 * The knockout's reserve and lift: the reserve's fluid, its water reaching past it; the lift out of paper its
 * preparation wets, its core over the ultramarine at frame 0 and over the phthalo at STAMP_GATE_KNOCKOUT_FAR.
 */
const KNOCKOUT = { reserve: { x: 40, y: 110, r: 6 }, lift: { x: 60, y: 50, r: 7 } };
/** Where the sky turns from ultramarine (low staining) to phthalo blue (high). */
const KNOCKOUT_SKY_SPLIT = 120;
/** A frame far enough on that the lift lies over the phthalo and the reserve has left its first place. */
export const STAMP_GATE_KNOCKOUT_FAR = 12;
/** The most a reserve's core may differ from bare paper on average, levels; and the least the sky must, so the check bites. */
export const STAMP_GATE_KNOCKOUT_PAPER = 2;
export const STAMP_GATE_SKY_LEAST = 10;
/** The most of the ultramarine a lift may leave, and the least more of the phthalo it must: the stain it can't take. */
export const STAMP_GATE_LIFT_LEAVES = 0.35;
export const STAMP_GATE_STAIN_MORE = 0.1;

/**
 * A sky of ultramarine then phthalo blue glazed over the paper's photograph, under a group drifting
 * STAMP_GATE_DRIFT_STEP pixels a frame that knocks out a reserve and a lift. Without the `sky`, bare paper; without the
 * `knockout`, the sky alone; `painted`, the group lays a dab over its reserve after.
 */
export function stampGateKnockoutPainting({ sky = true, knockout = true, painted = false } = {}): StampGatePainting {
  return gatePainting(compileStampPaintRecipe(stampPaintRecipe((p) => {
    if (sky) {
      p.group('sky', { composite: 'glaze', opacity: 1 }, (g) => g.pass('wash', {}, (pass) => {
        pass.fill('ultramarine', { ...flood(disc({ x: 0, y: 0 }, 1)), diameter: 40, material: mixture({ pigment: W.ultramarine, amount: 1 }), region: stampGatePolygon(0, 0, KNOCKOUT_SKY_SPLIT, 0, KNOCKOUT_SKY_SPLIT, 160, 0, 160) });
        pass.fill('phthalo', { ...flood(disc({ x: 0, y: 0 }, 1)), diameter: 40, material: mixture({ pigment: W.phthaloBlue, amount: 1 }), region: stampGatePolygon(KNOCKOUT_SKY_SPLIT, 0, 240, 0, 240, 160, KNOCKOUT_SKY_SPLIT, 160) });
      }));
    }
    if (!knockout) return;
    p.group('cloud', { composite: 'glaze', opacity: 1, motion: drifting }, (g) => {
      g.knockout('lights', { preparation: { region: disc(KNOCKOUT.lift, 22) } }, (k) => {
        k.lift('blot', flood(disc(KNOCKOUT.lift, 18)));
        k.mask('fluid', { region: disc(KNOCKOUT.reserve, 14) });
        k.water('wash', flood(disc(KNOCKOUT.reserve, 24)));
      });
      if (painted) g.pass('dab', {}, (pass) => pass.fill('dab', { ...flood(disc(KNOCKOUT.reserve, 12)), material: mixture({ pigment: W.burntSienna, amount: 1 }) }));
    });
  })));
}

export const STAMP_GATE_ANIMATION_IDS = [
  'animation/drift', 'animation/boil', 'animation/boil-wash', 'animation/bloom-boil', 'animation/sunset', 'animation/effects-sunset', 'animation/recolour', 'animation/cut-out', 'animation/repaint', 'animation/lent', 'animation/knockout',
];

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

/** The most any colour channel of two frames differs. */
function mostApart(a: Rgba, b: Rgba) {
  let max = 0;
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) max = Math.max(max, Math.abs(a[i] - b[i]));
  return max;
}

/**
 * Whether the keyed sunset halfway matches the still one in the halfway paint within the dither (its palette sums in
 * another order); and whether its end after halfway, halfway after its end, and past its last key (held) are each
 * the same time drawn first.
 */
export function checkStampGateRecolour(frames: Record<'still' | 'halfway' | 'freshEnd' | 'end' | 'halfwayAgain' | 'past', Rgba>): StampGateWashCheck {
  const { still, halfway, freshEnd, end, halfwayAgain, past } = frames;
  const painted = mostApart(still, halfway), orders = [mostApart(freshEnd, end), mostApart(halfway, halfwayAgain), mostApart(freshEnd, past)];
  return {
    id: 'animation/recolour: keyed paint is the eased paint, in any frame order', passed: painted <= STAMP_GATE_DRIFT_TOLERANCE && orders.every((max) => max === 0),
    detail: `halfway against painted still in the halfway paint: max ${painted} (past ${STAMP_GATE_DRIFT_TOLERANCE} fails); against drawn first, its end after halfway, halfway after its end and past its last key: max ${orders.join(', ')} (past 0 fails)`,
  };
}

/**
 * Whether a painting loaded onto a surface another painting has drawn on (its targets holding that one's last frame)
 * draws a frame just as it does on a fresh surface.
 */
export function checkStampGateRepaint(fresh: Rgba, after: Rgba): StampGateWashCheck {
  const max = mostApart(fresh, after);
  return {
    id: 'animation/repaint: a painting drawn on a surface after another is drawn as on a fresh one', passed: max === 0,
    detail: `the drift at frame 2 after the bloom-boil at frame 1, against drawn fresh: max ${max} (past 0 fails)`,
  };
}

/**
 * A painting on a lent device, drawn into a texture it's handed, against the same frame on a canvas: the same bytes;
 * an -srgb texture refused; and once its surface is disposed, no error scope of its left open on the device.
 */
export function checkStampGateLent({ onCanvas, lent, refusesSrgb, scopesBalanced }: { onCanvas: Rgba; lent: Rgba; refusesSrgb: boolean; scopesBalanced: boolean }): StampGateWashCheck {
  const max = mostApart(onCanvas, lent);
  return {
    id: 'animation/lent: a painting on a lent device draws into its texture as on a canvas, and leaves the device as it found it',
    passed: max === 0 && refusesSrgb && scopesBalanced,
    detail: `the drift at frame 2: max ${max} from the canvas's (past 0 fails); an -srgb texture ${refusesSrgb ? 'refused' : 'accepted'}; error scopes ${scopesBalanced ? 'balanced' : 'left open'}`,
  };
}

/** The mean of `measure` over a disc's pixels, a pixel at `dx` on for each. */
function overCore({ x: cx, y: cy, r }: { x: number; y: number; r: number }, dx: number, measure: (i: number) => number) {
  let sum = 0, n = 0;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (Math.hypot(x - cx, y - cy) > r) continue;
    sum += measure((y * SIZE.width + x + dx) * 4);
    n++;
  }
  return sum / n;
}
/** The mean difference over a core between two frames, in levels. */
const coreApart = (a: Rgba, b: Rgba, core: { x: number; y: number; r: number }, dx = 0) =>
  overCore(core, dx, (i) => (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3);
/** How much of the sky's darkening a core keeps, against bare paper, over the red channel (where blue darkens most). */
const skyLeft = (lifted: Rgba, sky: Rgba, bare: Rgba, dx: number) =>
  overCore(KNOCKOUT.lift, dx, (i) => bare[i] - lifted[i]) / overCore(KNOCKOUT.lift, dx, (i) => bare[i] - sky[i]);

/**
 * Whether a knockout's reserve is bare paper where it lies and the sky again where it left, as it drifts; whether its
 * lift leaves little of the ultramarine and more of the phthalo, the stain it can't take; whether the group's paint
 * lands over its reserve; and whether frame 0 drawn again after the far frame is the same.
 */
export function checkStampGateKnockout({ first, far, again, sky, bare, painted }: Record<'first' | 'far' | 'again' | 'sky' | 'bare' | 'painted', Rgba>): StampGateWashCheck {
  const moved = STAMP_GATE_KNOCKOUT_FAR * STAMP_GATE_DRIFT_STEP;
  const reserve = { here: coreApart(first, bare, KNOCKOUT.reserve), moved: coreApart(far, bare, KNOCKOUT.reserve, moved), left: coreApart(far, bare, KNOCKOUT.reserve) };
  const ultramarine = skyLeft(first, sky, bare, 0), phthalo = skyLeft(far, sky, bare, moved);
  const dab = coreApart(painted, bare, KNOCKOUT.reserve), repeat = mostApart(again, first);
  const problems = [
    ...(Math.max(reserve.here, reserve.moved) > STAMP_GATE_KNOCKOUT_PAPER ? [`its reserve differs from bare paper by ${reserve.here.toFixed(2)}, and moved by ${reserve.moved.toFixed(2)} (past ${STAMP_GATE_KNOCKOUT_PAPER} fails)`] : []),
    ...(reserve.left < STAMP_GATE_SKY_LEAST ? [`where its reserve was, the sky is within ${reserve.left.toFixed(2)} of bare paper: it didn't move off`] : []),
    ...(ultramarine > STAMP_GATE_LIFT_LEAVES ? [`its lift leaves ${ultramarine.toFixed(2)} of the ultramarine (past ${STAMP_GATE_LIFT_LEAVES} fails)`] : []),
    ...(phthalo < ultramarine + STAMP_GATE_STAIN_MORE ? [`its lift leaves ${phthalo.toFixed(2)} of the phthalo, under ${STAMP_GATE_STAIN_MORE} more than of the ultramarine`] : []),
    ...(dab < STAMP_GATE_SKY_LEAST ? [`its paint over its reserve is within ${dab.toFixed(2)} of bare paper: the knockout's fluid held it off`] : []),
    ...(repeat > 0 ? [`frame 0 drawn again after frame ${STAMP_GATE_KNOCKOUT_FAR} differs by ${repeat}`] : []),
  ];
  return {
    id: 'animation/knockout: its reserve and lift move with it, the lift leaving its stain', passed: !problems.length,
    detail: `reserve against bare paper ${reserve.here.toFixed(2)}, moved ${reserve.moved.toFixed(2)}, where it left ${reserve.left.toFixed(2)}; the lift leaves ${ultramarine.toFixed(2)} of the ultramarine, ${phthalo.toFixed(2)} of the phthalo; paint over the reserve ${dab.toFixed(2)} from paper`
      + (problems.length ? `; ${problems.join('; ')}` : '; frame 0 again identical'),
  };
}
