// stamp-gate-washes.ts: the washes the GPU gate paints, held to what paint must do, not a baseline:
//
// - any frame order: a frame drawn fresh or after another matches;
// - conserved: water, softening, a bloom or wet paper only moves pigment;
// - lifted: a lift never raises a total nor leaves less than none, and takes less of a stain;
// - spread: flow never leaves overlapping strokes less even;
// - set: dried paint wetted again lifts only by its rewetting;
// - fenced: no paint moves under masking fluid or out of a pass's `within`;
// - rimmed: a drying puddle's edge gathers pigment; a seam of patches wet together doesn't;
// - bloomed: a drop blooms though paint landed elsewhere first.
//
// Each case paints into its last group, which readLayer reads.

import { PAINT_BANDS } from '#lib/picture/paint/models/paint-spectrum.ts';
import { PAINT_MEDIA } from '#lib/picture/paint/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/picture/paint/models/paint-watercolour-pigments.ts';
import type { PaintPigmentAppearance } from '#lib/picture/paint/models/paint-pigment.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type PaintMaterial, type StampPaintPaper, type StampWashScope } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import { compileStampPigmentPaint } from '#lib/picture/stamp-paint/models/stamp-pigment-paint.ts';
import type { StampRegion } from '#lib/picture/stamp-paint/models/stamp-region.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';

/** A layer as the renderer reads one back (StampLayerReadback), restated so models needn't import the studio. */
export type StampGateLayer = { width: number; height: number; layers: number; values: Float32Array };

export type StampGateWashMedium = 'watercolour' | 'gouache' | 'crayon';

/**
 * A wash case: its painting `subject`, drawn at `mid` and at its end in both orders; and what it's held to against
 * `without`, the same painting less the ops under test. `pigments` are the lifted case's, least staining first.
 */
export type StampGateWashCase = {
  id: string;
  subject: StampGatePainting;
  mid: number;
} & (
  | { property: 'order' }
  | { property: 'conserved'; without: StampGatePainting }
  | { property: 'lifted'; without: StampGatePainting; pigments: readonly [string, string] }
  | { property: 'spread'; without: StampGatePainting }
  | { property: 'set'; without: StampGatePainting; fresh: { subject: StampGatePainting; without: StampGatePainting }; rewetting: number }
  | { property: 'fenced'; fenced: (x: number, y: number) => boolean }
  | { property: 'rimmed'; without: StampGatePainting }
  | { property: 'bloomed'; without: StampGatePainting }
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
 * subject's wash, prepared over the sky when `wetPaper`, and `within` a region if given. `still`: the medium's paint
 * doesn't flow.
 */
function washPainting(medium: StampGateWashMedium, wetPaper: boolean, body: (wash: StampWashScope) => void, still = false, within?: StampRegion): StampGatePainting {
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('under', { composite: 'glaze', opacity: 1 }, (g) => g.pass('dry', {}, (pass) => {
      pass.stroke('band', { brush: ROUND, diameter: 30, material: pure(W.yellowOchre), path: [{ x: 0, y: 100 }, { x: 160, y: 96 }] });
    }));
    p.group('subject', { composite: 'glaze', opacity: 1 }, (g) => g.wash('wash', { ...(wetPaper && { preparation: { region: SKY } }), ...(within && { within }) }, body));
  }));
  const flowing = PAINT_MEDIA[medium];
  const paint = still ? { ...flowing, wetting: { ...flowing.wetting, spread: 0 } } : flowing;
  return { painting, paper: PAPER, mixing: { kind: 'pigment', medium: paint, pigments: W }, ...SIZE, t: END, images: STAMP_GATE_IMAGES };
}

/** The fenced case's masking fluid and its `within`'s edge, and the pixels held clear of both, a couple of pixels in. */
const FLUID = { x: 60, y: 62, radius: 16 };
const WITHIN_TO = 110;
const fenced = (x: number, y: number) => Math.hypot(x + 0.5 - FLUID.x, y + 0.5 - FLUID.y) < FLUID.radius - 2 || x >= WITHIN_TO + 2;

