// stamp-gate-washes.ts: the GPU gate's washes, held to what paint must do, not a baseline:
//
// - any frame order: fresh or after another, a frame matches;
// - conserved: wet effects only move pigment;
// - lifted: a lift is bounded and spares a stain;
// - spread: flow leaves overlaps no less even;
// - set: rewetted dry paint lifts only by its rewetting;
// - fenced: nothing crosses masking fluid or a `within`;
// - rimmed: a puddle's edge gathers pigment, a seam doesn't;
// - bloomed: paint elsewhere first doesn't stop a bloom;
// - unlined: a backrun leaves its wash's edge unlined;
// - unrimmed: a feathered edge dries with no line;
// - lipped, unlipped: damp paint lips a bloom all round, wet doesn't;
// - frame: read whole (stamp-gate-lift-colour.ts, stamp-gate-dry-brush.ts).
//
// Each case's last group is read back.

import { PAINT_BANDS } from '#lib/paint/materials/models/paint-spectrum.ts';
import { PAINT_MEDIA, paintMediumCan } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPaintPaper, StampPassageScope } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { compileStampPigmentPaint } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import type { StampRegion } from '#lib/paint/painting/models/stamp-region.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import { stampGateDryBrushCase } from './stamp-gate-dry-brush.ts';
import { stampGateLiftColourCase } from './stamp-gate-lift-colour.ts';
import { checkStampGateConserved, STAMP_GATE_CONSERVED_TOLERANCE, stampGateSlotAmounts, stampGateTotal, type StampGateLayer, type StampGateWashCheck } from './stamp-gate-layer.ts';
import { stampBloom, stampSoften } from '#lib/paint/painting/models/stamp-wet-techniques.ts';

export type StampGateWashMedium = 'watercolour' | 'gouache' | 'crayon';

/**
 * A wash case: its painting `subject`, drawn twice the same; and what it's held to against
 * `without`, the same painting less the ops under test. `pigments` are the lifted case's, least staining first.
 */
export type StampGateWashCase = {
  id: string;
  subject: StampGatePainting;
} & (
  | { property: 'drawn' }
  | { property: 'conserved'; without: StampGatePainting }
  | { property: 'lifted'; without: StampGatePainting; pigments: readonly [string, string] }
  | { property: 'spread'; without: StampGatePainting }
  | { property: 'set'; without: StampGatePainting; fresh: { subject: StampGatePainting; without: StampGatePainting }; rewetting: number }
  | { property: 'fenced'; fenced: (x: number, y: number) => boolean }
  | { property: 'rimmed'; without: StampGatePainting }
  | { property: 'bloomed'; without: StampGatePainting }
  | { property: 'unlined' }
  // Reads the frame, not its last group.
  | { property: 'frame'; read: (rgba: ArrayLike<number>) => StampGateWashCheck }
  | { property: 'unrimmed' }
  | { property: 'unlipped'; without: StampGatePainting }
  | { property: 'lipped'; without: StampGatePainting }
);

/** How far past a bound a pixel's amount may read: a half-float's step near the small amounts these bounds sit at. */
export const STAMP_GATE_LAYER_TOLERANCE = 2e-3;

const SIZE = { width: 160, height: 120 };
const END = Number.MAX_VALUE;
const PAPER: StampPaintPaper = { color: '#f6f1e6' };
const ROUND = stampGateBrush('Round', { flow: 0.5 });
const SOFT = stampGateBrush('Soft', { flow: 0.3 });
/** A tip fading from its middle to its edge, which on wet paper lays a feathered edge as wide as a rim's band. */
const FEATHER = stampGateBrush('Feather', { flow: 0.3, tip: { image: { style: 'gate', pack: 'gate', file: 'contact.png' }, roundness: 1, sampling: 'isotropic' } });

/** One pigment at full strength, so no white joins it in a medium that lightens with white. */
const pure = (pigment: PaintPigmentAppearance): PaintMaterial => ({ kind: 'mixture', parts: [{ pigment, amount: 1 }], strength: 1 });
const SKY = stampGatePolygon(10, 10, 150, 10, 150, 110, 10, 110);

