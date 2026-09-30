// stamp-gate-washes.ts: the washes the GPU gate paints and the physical properties it holds them to. A wash's look
// is still being tuned, so none has a baseline; each is held to what paint must do whatever the tuning:
//
// - any frame order: a frame is the same drawn fresh or after another frame;
// - conserved: water, softening, a bloom or wet paper moves pigment and never makes or loses it, so a wash's pigment
//   totals match the same wash's without them;
// - lifted: a lift never adds pigment nor leaves less than none, and takes a smaller share of a staining pigment.
//
// Each case paints its subject into its painting's last group, whose layer the renderer reads back (readLayer).

import { PAINT_BANDS } from '#lib/picture/paint/models/paint-spectrum.ts';
import { PAINT_MEDIA } from '#lib/picture/paint/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/picture/paint/models/paint-watercolour-pigments.ts';
import type { PaintPigmentAppearance } from '#lib/picture/paint/models/paint-pigment.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type PaintMaterial, type StampPaintPaper, type StampWashScope } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { compileStampPigmentPaint } from '#lib/picture/stamp-paint/models/stamp-pigment-paint.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';

/** A layer as the renderer reads one back (StampLayerReadback), restated so models needn't import the studio. */
export type StampGateLayer = { width: number; height: number; layers: number; values: Float32Array };

export type StampGateWashMedium = 'watercolour' | 'gouache' | 'crayon';

/**
 * A wash case: its painting `subject`, drawn at `mid` and at its end in both orders; and what it's held to against
 * `without`, the same painting less the ops under test. `pigments` are the lifted case's, least staining first; a
 * lift that must take something (`mustLift`) fails a case where it takes nothing, so the check can't pass vacuously.
 */
export type StampGateWashCase = {
  id: string;
  subject: StampGatePainting;
  mid: number;
} & (
  | { property: 'order' }
  | { property: 'conserved'; without: StampGatePainting }
  | { property: 'lifted'; without: StampGatePainting; pigments: readonly [string, string]; mustLift: boolean }
);

/** How far a pigment's total may drift from the same wash's without the ops under test: its layer's half-float rounding summed over a few thousand pixels. */
export const STAMP_GATE_CONSERVED_TOLERANCE = 0.005;
/** How far past a bound a pixel's amount may read: a half-float's step at amounts up to 2. */
export const STAMP_GATE_LAYER_TOLERANCE = 2e-3;

const SIZE = { width: 160, height: 120 };
const END = Number.MAX_VALUE, MID = 1.5;
const PAPER: StampPaintPaper = { color: '#f6f1e6' };
const ROUND = stampGateBrush('Round', { flow: 0.5 });
const SOFT = stampGateBrush('Soft', { flow: 0.3 });

/** One pigment at full strength, so no white joins it in a medium that lightens with white. */
const pure = (pigment: PaintPigmentAppearance): PaintMaterial => ({ kind: 'mixture', parts: [{ pigment, amount: 1 }], strength: 1 });
const SKY = stampGatePolygon(10, 10, 150, 10, 150, 110, 10, 110);
/** Deposit `k` of a case shows over its second of scene time, so MID catches the second half drawn. */
const shown = (k: number) => ({ appliedAt: k, drawnOver: 1 });

/**
 * A painting in `medium`: an earlier dry group (so the subject's layer isn't the painting's only one), then the
 * subject's wash, prepared over the sky when `wetPaper`.
 */
function washPainting(medium: StampGateWashMedium, wetPaper: boolean, body: (wash: StampWashScope) => void): StampGatePainting {
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('under', { composite: 'glaze', opacity: 1 }, (g) => g.pass('dry', {}, (pass) => {
      pass.stroke('band', { brush: ROUND, diameter: 30, material: pure(W.yellowOchre), path: [{ x: 0, y: 100 }, { x: 160, y: 96 }] });
    }));
    p.group('subject', { composite: 'glaze', opacity: 1 }, (g) => g.wash('wash', wetPaper ? { preparation: { region: SKY } } : {}, body));
  }));
  return { painting, paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA[medium], pigments: W }, ...SIZE, t: END, images: STAMP_GATE_IMAGES };
}

const sky = (wash: StampWashScope) => wash.fill('sky', { brush: ROUND, diameter: 40, application: { kind: 'flood' }, region: SKY, material: pure(W.ultramarine), ...shown(0) });
const stroke = (wash: StampWashScope) => wash.stroke('stroke', { brush: ROUND, diameter: 36, material: pure(W.ultramarine), path: [{ x: 20, y: 40 }, { x: 140, y: 50 }], ...shown(0) });

