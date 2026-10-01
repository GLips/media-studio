// stamp-wet-techniques.ts: the wet techniques, each made by defineStampTechnique and called as an imported function
// on a passage's scope (`stampCharge(p, 'warm', { … })`): colour charged into a wet wash, a bloom's drop, a backrun
// along a junction, and a damp brush softening an edge. Each is one application of the score, however many marks it
// lays, and needs a passage with wet history.

import type { StampPlacement, StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import type { StampStrokeHand } from '#lib/paint/brush/models/stamp-stroke-hand.ts';
import { pickStampMaterial } from './stamp-material-set.ts';
import { stampScatteredStrokePath, stampScatterMarks, type StampMark, type StampMarkAnchor, type StampScatterAngle, type StampScatterPlacement } from './stamp-marks.ts';
import { defineStampTechnique } from './stamp-paint-passage.ts';
import type { StampToolOptions, StampWell } from './stamp-paint-recipe-types.ts';
import type { StampSizeRange } from './stamp-paint-sizes.ts';
import type { StampCondition } from './stamp-wash-effects.ts';

/** How much water a softening stroke carries unless it says: a damp brush, which moves an edge without flooding it. */
export const STAMP_SOFTEN_WATER = 0.3;

/**
 * Colour charged into a wet wash: `touches` short strokes scattered by `placement` (stampScatterMarks), each loaded
 * from `well`'s set by its own key, painted by `hand` (a swell unless it says) and placed by `anchor`. With `when`,
 * the passage first waits once, until the paper under all of them is that dry. Marks `${id}` keyed `0`, `1`…
 */
export type StampChargeOptions = Omit<StampToolOptions, 'size'> & {
  placement: StampScatterPlacement;
  touches: number;
  well?: StampWell;
  size?: StampSizeRange;
  length: readonly [number, number];
  angle?: StampScatterAngle;
  hand?: StampStrokeHand;
  anchor?: StampMarkAnchor;
  when?: StampCondition;
};
export const stampCharge = defineStampTechnique<StampChargeOptions, { marks: readonly StampMark[] }>({
  name: 'charge', requires: ['wet-history'], effect: 'charge',
  expand: ({ p, full, brush, well, sizeRange, conditioned }, options) => {
    const { placement, touches, length, angle, hand = { profile: 'swell' }, anchor, when } = options;
    if (!(Number.isInteger(touches) && touches >= 1)) throw new Error(`stamp paint: ${full} charges ${touches} touches, and a charge lays a whole number from 1`);
    const { paint, water } = well(options.well), laid = brush(options.brush);
    // Separate streams: a new mixture moves no touch, and a moved touch changes no colour.
    const marks = stampScatterMarks(placement, { count: touches, length, diameter: sizeRange(options.size), ...(angle !== undefined && { angle }), key: full }).map((scattered): StampMark => ({
      key: scattered.key, brush: laid, diameter: scattered.diameter, geometry: { kind: 'stroke', path: stampScatteredStrokePath(scattered, anchor), hand },
    }));
    conditioned(when, () => marks.forEach((mark, k) => p.mark(`${k}`, {
      mark, well: { paint: paint.kind === 'set' ? pickStampMaterial(paint, `${full}|${k}|material`) : paint, ...(water !== undefined && { water }) }, ...(options.opacity !== undefined && { opacity: options.opacity }),
    })));
    return { marks };
  },
});

/** Water dropped into a drying wash, a bloom: once the paper under the drops is `when` (damp, left out), they land, `amount` (1) each. */
export type StampBloomOptions = StampToolOptions & { at: readonly StampPlacement[]; amount?: number; when?: StampCondition };
export const stampBloom = defineStampTechnique<StampBloomOptions>({
  name: 'bloom', requires: ['wet-history'], effect: 'bloom',
  when: 'damp',
  expand: ({ p, id, conditioned }, { at, amount, brush, size, opacity, when }) => {
    conditioned(when, () => p.water(id, { kind: 'stamps', at, brush, size, opacity, amount }));
    return {};
  },
});

/**
 * A backrun on purpose: clean water (`amount`, 1 when left out) stroked `along` an authored junction once the paper
 * under it is `when` (damp, left out; shiny for softer scallops), pushing paint back into a lobed edge. Whether it
 * blooms is the bloom stage's call.
 */
export type StampBackrunOptions = StampToolOptions & { along: readonly StampStrokePoint[]; hand?: StampStrokeHand; amount?: number; when?: StampCondition };
export const stampBackrun = defineStampTechnique<StampBackrunOptions>({
  name: 'backrun', requires: ['wet-history', 'wet-conditions'], effect: 'backrun',
  when: 'damp',
  expand: ({ p, id, conditioned }, { along, hand, amount, brush, size, opacity, when }) => {
    conditioned(when, () => p.water(id, { kind: 'stroke', path: along, hand: hand ?? { profile: 'taper' }, brush, size, opacity, amount }));
    return {};
  },
});

/** A damp brush drawn `along` an edge to soften it: a water stroke carrying `amount` (STAMP_SOFTEN_WATER when left out). */
export type StampSoftenOptions = StampToolOptions & { along: readonly StampStrokePoint[]; hand?: StampStrokeHand; amount?: number; when?: StampCondition };
export const stampSoften = defineStampTechnique<StampSoftenOptions>({
  name: 'soften', requires: ['wet-history'],
  effect: 'soften',
  expand: ({ p, id, conditioned }, { along, hand, amount = STAMP_SOFTEN_WATER, brush, size, opacity, when }) => {
    conditioned(when, () => p.water(id, { kind: 'stroke', path: along, ...(hand && { hand }), brush, size, opacity, amount }));
    return {};
  },
});