/**
 * A painting in `medium`: an earlier dry group (so the subject's layer isn't the painting's only one), then the
 * subject's wash, prepared over the sky when `wetPaper`, and `within` a region if given. `still`: the medium's paint
 * doesn't flow.
 */
function washPainting(medium: StampGateWashMedium, wetPaper: boolean, body: (wash: StampPassageScope) => void, still = false, within?: StampRegion): StampGatePainting {
  const flowing = PAINT_MEDIA[medium];
  const paint = still ? { ...flowing, wetting: { ...flowing.wetting, spread: 0 } } : flowing;
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: PAPER, mixing: { kind: 'pigment', medium: paint, pigments: W } }, (p) => {
    p.group('under', { composite: 'glaze', opacity: 1 }, (g) => g.passage('dry', paintMediumCan(paint, 'wet-history') ? { wetHistory: false } : {}, (pass) => {
      pass.stroke('band', { brush: ROUND, size: 30, well: { paint: pure(W.yellowOchre) }, path: [{ x: 0, y: 100 }, { x: 160, y: 96 }] });
    }));
    p.group('subject', { composite: 'glaze', opacity: 1 }, (g) => g.passage('wash', { ...(wetPaper && { preparation: { region: SKY } }), ...(within && { within: { region: within } }) }, body));
  }));
  return { painting, ...SIZE, t: END, images: STAMP_GATE_IMAGES };
}

/** The fenced case's masking fluid and its `within`'s edge, and the pixels held clear of both, a couple of pixels in. */
const FLUID = { x: 60, y: 62, radius: 16 };
const WITHIN_TO = 110;
const fenced = (x: number, y: number) => Math.hypot(x + 0.5 - FLUID.x, y + 0.5 - FLUID.y) < FLUID.radius - 2 || x >= WITHIN_TO + 2;

const sky = (wash: StampPassageScope) => wash.fill('sky', { brush: ROUND, size: 40, application: { kind: 'flood' }, region: SKY, well: { paint: pure(W.ultramarine) } });
const stroke = (wash: StampPassageScope) => wash.stroke('stroke', { brush: ROUND, size: 36, well: { paint: pure(W.ultramarine) }, path: [{ x: 20, y: 40 }, { x: 140, y: 50 }] });

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

/** The unlined case's wash's right edge, by column, and its rows. */
const BACKRUN_EDGE = { x: 100, rows: [20, 100] as const };
/**
 * How much darker than without blooms the unlined case's wash's edge may get: each row's most pigment near it, as a
 * share of without's, on average. A backrun pushes a little paint toward the edge; a lip there would be a dark line.
 */
export const STAMP_GATE_UNLINED_MOST = 0.15;

/** The unrimmed case's wash's left edge, feathered on wet paper, by column; the columns of its interior; its rows. */
const SOFT_EDGE = { from: 2, to: 30, interior: [60, 100] as const, rows: [20, 100] as const };
/**
 * The most the drying rim may darken the unrimmed case's feathered edge, at its darkest row by row, on average, as a
 * share of the wash's interior: a puddle's edge gains about 0.7.
 */
export const STAMP_GATE_UNRIMMED_MOST = 0.03;

/**
 * The unlipped and lipped cases' drop, and the seconds the unlipped case's sky waits for it: about halfway from its
 * shine to damp (a bloom op would wait for damp). A lip is read against the bloom within LIP_REACH px round it.
 */
const WET_DROP = { x: 80, y: 60, radius: 34, seconds: 50 };
const LIP_REACH = 4;
/**
 * How far the unlipped case's lip may stand above the bloom round it: its 2% most-raised pixels, on average, as a
 * share of the paint round the drop. The same drop at damp stands about 0.48 above.
 */
export const STAMP_GATE_UNLIPPED_MOST = 0.15;
/**
 * The lipped case's sectors round its drop, and how high its weakest's lip must stand, as a share of its strongest's
 * (each its most-raised pixel above the bloom round it): a front left open over a third of it reads about 0.32.
 */