/** Every wash case, by ID. */
function washCases(): StampGateWashCase[] {
  const media: readonly StampGateWashMedium[] = ['watercolour', 'gouache', 'crayon'];
  const water = media.map((medium): StampGateWashCase => ({
    id: `wash/water-${medium}`, mid: MID, property: 'conserved',
    subject: washPainting(medium, false, (wash) => {
      stroke(wash);
      wash.water('water', { kind: 'stroke', brush: SOFT, diameter: 30, path: [{ x: 80, y: 10 }, { x: 70, y: 110 }], ...shown(1) });
    }),
    without: washPainting(medium, false, stroke),
  }));
  const lifted = media.map((medium): StampGateWashCase => {
    const patches = (wash: StampWashScope) => {
      wash.fill('left', { brush: ROUND, diameter: 30, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, 78, 10, 78, 110, 10, 110), material: pure(W.ultramarine), ...shown(0) });
      wash.fill('right', { brush: ROUND, diameter: 30, application: { kind: 'flood' }, region: stampGatePolygon(82, 10, 150, 10, 150, 110, 82, 110), material: pure(W.phthaloBlue), ...shown(0) });
    };
    return {
      id: `wash/lift-${medium}`, mid: MID, property: 'lifted', pigments: [W.ultramarine.id, W.phthaloBlue.id],
      // Crayon is lifted as an eraser lifts, which the stub law can't yet: it lifts only where paint is workable.
      mustLift: medium !== 'crayon',
      subject: washPainting(medium, false, (wash) => {
        patches(wash);
        wash.lift('lift', { kind: 'stroke', brush: SOFT, diameter: 34, path: [{ x: 15, y: 60 }, { x: 145, y: 55 }], ...shown(1) });
      }),
      without: washPainting(medium, false, patches),
    };
  });
  const dropped = (wash: StampWashScope) => {
    sky(wash);
    wash.stroke('drop', { brush: SOFT, diameter: 30, material: pure(W.quinacridoneRose), path: [{ x: 20, y: 70 }, { x: 140, y: 64 }], ...shown(1) });
  };
  return [
    ...water,
    ...lifted,
    { id: 'wash/wet-in-wet', mid: MID, property: 'conserved', subject: washPainting('watercolour', true, dropped), without: washPainting('watercolour', false, dropped) },
    {
      id: 'wash/soften', mid: MID, property: 'conserved', without: washPainting('watercolour', false, stroke),
      subject: washPainting('watercolour', false, (wash) => {
        stroke(wash);
        wash.soften('edge', { brush: SOFT, diameter: 16, path: [{ x: 20, y: 58 }, { x: 140, y: 68 }], ...shown(1) });
      }),
    },
    {
      id: 'wash/bloom', mid: MID, property: 'conserved', without: washPainting('watercolour', true, sky),
      subject: washPainting('watercolour', true, (wash) => {
        sky(wash);
        wash.bloom('bloom', { brush: SOFT, diameter: 24, at: [{ x: 50, y: 50 }, { x: 110, y: 70 }], ...shown(1) });
      }),
    },
    {
      id: 'wash/wait', mid: MID, property: 'order',
      subject: washPainting('watercolour', false, (wash) => {
        wash.fill('first', { brush: ROUND, diameter: 30, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, 100, 10, 100, 110, 10, 110), material: pure(W.cerulean), ...shown(0) });
        wash.wait('dry');
        wash.fill('second', { brush: ROUND, diameter: 30, application: { kind: 'flood' }, region: stampGatePolygon(60, 10, 150, 10, 150, 110, 60, 110), material: pure(W.burntSienna), ...shown(1) });
      }),
    },
    {
      id: 'wash/graded', mid: MID, property: 'order',
      subject: washPainting('watercolour', true, (wash) => wash.fill('graded', {
        brush: ROUND, diameter: 40, application: { kind: 'flood' }, region: SKY, material: pure(W.ultramarine),
        load: { kind: 'linear', from: { x: 0, y: 10, value: 1 }, to: { x: 0, y: 110, value: 0.2 } }, appliedAt: 0, drawnOver: 3,
      })),
    },
  ];
}

export const STAMP_GATE_WASH_IDS = washCases().map((c) => c.id);

