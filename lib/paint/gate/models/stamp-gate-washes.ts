// stamp-gate-washes.ts: the GPU gate's washes, held to what paint must do, not a baseline:
//
// - any frame order: fresh or after another, a frame matches;
// - conserved: wet effects only move pigment;
// - lifted: a lift is bounded and spares a stain;
// - spread: flow leaves overlaps no less even;
// - set: rewetted dry paint lifts only by its rewetting;
// - fenced: nothing crosses masking fluid or a `within`;
// - rimmed, bloomed, unlined, unrimmed, lipped, unlipped: the marks water leaves (stamp-gate-water-marks.ts);
// - frame: read whole (stamp-gate-lift-colour.ts, stamp-gate-dry-brush.ts).
//
// Each case's last group is read back.

import { PAINT_BANDS } from '#lib/paint/materials/models/paint-spectrum.ts';
import { PAINT_MEDIA, paintMediumCan } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import { compileStampPaintRecipe, stampMixedPainting } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPaintPaper, StampPassageScope } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { compileStampPigmentPaint } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import type { StampRegion } from '#lib/paint/painting/models/stamp-region.ts';
import { STAMP_GATE_IMAGES, stampGateBox, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import { stampGateDryBrushCase } from './stamp-gate-dry-brush.ts';
import { stampGateLiftColourCase } from './stamp-gate-lift-colour.ts';
import { STAMP_GATE_BACKRUN_EDGE, STAMP_GATE_BLOOM_DROP, STAMP_GATE_RIM_PUDDLE, STAMP_GATE_WET_DROP } from './stamp-gate-water-marks.ts';
import { STAMP_GATE_CONSERVED_TOLERANCE, STAMP_GATE_LAYER_TOLERANCE, stampGateSlotAmounts, stampGateTotal, type StampGateLayer, type StampGateWashCheck } from './stamp-gate-layer.ts';
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

const SIZE = { width: 160, height: 120 };
const END = Number.MAX_VALUE;
const PAPER: StampPaintPaper = { color: '#f6f1e6' };
const ROUND = stampGateBrush('Round', { flow: 0.5 });
const SOFT = stampGateBrush('Soft', { flow: 0.3 });
/** A tip fading from its middle to its edge, which on wet paper lays a feathered edge as wide as a rim's band. */
const FEATHER = stampGateBrush('Feather', { flow: 0.3, tip: { image: { style: 'gate', pack: 'gate', file: 'contact.png' }, roundness: 1, sampling: 'isotropic' } });

/** One pigment at full strength, so no white joins it in a medium that lightens with white. */
const pure = (pigment: PaintPigmentAppearance): PaintMaterial => ({ kind: 'mixture', parts: [{ pigment, amount: 1 }], strength: 1 });
const SKY_BOX = [10, 10, 150, 110] as const, SKY = stampGateBox(...SKY_BOX);

/**
 * A painting in `medium`: an earlier dry group (so the subject's layer isn't the painting's only one), then the
 * subject's wash, its paper wetted first over `wetPaper` (none for dry), and `within` a region if given. `still`: the
 * medium's paint doesn't flow.
 */
function washPainting(medium: StampGateWashMedium, wetPaper: StampRegion | null, body: (wash: StampPassageScope) => void, still = false, within?: StampRegion): StampGatePainting {
  const flowing = PAINT_MEDIA[medium];
  const paint = still ? { ...flowing, wetting: { ...flowing.wetting, spread: 0 } } : flowing;
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: PAPER, mixing: { kind: 'pigment', medium: paint, pigments: W } }, (p) => {
    p.group('under', { composite: 'glaze', opacity: 1 }, (g) => g.passage('dry', paintMediumCan(paint, 'wet-history') ? { wetHistory: false } : {}, (pass) => {
      pass.stroke('band', { brush: ROUND, size: 30, well: { paint: pure(W.yellowOchre) }, path: [{ x: 0, y: 100 }, { x: 160, y: 96 }] });
    }));
    p.group('subject', { composite: 'glaze', opacity: 1 }, (g) => g.passage('wash', { ...(wetPaper && { preparation: { region: wetPaper } }), ...(within && { within: { region: within } }) }, body));
  }));
  return { painting, ...SIZE, t: END, images: STAMP_GATE_IMAGES };
}