const LIP_SECTORS = 12;
export const STAMP_GATE_LIPPED_LEAST = 0.42;

/** Every wash case, by ID. */
function washCases(): StampGateWashCase[] {
  const media: readonly StampGateWashMedium[] = ['watercolour', 'gouache', 'crayon'];
  // Clean water needs a wet history, which crayon hasn't.
  const water = media.filter((medium) => paintMediumCan(PAINT_MEDIA[medium], 'wet-history')).map((medium): StampGateWashCase => ({
    id: `wash/water-${medium}`, property: 'conserved',
    subject: washPainting(medium, false, (wash) => {
      stroke(wash);
      wash.water('water', { kind: 'stroke', brush: SOFT, size: 30, path: [{ x: 80, y: 10 }, { x: 70, y: 110 }] });
    }),
    without: washPainting(medium, false, stroke),
  }));
  const lifted = media.map((medium): StampGateWashCase => {
    const patches = (wash: StampPassageScope) => {
      wash.fill('left', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, 78, 10, 78, 110, 10, 110), well: { paint: pure(W.ultramarine) } });
      wash.fill('right', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(82, 10, 150, 10, 150, 110, 82, 110), well: { paint: pure(W.phthaloBlue) } });
    };
    return {
      id: `wash/lift-${medium}`, property: 'lifted', pigments: [W.ultramarine.id, W.phthaloBlue.id],
      subject: washPainting(medium, false, (wash) => {
        patches(wash);
        wash.lift('lift', { kind: 'stroke', brush: SOFT, size: 34, path: [{ x: 15, y: 60 }, { x: 145, y: 55 }] });
      }),
      without: washPainting(medium, false, patches),
    };
  });
  // Two wet patches meeting, and a lift that takes nothing drawn across them: whatever works over a lift's
  // neighbourhood (the lift's run-back) only moves the paint about.
  const meeting = (wash: StampPassageScope) => {
    wash.fill('left', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, 84, 10, 84, 110, 10, 110), well: { paint: pure(W.ultramarine) } });
    wash.fill('right', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(76, 10, 150, 10, 150, 110, 76, 110), well: { paint: pure(W.burntSienna) } });
  };
  const dropped = (wash: StampPassageScope) => {
    sky(wash);
    wash.stroke('drop', { brush: SOFT, size: 30, well: { paint: pure(W.quinacridoneRose) }, path: [{ x: 20, y: 70 }, { x: 140, y: 64 }] });
  };
  // Dried paint wetted again by a water stroke and lifted, against the same lift while the paint is still wet.
  const rewetted = (dried: boolean, withLift: boolean) => washPainting('watercolour', false, (wash) => {
    wash.fill('sky', { brush: ROUND, size: 40, application: { kind: 'flood' }, region: SKY, well: { paint: pure(W.ultramarine) } });
    if (dried) wash.wait('set');
    wash.water('rewet', { kind: 'stroke', brush: ROUND, size: 40, path: [{ x: 15, y: 60 }, { x: 145, y: 58 }] });
    if (withLift) wash.lift('lift', { kind: 'stroke', brush: SOFT, size: 30, path: [{ x: 20, y: 60 }, { x: 140, y: 58 }] });
  });
  // A puddle, and two patches meeting at RIM.seam, all wetted together and left to dry.
  const puddles = (wash: StampPassageScope) => {
    const patch = (id: string, x0: number, x1: number) => wash.fill(id, {
      brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(x0, 10, x1, 10, x1, 110, x0, 110), well: { paint: pure(W.ultramarine), water: 1 },
    });
    patch('puddle', 10, RIM.puddleTo);
    patch('seam-left', 80, RIM.seam);
    patch('seam-right', RIM.seam, 150);
  };
  // A sky, then fresh paint far from where the bloom drops, laid as the sky nears damp: the drop waits for the sky
  // under it, not for this, which would hold it back until that sky had all but set.
  const paintedElsewhere = (wash: StampPassageScope) => {
    sky(wash);
    wash.wait({ seconds: 80 });
    wash.stroke('elsewhere', { brush: ROUND, size: 24, well: { paint: pure(W.quinacridoneRose) }, path: [{ x: 132, y: 15 }, { x: 136, y: 105 }] });
  };
  const overlapping = (wash: StampPassageScope) => [30, 52, 74, 96].forEach((x, k) => wash.stroke(`stroke-${k}`, {
    brush: ROUND, size: 36, well: { paint: pure(W.ultramarine) }, path: [{ x, y: 10 }, { x: x + 4, y: 110 }],
  }));
  return [
    ...water,
    ...lifted,
    { id: 'wash/merge', property: 'spread', subject: washPainting('watercolour', false, overlapping), without: washPainting('watercolour', false, overlapping, true) },
    {
      id: 'wash/lift-neighbourhood', property: 'conserved', without: washPainting('watercolour', true, meeting),
      subject: washPainting('watercolour', true, (wash) => {
        meeting(wash);
        wash.lift('nothing', { kind: 'stroke', brush: SOFT, size: 34, path: [{ x: 20, y: 60 }, { x: 140, y: 55 }], strength: 0 });
      }),
    },
    {
      id: 'wash/lift-set', property: 'set', subject: rewetted(true, true), without: rewetted(true, false),
      fresh: { subject: rewetted(false, true), without: rewetted(false, false) }, rewetting: PAINT_MEDIA.watercolour.wetting.rewetting,
    },
    {
      id: 'wash/fenced', property: 'fenced', fenced,
      subject: washPainting('watercolour', true, (wash) => {
        wash.mask('fluid', { region: { kind: 'ellipse', x: FLUID.x, y: FLUID.y, radiusX: FLUID.radius, radiusY: FLUID.radius } });
        sky(wash);
        wash.stroke('feather', { brush: SOFT, size: 30, well: { paint: pure(W.quinacridoneRose) }, path: [{ x: 40, y: 30 }, { x: 150, y: 34 }] });
        wash.lift('lift', { kind: 'stroke', brush: SOFT, size: 30, path: [{ x: 20, y: 64 }, { x: 140, y: 60 }] });
      }, false, stampGatePolygon(0, 0, WITHIN_TO, 0, WITHIN_TO, SIZE.height, 0, SIZE.height)),
    },
    // Against the same wet paper with paint that doesn't flow: on dry paper the brush's water would harden its edge.
    { id: 'wash/wet-in-wet', property: 'conserved', subject: washPainting('watercolour', true, dropped), without: washPainting('watercolour', true, dropped, true) },
    {
      id: 'wash/soften', property: 'conserved', without: washPainting('watercolour', false, stroke),
      subject: washPainting('watercolour', false, (wash) => {
        stroke(wash);
        stampSoften(wash, 'edge', { brush: SOFT, size: 16, along: [{ x: 20, y: 58 }, { x: 140, y: 68 }] });
      }),
    },
    {
      id: 'wash/bloom', property: 'conserved', without: washPainting('watercolour', true, sky),
      subject: washPainting('watercolour', true, (wash) => {
        sky(wash);
        stampBloom(wash, 'bloom', { brush: SOFT, size: 24, at: [{ x: 50, y: 50 }, { x: 110, y: 70 }] });
      }),
    },
    {
      id: 'wash/bloom-after-paint', property: 'bloomed', without: washPainting('watercolour', false, paintedElsewhere),
      subject: washPainting('watercolour', false, (wash) => {
        paintedElsewhere(wash);
        stampBloom(wash, 'bloom', { brush: SOFT, size: 24, at: [{ x: BLOOM_DROP.x, y: BLOOM_DROP.y }] });
      }),
    },
    // A wash left until damp, a wetter stroke laid inside its right edge: its backrun runs left into the damp paint
    // and reaches the edge on its right. Against the same painting without the bloom stage.
    {
      id: 'wash/backrun-edge', property: 'unlined',
      subject: washPainting('watercolour', false, (wash) => {
        wash.fill('wash', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, BACKRUN_EDGE.x, 10, BACKRUN_EDGE.x, 110, 10, 110), well: { paint: pure(W.cerulean) } });
        wash.wait('damp');
        wash.stroke('side', { brush: ROUND, size: 22, well: { paint: pure(W.cerulean), water: 1 }, path: [{ x: BACKRUN_EDGE.x - 10, y: 14 }, { x: BACKRUN_EDGE.x - 12, y: 106 }] });
      }),
    },
    // A wash flooded to the edge of the paper wetted for it: on wet paper its edge feathers out, and dries with no line.
    // Against the same painting without the drying rim.
    {
      id: 'wash/soft-edge', property: 'unrimmed',
      subject: washPainting('watercolour', true, (wash) => wash.fill('sky', { brush: FEATHER, size: 80, application: { kind: 'flood' }, region: SKY, well: { paint: pure(W.ultramarine) } })),
    },
    // A sky not yet damp, water dropped in it: on paper this wet the water runs on, its edge soft and open. Against
    // the same sky without it.
    {
      id: 'wash/bloom-wet', property: 'unlipped', without: washPainting('watercolour', false, sky),
      subject: washPainting('watercolour', false, (wash) => {
        sky(wash);
        wash.wait({ seconds: WET_DROP.seconds });
        wash.water('drop', { kind: 'stamps', brush: SOFT, size: 30, at: [{ x: WET_DROP.x, y: WET_DROP.y }] });
      }),
    },
    // The same drop into the sky at damp, all the sky's paper as wet: it stalls all round, and lips all round.
    {
      id: 'wash/bloom-damp', property: 'lipped', without: washPainting('watercolour', false, sky),
      subject: washPainting('watercolour', false, (wash) => {
        sky(wash);
        stampBloom(wash, 'drop', { brush: SOFT, size: 30, at: [{ x: WET_DROP.x, y: WET_DROP.y }] });
      }),
    },
    // Against the same paint that doesn't flow, so neither moves nor rims.
    { id: 'wash/rim', property: 'rimmed', subject: washPainting('watercolour', false, puddles), without: washPainting('watercolour', false, puddles, true) },
    // Crayon sets as it lands, so its lifts are only ever of set wax.
    stampGateLiftColourCase('wash/lift-paler-gouache-wet', 'gouache', false),
    stampGateLiftColourCase('wash/lift-paler-gouache-dry', 'gouache', true),
    stampGateLiftColourCase('wash/lift-paler-crayon', 'crayon', false),
    // A dry brush and a wet one in watercolour, read against the paper's grain.
    stampGateDryBrushCase('wash/dry-brush'),
    {
      id: 'wash/wait', property: 'drawn',
      subject: washPainting('watercolour', false, (wash) => {
        wash.fill('first', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, 100, 10, 100, 110, 10, 110), well: { paint: pure(W.cerulean) } });
        wash.wait('set');
        wash.fill('second', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(60, 10, 150, 10, 150, 110, 60, 110), well: { paint: pure(W.burntSienna) } });
      }),
    },
    {
      id: 'wash/graded', property: 'drawn',
      subject: washPainting('watercolour', true, (wash) => wash.fill('graded', {
        brush: ROUND, size: 40, application: { kind: 'flood' }, region: SKY, well: { paint: pure(W.ultramarine) },
        load: { kind: 'linear', from: { x: 0, y: 10, value: 1 }, to: { x: 0, y: 110, value: 0.2 } },
      })),
    },
    // Noise on the GPU's field readers: a flood's load, and a material two deposits share as one passage.
    {
      id: 'wash/mottled', property: 'drawn',
      subject: washPainting('watercolour', false, (wash) => {
        const mottled = { kind: 'noise' as const, scale: 18, seed: 'passage', a: pure(W.ultramarine), b: pure(W.burntSienna) };
        wash.fill('left', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, 80, 10, 80, 110, 10, 110), well: { paint: mottled }, load: { kind: 'noise', scale: 30, a: 1, b: 0.3 } });
        wash.fill('right', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(80, 10, 150, 10, 150, 110, 80, 110), well: { paint: mottled } });
      }),
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
export function stampGateLastGroupPigments({ painting }: StampGatePainting): string[] {
  const { mixing } = painting;
  if (mixing.kind !== 'pigment') throw new Error('stamp gate: a wash case paints in pigment');
  return compileStampPigmentPaint(painting, mixing, PAINT_BANDS).groups.at(-1)!.palette.map(({ id }) => id);
}