const sky = (wash: StampWashScope) => wash.fill('sky', { brush: ROUND, diameter: 40, application: { kind: 'flood' }, region: SKY, material: pure(W.ultramarine), ...shown(0) });
const stroke = (wash: StampWashScope) => wash.stroke('stroke', { brush: ROUND, diameter: 36, material: pure(W.ultramarine), path: [{ x: 20, y: 40 }, { x: 140, y: 50 }], ...shown(0) });

/** The rim case's puddle's right edge and its patches' seam, by column. */
const RIM = { puddleTo: 60, seam: 115 };
/**
 * How much more its rim must gather at the puddle's edge than the paint left still has there, as a share of the
 * interior; and how much more than still paint a seam may hold, flow evening it.
 */
export const STAMP_GATE_RIM = { least: 0.1, seamMost: 0.02 };

/** The bloomed case's drop, and how much of the paint round it must move, as a share of what lies there without it. */
const BLOOM_DROP = { x: 45, y: 60, radius: 30 };
export const STAMP_GATE_BLOOMED_LEAST = 0.02;

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
      subject: washPainting(medium, false, (wash) => {
        patches(wash);
        wash.lift('lift', { kind: 'stroke', brush: SOFT, diameter: 34, path: [{ x: 15, y: 60 }, { x: 145, y: 55 }], ...shown(1) });
      }),
      without: washPainting(medium, false, patches),
    };
  });
  // Two wet patches meeting, and a lift that takes nothing drawn across them: whatever works over a lift's
  // neighbourhood (the lift's run-back) only moves the paint about.
  const meeting = (wash: StampWashScope) => {
    wash.fill('left', { brush: ROUND, diameter: 30, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, 84, 10, 84, 110, 10, 110), material: pure(W.ultramarine), ...shown(0) });
    wash.fill('right', { brush: ROUND, diameter: 30, application: { kind: 'flood' }, region: stampGatePolygon(76, 10, 150, 10, 150, 110, 76, 110), material: pure(W.burntSienna), ...shown(0) });
  };
  const dropped = (wash: StampWashScope) => {
    sky(wash);
    wash.stroke('drop', { brush: SOFT, diameter: 30, material: pure(W.quinacridoneRose), path: [{ x: 20, y: 70 }, { x: 140, y: 64 }], ...shown(1) });
  };
  // Dried paint wetted again by a water stroke and lifted, against the same lift while the paint is still wet.
  const rewetted = (dried: boolean, withLift: boolean) => washPainting('watercolour', false, (wash) => {
    wash.fill('sky', { brush: ROUND, diameter: 40, application: { kind: 'flood' }, region: SKY, material: pure(W.ultramarine), ...shown(0) });
    if (dried) wash.wait('dry');
    wash.water('rewet', { kind: 'stroke', brush: ROUND, diameter: 40, path: [{ x: 15, y: 60 }, { x: 145, y: 58 }], ...shown(1) });
    if (withLift) wash.lift('lift', { kind: 'stroke', brush: SOFT, diameter: 30, path: [{ x: 20, y: 60 }, { x: 140, y: 58 }], ...shown(1) });
  });
  // A puddle, and two patches meeting at RIM.seam, all wetted together and left to dry.
  const puddles = (wash: StampWashScope) => {
    const patch = (id: string, x0: number, x1: number) => wash.fill(id, {
      brush: ROUND, diameter: 30, application: { kind: 'flood' }, region: stampGatePolygon(x0, 10, x1, 10, x1, 110, x0, 110), material: pure(W.ultramarine), water: 1, ...shown(0),
    });
    patch('puddle', 10, RIM.puddleTo);
    patch('seam-left', 80, RIM.seam);
    patch('seam-right', RIM.seam, 150);
  };
  // A sky, then fresh paint far from where the bloom drops, laid as the sky nears damp: the drop waits for the sky
  // under it, not for this, which would hold it back until that sky had all but set.
  const paintedElsewhere = (wash: StampWashScope) => {
    sky(wash);
    wash.wait({ seconds: 80 });
    wash.stroke('elsewhere', { brush: ROUND, diameter: 24, material: pure(W.quinacridoneRose), path: [{ x: 132, y: 15 }, { x: 136, y: 105 }], ...shown(1) });
  };
  const overlapping = (wash: StampWashScope) => [30, 52, 74, 96].forEach((x, k) => wash.stroke(`stroke-${k}`, {
    brush: ROUND, diameter: 36, material: pure(W.ultramarine), path: [{ x, y: 10 }, { x: x + 4, y: 110 }], ...shown(k / 2),
  }));
  return [
    ...water,
    ...lifted,
    { id: 'wash/merge', mid: MID, property: 'spread', subject: washPainting('watercolour', false, overlapping), without: washPainting('watercolour', false, overlapping, true) },
    {
      id: 'wash/lift-neighbourhood', mid: MID, property: 'conserved', without: washPainting('watercolour', true, meeting),
      subject: washPainting('watercolour', true, (wash) => {
        meeting(wash);
        wash.lift('nothing', { kind: 'stroke', brush: SOFT, diameter: 34, path: [{ x: 20, y: 60 }, { x: 140, y: 55 }], strength: 0, ...shown(1) });
      }),
    },
    {
      id: 'wash/lift-set', mid: MID, property: 'set', subject: rewetted(true, true), without: rewetted(true, false),
      fresh: { subject: rewetted(false, true), without: rewetted(false, false) }, rewetting: PAINT_MEDIA.watercolour.wetting.rewetting,
    },
    {
      id: 'wash/fenced', mid: MID, property: 'fenced', fenced,
      subject: washPainting('watercolour', true, (wash) => {
        wash.mask('fluid', { region: { kind: 'ellipse', x: FLUID.x, y: FLUID.y, radiusX: FLUID.radius, radiusY: FLUID.radius } });
        sky(wash);
        wash.stroke('feather', { brush: SOFT, diameter: 30, material: pure(W.quinacridoneRose), path: [{ x: 40, y: 30 }, { x: 150, y: 34 }], ...shown(1) });
        wash.lift('lift', { kind: 'stroke', brush: SOFT, diameter: 30, path: [{ x: 20, y: 64 }, { x: 140, y: 60 }], ...shown(1) });
      }, false, stampGatePolygon(0, 0, WITHIN_TO, 0, WITHIN_TO, SIZE.height, 0, SIZE.height)),
    },
    // Against the same wet paper with paint that doesn't flow: on dry paper the brush's water would harden its edge.
    { id: 'wash/wet-in-wet', mid: MID, property: 'conserved', subject: washPainting('watercolour', true, dropped), without: washPainting('watercolour', true, dropped, true) },
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
      id: 'wash/bloom-after-paint', mid: MID, property: 'bloomed', without: washPainting('watercolour', false, paintedElsewhere),
      subject: washPainting('watercolour', false, (wash) => {
        paintedElsewhere(wash);
        wash.bloom('bloom', { brush: SOFT, diameter: 24, at: [{ x: BLOOM_DROP.x, y: BLOOM_DROP.y }], ...shown(1) });
      }),
    },
    // Against the same paint that doesn't flow, so neither moves nor rims.
    { id: 'wash/rim', mid: MID, property: 'rimmed', subject: washPainting('watercolour', false, puddles), without: washPainting('watercolour', false, puddles, true) },
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
 * Whether a lift, `subject` against `without`, took from no pigment's total more than it had and left none below
 * nothing, took a smaller share of the more staining of `staining` (least staining first), and took some of the least
 * staining, so it can't pass by lifting nothing.
 */