/** The fenced case's masking fluid and its `within`'s edge, and the pixels held clear of both, a couple of pixels in. */
const FLUID = { x: 60, y: 62, radius: 16 };
const WITHIN_TO = 110;
const fenced = (x: number, y: number) => Math.hypot(x + 0.5 - FLUID.x, y + 0.5 - FLUID.y) < FLUID.radius - 2 || x >= WITHIN_TO + 2;

const sky = (wash: StampPassageScope) => wash.fill('sky', { brush: ROUND, size: 40, application: { kind: 'flood' }, region: SKY, well: { paint: pure(W.ultramarine) } });
const pine = (wash: StampPassageScope) => wash.fill('pine', {
  brush: ROUND, size: 40, application: { kind: 'flood' }, well: { paint: pure(W.ultramarine) },
  region: stampGatePolygon(80, 14, 60, 40, 74, 38, 50, 66, 72, 64, 40, 96, 76, 94, 76, 108, 84, 108, 84, 94, 120, 96, 88, 64, 110, 66, 86, 38, 100, 40),
});
/**
 * The unrimmed case's wash, 30 px inside its wet paper on its left; that paper, wetted past the wash on every side by
 * more than a rim's widest band (a flood's edge on dry paper is hard, and its rim would reach the rows read).
 */
const FEATHERED_WASH_LINE = SKY_BOX[0] + 30;
const FEATHERED_WASH = {
  wash: stampGateBox(FEATHERED_WASH_LINE, SKY_BOX[1], SKY_BOX[2], SKY_BOX[3]),
  // A lost edge feathers 30 px out on every side: kept that far inside the frame, as the stage margin case needs.
  lost: stampGateBox(FEATHERED_WASH_LINE, 40, 120, 80),
  paper: stampGateBox(SKY_BOX[0], SKY_BOX[1] - 40, SKY_BOX[2] + 40, SKY_BOX[3] + 40),
};
const stroke = (wash: StampPassageScope) => wash.stroke('stroke', { brush: ROUND, size: 36, well: { paint: pure(W.ultramarine) }, path: [{ x: 20, y: 40 }, { x: 140, y: 50 }] });