/**
 * Whether a lift, `subject` against `without`, took from no pigment's total more than it had and left none below
 * nothing, took a smaller share of the more staining of `staining` (least staining first), and took some of the least
 * staining, so it can't pass by lifting nothing.
 */
export function checkStampGateLifted(id: string, pigments: readonly string[], staining: readonly [string, string], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  const problems: string[] = [];
  pigments.forEach((pigment, slot) => {
    const before = stampGateSlotAmounts(without, slot), after = stampGateSlotAmounts(subject, slot);
    if (stampGateTotal(after) > stampGateTotal(before) * (1 + STAMP_GATE_CONSERVED_TOLERANCE)) problems.push(`${pigment}'s total rose`);
    const below = after.filter((v) => v < -STAMP_GATE_LAYER_TOLERANCE).length;
    if (below) problems.push(`${pigment} went below none at ${below} pixels`);
  });
  const share = (pigment: string) => {
    const slot = pigments.indexOf(pigment);
    if (slot < 0) throw new Error(`stamp gate: ${id} lays no ${pigment}`);
    const had = stampGateTotal(stampGateSlotAmounts(without, slot));
    return had > 0 ? (had - stampGateTotal(stampGateSlotAmounts(subject, slot))) / had : 0;
  };
  const [loose, stained] = staining.map(share);
  if (stained > loose + STAMP_GATE_CONSERVED_TOLERANCE) problems.push(`${staining[1]}, staining more, lost more than ${staining[0]}`);
  if (!(loose > STAMP_GATE_CONSERVED_TOLERANCE)) problems.push(`it lifted none of ${staining[0]}`);
  return {
    id: `${id}: lifted`, passed: !problems.length,
    detail: `${staining[0]} lost ${(loose * 100).toFixed(2)}%, ${staining[1]} ${(stained * 100).toFixed(2)}%${problems.length ? `; ${problems.join('; ')}` : '; bounded'}`,
  };
}