/** The gate's wash case `id`, built afresh; throws on an ID it doesn't hold. */
export function stampGateWashCase(id: string): StampGateWashCase {
  const found = washCases().find((c) => c.id === id);
  if (!found) throw new Error(`stamp gate: no wash case ${JSON.stringify(id)}; the gate paints ${STAMP_GATE_WASH_IDS.join(', ')}`);
  return found;
}

/** The pigment ids of a painting's last group, by slot: its layer holds slot `s` in channel `s + 1`, after coverage. */
export function stampGateLastGroupPigments({ painting, mixing }: StampGatePainting): string[] {
  if (mixing.kind !== 'pigment') throw new Error('stamp gate: a wash case paints in pigment');
  return compileStampPigmentPaint(painting, mixing, PAINT_BANDS).groups.at(-1)!.palette.map(({ id }) => id);
}

/** `slot`'s amount at each pixel of `layer`. */
function slotAmounts(layer: StampGateLayer, slot: number): Float32Array {
  const channel = slot + 1, l = channel >> 2, c = channel & 3, pixels = layer.width * layer.height;
  return Float32Array.from({ length: pixels }, (_, i) => layer.values[(l * pixels + i) * 4 + c]);
}

const total = (amounts: Float32Array) => amounts.reduce((sum, v) => sum + v, 0);

/** One of a case's checks as the gate reports it. */
export type StampGateWashCheck = { id: string; passed: boolean; detail: string };

/** Whether each pigment's total in `subject`'s layer is `without`'s, within STAMP_GATE_CONSERVED_TOLERANCE of it. */
export function checkStampGateConserved(id: string, pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  const drifts = pigments.map((pigment, slot) => {
    const had = total(slotAmounts(without, slot)), has = total(slotAmounts(subject, slot));
    return { pigment, had, has, drift: had > 0 ? Math.abs(has - had) / had : has };
  });
  const worst = drifts.reduce((a, b) => (b.drift > a.drift ? b : a));
  return {
    id: `${id}: conserved`, passed: drifts.every(({ drift }) => drift <= STAMP_GATE_CONSERVED_TOLERANCE),
    detail: drifts.map(({ pigment, had, has }) => `${pigment} ${had.toFixed(1)} → ${has.toFixed(1)}`).join(', ') + `; worst drift ${(worst.drift * 100).toFixed(3)}% (${worst.pigment}), past ${STAMP_GATE_CONSERVED_TOLERANCE * 100}% fails`,
  };
}

/**
 * Whether a lift, `subject` against `without`, is bounded pixel by pixel in every pigment and took a smaller share of
 * the more staining of `staining` (least staining first); with `mustLift`, whether it took any of the least staining.
 */
export function checkStampGateLifted(id: string, pigments: readonly string[], staining: readonly [string, string], mustLift: boolean, subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  const problems: string[] = [];
  pigments.forEach((pigment, slot) => {
    const before = slotAmounts(without, slot), after = slotAmounts(subject, slot);
    let rose = 0, below = 0;
    after.forEach((v, i) => {
      if (v > before[i] + STAMP_GATE_LAYER_TOLERANCE) rose++;
      if (v < -STAMP_GATE_LAYER_TOLERANCE) below++;
    });
    if (rose) problems.push(`${pigment} rose at ${rose} pixels`);
    if (below) problems.push(`${pigment} went below none at ${below} pixels`);
  });
  const share = (pigment: string) => {
    const slot = pigments.indexOf(pigment);
    if (slot < 0) throw new Error(`stamp gate: ${id} lays no ${pigment}`);
    const had = total(slotAmounts(without, slot));
    return had > 0 ? (had - total(slotAmounts(subject, slot))) / had : 0;
  };
  const [loose, stained] = staining.map(share);
  if (stained > loose + STAMP_GATE_CONSERVED_TOLERANCE) problems.push(`${staining[1]}, staining more, lost more than ${staining[0]}`);
  if (mustLift && !(loose > STAMP_GATE_CONSERVED_TOLERANCE)) problems.push(`it lifted none of ${staining[0]}`);
  return {
    id: `${id}: lifted`, passed: !problems.length,
    detail: `${staining[0]} lost ${(loose * 100).toFixed(2)}%, ${staining[1]} ${(stained * 100).toFixed(2)}%${problems.length ? `; ${problems.join('; ')}` : '; bounded at every pixel'}`,
  };
}