/** Every wash case, by ID. */
function washCases(): StampGateWashCase[] {
  const media: readonly StampGateWashMedium[] = ['watercolour', 'gouache', 'crayon'];
  // Clean water needs a wet history, which crayon hasn't.
  const water = media.filter((medium) => paintMediumCan(PAINT_MEDIA[medium], 'wet-history')).map((medium): StampGateWashCase => ({
    id: `wash/water-${medium}`, property: 'conserved',
    subject: washPainting(medium, null, (wash) => {
      stroke(wash);
      wash.water('water', { kind: 'stroke', brush: SOFT, size: 30, path: [{ x: 80, y: 10 }, { x: 70, y: 110 }] });
    }),
    without: washPainting(medium, null, stroke),
  }));
  const lifted = media.map((medium): StampGateWashCase => {
    const patches = (wash: StampPassageScope) => {
      wash.fill('left', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, 78, 10, 78, 110, 10, 110), well: { paint: pure(W.ultramarine) } });
      wash.fill('right', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(82, 10, 150, 10, 150, 110, 82, 110), well: { paint: pure(W.phthaloBlue) } });
    };
    return {
      id: `wash/lift-${medium}`, property: 'lifted', pigments: [W.ultramarine.id, W.phthaloBlue.id],
      subject: washPainting(medium, null, (wash) => {
        patches(wash);
        wash.lift('lift', { kind: 'stroke', brush: SOFT, size: 34, path: [{ x: 15, y: 60 }, { x: 145, y: 55 }] });
      }),
      without: washPainting(medium, null, patches),
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
  const rewetted = (dried: boolean, withLift: boolean) => washPainting('watercolour', null, (wash) => {
    wash.fill('sky', { brush: ROUND, size: 40, application: { kind: 'flood' }, region: SKY, well: { paint: pure(W.ultramarine) } });
    if (dried) wash.wait('set');
    wash.water('rewet', { kind: 'stroke', brush: ROUND, size: 40, path: [{ x: 15, y: 60 }, { x: 145, y: 58 }] });
    if (withLift) wash.lift('lift', { kind: 'stroke', brush: SOFT, size: 30, path: [{ x: 20, y: 60 }, { x: 140, y: 58 }] });
  });
  // A puddle, and two patches meeting at STAMP_GATE_RIM_PUDDLE.seam, all wetted together and left to dry.
  const puddles = (wash: StampPassageScope) => {
    const patch = (id: string, x0: number, x1: number) => wash.fill(id, {
      brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(x0, 10, x1, 10, x1, 110, x0, 110), well: { paint: pure(W.ultramarine), water: 1 },
    });
    patch('puddle', 10, STAMP_GATE_RIM_PUDDLE.puddleTo);
    patch('seam-left', STAMP_GATE_RIM_PUDDLE.patches[0], STAMP_GATE_RIM_PUDDLE.seam);
    patch('seam-right', STAMP_GATE_RIM_PUDDLE.seam, STAMP_GATE_RIM_PUDDLE.patches[1]);
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
    { id: 'wash/merge', property: 'spread', subject: washPainting('watercolour', null, overlapping), without: washPainting('watercolour', null, overlapping, true) },
    {
      id: 'wash/lift-neighbourhood', property: 'conserved', without: washPainting('watercolour', SKY, meeting),
      subject: washPainting('watercolour', SKY, (wash) => {
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
      subject: washPainting('watercolour', SKY, (wash) => {
        wash.mask('fluid', { region: { kind: 'ellipse', x: FLUID.x, y: FLUID.y, radiusX: FLUID.radius, radiusY: FLUID.radius } });
        sky(wash);
        wash.stroke('feather', { brush: SOFT, size: 30, well: { paint: pure(W.quinacridoneRose) }, path: [{ x: 40, y: 30 }, { x: 150, y: 34 }] });
        wash.lift('lift', { kind: 'stroke', brush: SOFT, size: 30, path: [{ x: 20, y: 64 }, { x: 140, y: 60 }] });
      }, false, stampGatePolygon(0, 0, WITHIN_TO, 0, WITHIN_TO, SIZE.height, 0, SIZE.height)),
    },
    // Against the same wet paper with paint that doesn't flow: on dry paper the brush's water would harden its edge.
    { id: 'wash/wet-in-wet', property: 'conserved', subject: washPainting('watercolour', SKY, dropped), without: washPainting('watercolour', SKY, dropped, true) },
    // A pine's tiers flow at their own small scale and its trunk at the brush's: transport varying across one flood,
    // each pair still trading alike both ways.
    { id: 'wash/narrow-wet-in-wet', property: 'conserved', subject: washPainting('watercolour', SKY, pine), without: washPainting('watercolour', SKY, pine, true) },
    {
      id: 'wash/soften', property: 'conserved', without: washPainting('watercolour', null, stroke),
      subject: washPainting('watercolour', null, (wash) => {
        stroke(wash);
        stampSoften(wash, 'edge', { brush: SOFT, size: 16, along: [{ x: 20, y: 58 }, { x: 140, y: 68 }] });
      }),
    },
    {
      id: 'wash/bloom', property: 'conserved', without: washPainting('watercolour', SKY, sky),
      subject: washPainting('watercolour', SKY, (wash) => {
        sky(wash);
        stampBloom(wash, 'bloom', { brush: SOFT, size: 24, at: [{ x: 50, y: 50 }, { x: 110, y: 70 }] });
      }),
    },
    {
      id: 'wash/bloom-after-paint', property: 'bloomed', without: washPainting('watercolour', null, paintedElsewhere),
      subject: washPainting('watercolour', null, (wash) => {
        paintedElsewhere(wash);
        stampBloom(wash, 'bloom', { brush: SOFT, size: 24, at: [{ x: STAMP_GATE_BLOOM_DROP.x, y: STAMP_GATE_BLOOM_DROP.y }] });
      }),
    },
    // A wash left until damp, a wetter stroke laid inside its right edge: its backrun runs left into the damp paint
    // and reaches the edge on its right. Against the same painting without the bloom stage.
    {
      id: 'wash/backrun-edge', property: 'unlined',
      subject: washPainting('watercolour', null, (wash) => {
        wash.fill('wash', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, STAMP_GATE_BACKRUN_EDGE.x, 10, STAMP_GATE_BACKRUN_EDGE.x, 110, 10, 110), well: { paint: pure(W.cerulean) } });
        wash.wait('damp');
        wash.stroke('side', { brush: ROUND, size: 22, well: { paint: pure(W.cerulean), water: 1 }, path: [{ x: STAMP_GATE_BACKRUN_EDGE.x - 10, y: 14 }, { x: STAMP_GATE_BACKRUN_EDGE.x - 12, y: 106 }] });
      }),
    },
    // A wash flooded on paper wetted past it stops at its line, as on dry paper: its region is a barrier, its edge
    // stroke's fringe and the wet paper past it alike.
    {
      id: 'wash/barrier', property: 'fenced', fenced: (x) => x < FEATHERED_WASH_LINE - 1,
      subject: washPainting('watercolour', FEATHERED_WASH.paper, (wash) => wash.fill('sky', { brush: FEATHER, size: 80, application: { kind: 'flood' }, region: FEATHERED_WASH.wash, well: { paint: pure(W.ultramarine) } })),
    },
    // A wash flooded on paper wetted past it, its edge lost: it feathers out over the wet, and dries with no line.
    // Against the same painting without the drying rim.
    {
      id: 'wash/soft-edge', property: 'unrimmed',
      subject: washPainting('watercolour', FEATHERED_WASH.paper, (wash) => wash.fill('sky', {
        brush: FEATHER, size: 80, application: { kind: 'flood', edge: { kind: 'lost', reach: 30 } }, region: FEATHERED_WASH.lost, well: { paint: pure(W.ultramarine) },
      })),
    },
    // A sky not yet damp, water dropped in it: on paper this wet the water runs on, its edge soft and open. Against
    // the same sky without it.
    {
      id: 'wash/bloom-wet', property: 'unlipped', without: washPainting('watercolour', null, sky),
      subject: washPainting('watercolour', null, (wash) => {
        sky(wash);
        wash.wait({ seconds: STAMP_GATE_WET_DROP.seconds });
        wash.water('drop', { kind: 'stamps', brush: SOFT, size: 30, at: [{ x: STAMP_GATE_WET_DROP.x, y: STAMP_GATE_WET_DROP.y }] });
      }),
    },
    // The same drop into the sky at damp, all the sky's paper as wet: it stalls all round, and lips all round.
    {
      id: 'wash/bloom-damp', property: 'lipped', without: washPainting('watercolour', null, sky),
      subject: washPainting('watercolour', null, (wash) => {
        sky(wash);
        stampBloom(wash, 'drop', { brush: SOFT, size: 30, at: [{ x: STAMP_GATE_WET_DROP.x, y: STAMP_GATE_WET_DROP.y }] });
      }),
    },
    // Against the same paint that doesn't flow, so neither moves nor rims.
    { id: 'wash/rim', property: 'rimmed', subject: washPainting('watercolour', null, puddles), without: washPainting('watercolour', null, puddles, true) },
    // Crayon sets as it lands, so its lifts are only ever of set wax.
    stampGateLiftColourCase('wash/lift-paler-gouache-wet', 'gouache', false),
    stampGateLiftColourCase('wash/lift-paler-gouache-dry', 'gouache', true),
    stampGateLiftColourCase('wash/lift-paler-crayon', 'crayon', false),
    // A dry brush and a wet one in each wet medium, read against the paper's grain.
    stampGateDryBrushCase('wash/dry-brush', 'watercolour'),
    stampGateDryBrushCase('wash/dry-brush-gouache', 'gouache'),
    {
      id: 'wash/wait', property: 'drawn',
      subject: washPainting('watercolour', null, (wash) => {
        wash.fill('first', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(10, 10, 100, 10, 100, 110, 10, 110), well: { paint: pure(W.cerulean) } });
        wash.wait('set');
        wash.fill('second', { brush: ROUND, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(60, 10, 150, 10, 150, 110, 60, 110), well: { paint: pure(W.burntSienna) } });
      }),
    },
    {
      id: 'wash/graded', property: 'drawn',
      subject: washPainting('watercolour', SKY, (wash) => wash.fill('graded', {
        brush: ROUND, size: 40, application: { kind: 'flood' }, region: SKY, well: { paint: pure(W.ultramarine) },
        load: { kind: 'linear', from: { x: 0, y: 10, value: 1 }, to: { x: 0, y: 110, value: 0.2 } },
      })),
    },
    // Noise on the GPU's field readers: a flood's load, and a material two deposits share as one passage.
    {
      id: 'wash/mottled', property: 'drawn',
      subject: washPainting('watercolour', null, (wash) => {
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
  return compileStampPigmentPaint(stampMixedPainting(painting), mixing, PAINT_BANDS).groups.at(-1)!.palette.map(({ id }) => id);
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