/** The share of what `without` held of `slot` that `subject` lifted. */
function liftedShare({ subject, without }: { subject: StampGateLayer; without: StampGateLayer }, slot: number): number {
  const had = stampGateTotal(stampGateSlotAmounts(without, slot));
  return had > 0 ? (had - stampGateTotal(stampGateSlotAmounts(subject, slot))) / had : 0;
}

/**
 * Whether dried paint wetted again lifted, as a share of what it held, no more than the medium's `rewetting` of what
 * the same lift took while the paint was wet, and the wet lift took some.
 */
export function checkStampGateSet(id: string, pigments: readonly string[], rewetting: number, dried: { subject: StampGateLayer; without: StampGateLayer }, wet: { subject: StampGateLayer; without: StampGateLayer }): StampGateWashCheck {
  const shares = pigments.map((pigment, slot) => ({ pigment, dried: liftedShare(dried, slot), wet: liftedShare(wet, slot) }));
  const passed = shares.every((s) => s.wet > STAMP_GATE_CONSERVED_TOLERANCE && s.dried <= rewetting * s.wet + STAMP_GATE_CONSERVED_TOLERANCE);
  return {
    id: `${id}: set paint lifts by rewetting`, passed,
    detail: shares.map((s) => `${s.pigment} lost ${(s.dried * 100).toFixed(2)}% dried, ${(s.wet * 100).toFixed(2)}% wet (dried past ${(rewetting * 100).toFixed(0)}% of wet fails)`).join(', '),
  };
}