export function checkStampGateLifted(id: string, pigments: readonly string[], staining: readonly [string, string], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  const problems: string[] = [];
  pigments.forEach((pigment, slot) => {
    const before = slotAmounts(without, slot), after = slotAmounts(subject, slot);
    if (total(after) > total(before) * (1 + STAMP_GATE_CONSERVED_TOLERANCE)) problems.push(`${pigment}'s total rose`);
    const below = after.filter((v) => v < -STAMP_GATE_LAYER_TOLERANCE).length;
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
  if (!(loose > STAMP_GATE_CONSERVED_TOLERANCE)) problems.push(`it lifted none of ${staining[0]}`);
  return {
    id: `${id}: lifted`, passed: !problems.length,
    detail: `${staining[0]} lost ${(loose * 100).toFixed(2)}%, ${staining[1]} ${(stained * 100).toFixed(2)}%${problems.length ? `; ${problems.join('; ')}` : '; bounded'}`,
  };
}

/**
 * Whether dried paint wetted again lifted, as a share of what it held, no more than the medium's `rewetting` of what
 * the same lift took while the paint was wet, and the wet lift took some.
 */
export function checkStampGateSet(id: string, pigments: readonly string[], rewetting: number, dried: { subject: StampGateLayer; without: StampGateLayer }, wet: { subject: StampGateLayer; without: StampGateLayer }): StampGateWashCheck {
  const share = ({ subject, without }: typeof dried, slot: number) => {
    const had = total(slotAmounts(without, slot));
    return had > 0 ? (had - total(slotAmounts(subject, slot))) / had : 0;
  };
  const shares = pigments.map((pigment, slot) => ({ pigment, dried: share(dried, slot), wet: share(wet, slot) }));
  const passed = shares.every((s) => s.wet > STAMP_GATE_CONSERVED_TOLERANCE && s.dried <= rewetting * s.wet + STAMP_GATE_CONSERVED_TOLERANCE);
  return {
    id: `${id}: set paint lifts by rewetting`, passed,
    detail: shares.map((s) => `${s.pigment} lost ${(s.dried * 100).toFixed(2)}% dried, ${(s.wet * 100).toFixed(2)}% wet (dried past ${(rewetting * 100).toFixed(0)}% of wet fails)`).join(', '),
  };
}

/** Whether `layer` holds no pigment, past a half-float's step, wherever `fenced` says paint may not go. */
export function checkStampGateFenced(id: string, pigments: readonly string[], layer: StampGateLayer, fencedAt: (x: number, y: number) => boolean): StampGateWashCheck {
  let most = 0, over = 0, inFence = 0;
  pigments.forEach((_, slot) => slotAmounts(layer, slot).forEach((v, i) => {
    if (!fencedAt(i % layer.width, Math.floor(i / layer.width))) return;
    inFence++;
    most = Math.max(most, v);
    if (v > STAMP_GATE_LAYER_TOLERANCE) over++;
  }));
  return {
    id: `${id}: fenced`, passed: over === 0 && inFence > 0,
    detail: `${inFence} fenced pixel-pigments, ${over} holding paint, the most ${most.toFixed(4)} (past ${STAMP_GATE_LAYER_TOLERANCE} fails)`,
  };
}

/** A pigment's variance over the pixels either layer holds any paint at. */
function variance(amounts: Float32Array, union: readonly number[]): number {
  const mean = union.reduce((sum, i) => sum + amounts[i], 0) / union.length;
  return union.reduce((sum, i) => sum + (amounts[i] - mean) ** 2, 0) / union.length;
}

/** Whether, over the strokes' union, each pigment's amounts in `subject` vary no more than in `without`, its paint still. */
export function checkStampGateSpread(id: string, pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  const slots = pigments.map((_, slot) => ({ subject: slotAmounts(subject, slot), without: slotAmounts(without, slot) }));
  const union = Array.from({ length: subject.width * subject.height }, (_, i) => i)
    .filter((i) => slots.some((s) => s.subject[i] > STAMP_GATE_LAYER_TOLERANCE || s.without[i] > STAMP_GATE_LAYER_TOLERANCE));
  const spreads = pigments.map((pigment, slot) => ({ pigment, flowing: variance(slots[slot].subject, union), still: variance(slots[slot].without, union) }));
  return {
    id: `${id}: flow evens it`, passed: spreads.every(({ flowing, still }) => flowing <= still * (1 + STAMP_GATE_CONSERVED_TOLERANCE)),
    detail: `over ${union.length} pixels, ` + spreads.map(({ pigment, flowing, still }) => `${pigment}'s variance ${still.toFixed(5)} still, ${flowing.toFixed(5)} flowing`).join(', '),
  };
}

/**
 * Over the rim case's rows: the puddle's edge (the most within a few pixels of it) and the seam (the most across it),
 * each over its interior's mean amount of `slot`.
 */
function rimShares(layer: StampGateLayer, slot: number) {
  const amounts = slotAmounts(layer, slot), rows = Array.from({ length: 60 }, (_, k) => 30 + k);
  const at = (x: number, y: number) => amounts[y * layer.width + x];
  const most = (x0: number, x1: number) => rows.reduce((sum, y) => sum + Math.max(...Array.from({ length: x1 - x0 }, (_, k) => at(x0 + k, y))), 0) / rows.length;
  const mean = (...spans: [number, number][]) => {
    const xs = spans.flatMap(([x0, x1]) => Array.from({ length: x1 - x0 }, (_, k) => x0 + k));
    return rows.reduce((sum, y) => sum + xs.reduce((s, x) => s + at(x, y), 0), 0) / (rows.length * xs.length);
  };
  return {
    edge: most(RIM.puddleTo - 10, RIM.puddleTo + 6) / mean([25, 45]),
    seam: most(RIM.seam - 7, RIM.seam + 7) / mean([88, 102], [128, 142]),
  };
}

/**
 * Whether `subject`'s bloom moved at least STAMP_GATE_BLOOMED_LEAST of the paint within BLOOM_DROP's radius from where
 * `without` left it, every pigment summed, and each pigment's total held: a drop landing on paint already set moves none.
 */
export function checkStampGateBloomed(id: string, pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  let moved = 0, there = 0;
  pigments.forEach((_, slot) => {
    const after = slotAmounts(subject, slot), before = slotAmounts(without, slot);
    for (let i = 0; i < after.length; i++) {
      if (Math.hypot((i % subject.width) + 0.5 - BLOOM_DROP.x, Math.floor(i / subject.width) + 0.5 - BLOOM_DROP.y) >= BLOOM_DROP.radius) continue;
      moved += Math.abs(after[i] - before[i]);
      there += before[i];
    }
  });
  const share = there > 0 ? moved / there : 0, conserved = checkStampGateConserved(id, pigments, subject, without);
  return {
    id: `${id}: bloomed`, passed: share >= STAMP_GATE_BLOOMED_LEAST && conserved.passed,
    detail: `${(share * 100).toFixed(2)}% of the paint round the drop moved (under ${STAMP_GATE_BLOOMED_LEAST * 100}% fails); ${conserved.detail}`,
  };
}

/**
 * Whether `subject`'s puddle gathers at its edge STAMP_GATE_RIM.least more than `without`'s, its seam holds no more
 * than STAMP_GATE_RIM.seamMost more, no pixel holds less than none, and each pigment's total holds.
 */
export function checkStampGateRimmed(id: string, pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  const rimmed = rimShares(subject, 0), still = rimShares(without, 0);
  const least = subject.values.reduce((low, v) => Math.min(low, v), Infinity);
  const conserved = checkStampGateConserved(id, pigments, subject, without);
  const problems = [
    ...(rimmed.edge < still.edge + STAMP_GATE_RIM.least ? ['the puddle has no rim'] : []),
    ...(rimmed.seam > still.seam + STAMP_GATE_RIM.seamMost ? ['the seam rims'] : []),
    ...(least < -STAMP_GATE_LAYER_TOLERANCE ? [`a pixel holds ${least}`] : []),
    ...(conserved.passed ? [] : ['a pigment\'s total drifted']),
  ];
  return {
    id: `${id}: rimmed`, passed: !problems.length,
    detail: `${problems.length ? `${problems.join('; ')}. ` : ''}the puddle's edge ${rimmed.edge.toFixed(3)} of its interior, ${still.edge.toFixed(3)} still (under +${STAMP_GATE_RIM.least} fails); the seam ${rimmed.seam.toFixed(3)}, ${still.seam.toFixed(3)} still (past +${STAMP_GATE_RIM.seamMost} fails); least ${least}; ${conserved.detail}`,
  };
}