/** Whether `layer` holds no pigment, past a half-float's step, wherever `fenced` says paint may not go. */
export function checkStampGateFenced(id: string, pigments: readonly string[], layer: StampGateLayer, fencedAt: (x: number, y: number) => boolean): StampGateWashCheck {
  let most = 0, over = 0, inFence = 0;
  pigments.forEach((_, slot) => stampGateSlotAmounts(layer, slot).forEach((v, i) => {
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
  const slots = pigments.map((_, slot) => ({ subject: stampGateSlotAmounts(subject, slot), without: stampGateSlotAmounts(without, slot) }));
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
  const amounts = stampGateSlotAmounts(layer, slot), rows = Array.from({ length: 60 }, (_, k) => 30 + k);
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
    const after = stampGateSlotAmounts(subject, slot), before = stampGateSlotAmounts(without, slot);
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

/**
 * Whether the drying rim darkens `subject`'s feathered edge by at most STAMP_GATE_UNRIMMED_MOST of its interior, at
 * its darkest row by row, against `withoutRim`, and each pigment's total holds.
 */
export function checkStampGateUnrimmed(id: string, pigments: readonly string[], subject: StampGateLayer, withoutRim: StampGateLayer): StampGateWashCheck {
  const sum = (layer: StampGateLayer) => {
    const slots = Array.from({ length: pigments.length }, (_, slot) => stampGateSlotAmounts(layer, slot));
    return (i: number) => slots.reduce((t, amounts) => t + amounts[i], 0);
  };
  const rimmed = sum(subject), plain = sum(withoutRim);
  const [y0, y1] = SOFT_EDGE.rows, [x0, x1] = SOFT_EDGE.interior;
  let gained = 0;
  for (let y = y0; y < y1; y++) {
    let interior = 0, most = 0;
    for (let x = x0; x < x1; x++) interior += plain(y * subject.width + x) / (x1 - x0);
    for (let x = SOFT_EDGE.from; x < SOFT_EDGE.to; x++) most = Math.max(most, rimmed(y * subject.width + x) - plain(y * subject.width + x));
    gained += most / interior / (y1 - y0);
  }
  const conserved = checkStampGateConserved(id, pigments, subject, withoutRim);
  return {
    id: `${id}: unrimmed`, passed: gained <= STAMP_GATE_UNRIMMED_MOST && conserved.passed,
    detail: `its feathered edge's darkest gains ${(gained * 100).toFixed(1)}% of its interior from the rim (past ${STAMP_GATE_UNRIMMED_MOST * 100}% fails); ${conserved.detail}`,
  };
}

/**
 * Round the drop, each pixel's gain in pigment against `without` less the mean gain within LIP_REACH of it (how far
 * it stands above the bloom round it, as a lip does), with its angle about the drop; and how much moved and lay there.
 */
function dropRidges(pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer) {
  const sum = (layer: StampGateLayer) => {
    const slots = pigments.map((_, slot) => stampGateSlotAmounts(layer, slot));
    return (x: number, y: number) => slots.reduce((t, amounts) => t + amounts[y * layer.width + x], 0);
  };
  const after = sum(subject), before = sum(without), gain = (x: number, y: number) => after(x, y) - before(x, y);
  const ridges: { ridge: number; angle: number }[] = [];
  let moved = 0, there = 0;
  for (let y = 0; y < subject.height; y++) {
    for (let x = 0; x < subject.width; x++) {
      const dx0 = x + 0.5 - WET_DROP.x, dy0 = y + 0.5 - WET_DROP.y;
      if (Math.hypot(dx0, dy0) >= WET_DROP.radius) continue;
      moved += Math.abs(gain(x, y));
      there += before(x, y);
      let round = 0;
      for (let dy = -LIP_REACH; dy <= LIP_REACH; dy++) for (let dx = -LIP_REACH; dx <= LIP_REACH; dx++) round += gain(x + dx, y + dy);
      ridges.push({ ridge: gain(x, y) - round / (2 * LIP_REACH + 1) ** 2, angle: Math.atan2(dy0, dx0) });
    }
  }
  return { ridges, moved, there };
}

/**
 * Whether `subject`'s drop moved at least STAMP_GATE_BLOOMED_LEAST of the paint round it, raising none of it more
 * than STAMP_GATE_UNLIPPED_MOST above the bloom round it, against `without`, and each pigment's total holds.
 */
export function checkStampGateUnlipped(id: string, pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  const { ridges, moved, there } = dropRidges(pigments, subject, without);
  const darkest = ridges.map(({ ridge }) => ridge).toSorted((a, b) => b - a).slice(0, Math.ceil(ridges.length * 0.02));
  const lip = darkest.reduce((t, g) => t + g, 0) / darkest.length / (there / ridges.length), share = moved / there;
  const conserved = checkStampGateConserved(id, pigments, subject, without);
  return {
    id: `${id}: unlipped`, passed: share >= STAMP_GATE_BLOOMED_LEAST && lip <= STAMP_GATE_UNLIPPED_MOST && conserved.passed,
    detail: `${(share * 100).toFixed(2)}% of the paint round the drop moved (under ${STAMP_GATE_BLOOMED_LEAST * 100}% fails); its lip stands ${(lip * 100).toFixed(1)}% above the bloom round it (past ${STAMP_GATE_UNLIPPED_MOST * 100}% fails); ${conserved.detail}`,
  };
}

/**
 * Whether `subject`'s drop lips all round: in each of LIP_SECTORS sectors round it, its most-raised pixel stands at
 * least STAMP_GATE_LIPPED_LEAST as high as in the strongest; and each pigment's total holds.
 */
export function checkStampGateLipped(id: string, pigments: readonly string[], subject: StampGateLayer, without: StampGateLayer): StampGateWashCheck {
  const { ridges } = dropRidges(pigments, subject, without);
  const sectors = Array.from({ length: LIP_SECTORS }, () => 0);
  for (const { ridge, angle } of ridges) {
    const k = Math.min(LIP_SECTORS - 1, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * LIP_SECTORS));
    sectors[k] = Math.max(sectors[k], ridge);
  }
  const weakest = Math.min(...sectors) / Math.max(...sectors), conserved = checkStampGateConserved(id, pigments, subject, without);
  return {
    id: `${id}: lipped`, passed: weakest >= STAMP_GATE_LIPPED_LEAST && conserved.passed,
    detail: `its weakest sector's lip ${(weakest * 100).toFixed(1)}% of its strongest's (under ${STAMP_GATE_LIPPED_LEAST * 100}% fails); ${conserved.detail}`,
  };
}

/** Each of the unlined case's rows' most pigment, every pigment summed, within a few pixels of its wash's edge, on average. */
function edgeMost(layer: StampGateLayer, pigments: number): number {
  const slots = Array.from({ length: pigments }, (_, slot) => stampGateSlotAmounts(layer, slot));
  const [y0, y1] = BACKRUN_EDGE.rows;
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    let most = 0;
    for (let x = BACKRUN_EDGE.x - 6; x < BACKRUN_EDGE.x + 16; x++) most = Math.max(most, slots.reduce((t, amounts) => t + amounts[y * layer.width + x], 0));
    sum += most;
  }
  return sum / (y1 - y0);
}

/**
 * Whether `subject`'s wash's edge holds at most STAMP_GATE_UNLINED_MOST more pigment at its darkest, row by row, than
 * `withoutBlooms`'s, and each pigment's total holds.
 */
export function checkStampGateUnlined(id: string, pigments: readonly string[], subject: StampGateLayer, withoutBlooms: StampGateLayer): StampGateWashCheck {
  const share = edgeMost(subject, pigments.length) / edgeMost(withoutBlooms, pigments.length) - 1;
  const conserved = checkStampGateConserved(id, pigments, subject, withoutBlooms);
  return {
    id: `${id}: unlined`, passed: share <= STAMP_GATE_UNLINED_MOST && conserved.passed,
    detail: `its edge's darkest ${share >= 0 ? '+' : ''}${(share * 100).toFixed(1)}% on without blooms (past +${STAMP_GATE_UNLINED_MOST * 100}% fails); ${conserved.detail}`,
  };
}
