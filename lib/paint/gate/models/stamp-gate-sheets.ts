// stamp-gate-sheets.ts: the gate's sheet solves (ENGINE 9, tests 3, 6's sheets, 7 and 8; test 4's clocks are in
// stamp-gate-clocks.ts): painting documents compiled and solved forward on the GPU, held to the wet laws' closed forms
// on the 1 ms grid, to what an appended application, a posed group or a separate sheet may change, and the reductions
// to exact integer totals. Three are accepted by eye (STAMP_GATE_SOLVED_IDS). Every brush a gate document names is the
// gate's round.

import type { PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import meadow from '#lib/paint/document/models/meadow.painting.ts';
import { compilePaintingSelection, type PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import { paintingSheetPosed, paintingSimilarityPose, type PaintingPoses } from '#lib/paint/document/models/painting-pose.ts';
import type { BrushRef, PaintingDocument, Region, Subpath } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { painting, type PaintingEvaluation, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampPointBox } from '#lib/paint/painting/models/stamp-stage.ts';
import type { StampSheetProgram } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { stampSheetGrid, stampSheetSeconds, type StampSheetDecision } from '#lib/paint/painting/models/stamp-sheet-schedule.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-canonical.ts';
import { stampDrying, stampDryingTimes } from '#lib/paint/painting/models/stamp-wetness.ts';
import { stampGateSlotAmounts, type StampGateLayer, type StampGateWashCheck } from './stamp-gate-layer.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, type StampGateImage } from './stamp-gate-paintings.ts';
import { STAMP_GATE_HERON_TURNED, STAMP_GATE_PAPER_HERON, stampGatePaperHeronPoses } from './stamp-gate-paper-heron.ts';

export const STAMP_GATE_SHEET_IDS = ['schedule/forward', 'schedule/clocks', 'schedule/reductions', 'sheet/wet-contact', 'paper/heron'] as const;
export type StampGateSheetId = (typeof STAMP_GATE_SHEET_IDS)[number];

/** The sheet solves accepted by eye: each a baseline subject, its document's still. */
export const STAMP_GATE_SOLVED_IDS = ['solved/forward', 'solved/wet-contact', 'solved/paper-heron'] as const;
export type StampGateSolvedId = (typeof STAMP_GATE_SOLVED_IDS)[number];

/** The gate's round, flooding at full flow: its touch whole inside a fill, so a flood's water lands at its own. */
const ROUND = stampGateBrush('Round', { flow: 1 });

/** Every brush a gate document names, the meadow's too, as the gate paints it: the gate's round. */
export const stampGateSheetBrushOf = (_ref: BrushRef) => ROUND;

/**
 * The images a sheet case loads, by file: the round's tip, and the meadow's paper grain drawn as the gate's grain,
 * as the public gate holds no pack.
 */
export const STAMP_GATE_SHEET_IMAGES = {
  'round.png': STAMP_GATE_IMAGES['round.png'],
  [meadow({ hillTopPx: 200 }).paper.grain!.image.file]: STAMP_GATE_IMAGES['grain.png'],
} satisfies Readonly<Record<string, StampGateImage>>;

/** `source`'s root sheet at `values`, compiled with the gate's brushes. */
export const stampGateSheetProgram = <S extends PropertySchema>(source: PaintingSourceModule<S>, values: Partial<PropertyValues<S>> = {}) =>
  compilePaintingSelection(painting(source, values), stampGateSheetBrushOf).sheets[0].program;

/** The gate sheets' brush as their documents name it, and the two mixes they paint in. */
export const STAMP_GATE_ROUND_REF: BrushRef = { style: 'gate', brush: 'round' };
const { cerulean, ultramarine, burntSienna } = WATERCOLOUR_PIGMENTS;
export const STAMP_GATE_POOL_MIX = { parts: [{ pigment: cerulean, amount: 1 }, { pigment: ultramarine, amount: 0.3 }], strength: 0.5 };
export const STAMP_GATE_EARTH_MIX = { parts: [{ pigment: burntSienna, amount: 1 }], strength: 0.8 };

/**
 * A paper whose drying rate puts no closed-form time on the 1 ms grid: a decision a step off its closed form is the
 * solver's, never a tie f32 broke.
 */
export const STAMP_GATE_SHEET_PAPER = { color: '#ffffff', absorbency: 0.37 } as const;
export const STAMP_GATE_SHEET_DRYING = stampDrying(PAINT_MEDIA.watercolour.wetting, STAMP_GATE_SHEET_PAPER);

export const stampGateRectangle = (x0: number, y0: number, x1: number, y1: number): Region => ({ kind: 'polygon', rings: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]] });
export const stampGateLine = (...xy: number[]): Subpath => xy.flatMap((v, i) => (i % 2 ? [] : [{ x: v, y: xy[i + 1] }]));

const FORWARD = { width: 160, height: 120 } as const;
export const STAMP_GATE_FLOOD_WATER = 0.85;

const forwardProperties = { appended: { type: 'boolean', default: false } } as const satisfies PropertySchema;

/**
 * A flood; a charge `on: 'wet'` into it; a bloom `on: 'damp'` once it turns matte; a scrub `on: 'dry'` once it sets;
 * and, `appended`, a veil after them all in the flood's own paint.
 */
export const STAMP_GATE_FORWARD: PaintingSourceModule<typeof forwardProperties> = {
  properties: forwardProperties,
  default: function gateForward({ appended }: PropertyValues<typeof forwardProperties>): PaintingDocument {
    return {
      widthPx: FORWARD.width, heightPx: FORWARD.height, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour',
      layers: [{
        key: 'pond',
        washes: [{
          key: 'pool',
          applications: [
            { key: 'flood', kind: 'fill', area: { region: stampGateRectangle(16, 16, 144, 104) }, brush: STAMP_GATE_ROUND_REF, diameterPx: 24, seed: 'flood', charge: { kind: 'paint', mix: STAMP_GATE_POOL_MIX, water: STAMP_GATE_FLOOD_WATER } },
            { key: 'charge', on: 'wet', kind: 'stroke', subpaths: [stampGateLine(36, 40, 48, 60, 40, 80)], brush: STAMP_GATE_ROUND_REF, diameterPx: 10, seed: 'charge', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.6 } },
            { key: 'bloom', on: 'damp', effect: 'bloom', kind: 'stamps', placements: [{ x: 96, y: 60 }], brush: STAMP_GATE_ROUND_REF, diameterPx: 20, seed: 'bloom', charge: { kind: 'water', water: 0.95 } },
            { key: 'scrub', on: 'dry', kind: 'stroke', subpaths: [stampGateLine(126, 32, 128, 88)], brush: STAMP_GATE_ROUND_REF, diameterPx: 10, seed: 'scrub', charge: { kind: 'lift', strength: 0.6 } },
            ...(appended ? [{ key: 'veil', kind: 'stroke', subpaths: [stampGateLine(24, 96, 136, 96)], brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: 'veil', charge: { kind: 'paint', mix: STAMP_GATE_POOL_MIX, water: 0.5 } } as const] : []),
          ],
        }],
      }],
    };
  },
};

/** The forward entries' times by the closed forms: flood and charge at once, the bloom when the flood turns matte, the scrub when it sets. */
export function stampGateForwardTimes(): number[] {
  const flood = stampDryingTimes(STAMP_GATE_FLOOD_WATER, STAMP_GATE_SHEET_DRYING), matte = stampSheetGrid(0, flood.matteFrom);
  return [0, 0, matte, stampSheetGrid(matte, flood.setFrom)];
}

const erasedProperties = { erased: { type: 'boolean', default: true } } as const satisfies PropertySchema;

/** Where the erased crayon line lies and the eraser crosses it, document px: its band, and the eraser's core across it. */
export const STAMP_GATE_ERASED_AT = { line: { y0: 28, y1: 37 }, core: { x0: 45, x1: 52 }, eraser: { x0: 38, x1: 59 } } as const;

/** A crayon line drawn direct, and, `erased`, an eraser rubbed across its middle after it in the same wash. */
export const STAMP_GATE_ERASED: PaintingSourceModule<typeof erasedProperties> = {
  properties: erasedProperties,
  default: function gateErased({ erased }: PropertyValues<typeof erasedProperties>): PaintingDocument {
    const line = { key: 'line', kind: 'stroke', subpaths: [stampGateLine(8, 32, 88, 32)], brush: STAMP_GATE_ROUND_REF, diameterPx: 8, seed: 'line', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX } } as const;
    const eraser = { key: 'eraser', kind: 'stroke', subpaths: [stampGateLine(48, 12, 48, 52)], brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: 'eraser', charge: { kind: 'lift', strength: 1 } } as const;
    return {
      widthPx: 96, heightPx: 64, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour',
      layers: [{ key: 'drawing', medium: 'crayon', washes: [{ key: 'lines', wetHistory: false, applications: erased ? [line, eraser] : [line] }] }],
    };
  },
};

/** One damp application on paper nothing wetted. */
export const STAMP_GATE_NEVER_WETTED: PaintingSourceModule = {
  default: function gateNeverWetted(): PaintingDocument {
    return {
      widthPx: 96, heightPx: 64, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour',
      layers: [{ key: 'sheet', washes: [{ key: 'dry', applications: [{ key: 'early', on: 'damp', kind: 'stroke', subpaths: [stampGateLine(20, 32, 76, 32)], brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: 'early', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.5 } }] }] }],
    };
  },
};

/** What a damp application over never-wetted paper fails with, to the letter. */
export const STAMP_GATE_NEVER_WETTED_MESSAGE =
  "early: unreachable from this committed prefix: on 'damp' held over at most 0% of its core (needs 95%), at model 0 s [0,0 → 96,64]; " +
  'never wetted on this sheet: 100% of its core met no water before it; lay it over a flood or prewet earlier on the sheet, or drop the `on`';

const liftedProperties = { order: { type: 'enum', values: ['lifted', 'waited', 'charged'], default: 'lifted' } } as const satisfies PropertySchema;

/**
 * A flood, a lift down its middle and a charge `on: 'wet'` across the lift, in `order`: `lifted`, the lift first, so
 * the charge meets the paper it dried; `waited`, the lift and then a soak `on: 'damp'` beside it first, so the charge
 * lands once the flood has lost its shine; `charged`, the charge first, landing with its flood.
 */
export const STAMP_GATE_LIFTED: PaintingSourceModule<typeof liftedProperties> = {
  properties: liftedProperties,
  default: function gateLifted({ order }: PropertyValues<typeof liftedProperties>): PaintingDocument {
    const flood = { key: 'flood', kind: 'fill', area: { region: stampGateRectangle(16, 16, 144, 104) }, brush: STAMP_GATE_ROUND_REF, diameterPx: 24, seed: 'flood', charge: { kind: 'paint', mix: STAMP_GATE_POOL_MIX, water: STAMP_GATE_FLOOD_WATER } } as const;
    const lift = { key: 'lift', kind: 'stroke', subpaths: [stampGateLine(80, 24, 80, 96)], brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: 'lift', charge: { kind: 'lift', strength: 0.8 } } as const;
    const soak = { key: 'soak', on: 'damp', kind: 'stroke', subpaths: [stampGateLine(30, 36, 60, 36)], brush: STAMP_GATE_ROUND_REF, diameterPx: 10, seed: 'soak', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.5 } } as const;
    const charge = { key: 'charge', on: 'wet', kind: 'stroke', subpaths: [stampGateLine(40, 60, 120, 60)], brush: STAMP_GATE_ROUND_REF, diameterPx: 10, seed: 'charge', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.6 } } as const;
    const applications = { lifted: [flood, lift, charge], waited: [flood, lift, soak, charge], charged: [flood, charge, lift] }[order];
    return {
      widthPx: FORWARD.width, heightPx: FORWARD.height, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour',
      layers: [{ key: 'pond', washes: [{ key: 'pool', applications }] }],
    };
  },
};

/**
 * How the charge across the lift is refused, but for its share and boxes: `lifted`, naming the lift and its fix;
 * `waited`, the flood past its shine, the lift not named.
 */
export const STAMP_GATE_LIFTED_REFUSALS = {
  lifted: {
    starts: "charge: unreachable from this committed prefix: on 'wet' held over ",
    ends: "; it crosses lift, which took up the paper's water there: lay it before lift",
  },
  waited: {
    starts: "charge: unreachable from this committed prefix: on 'wet' held over 0% of its core (needs 95%) when it lands, at model ",
    ends: '; the water under it dried past shiny before it lands: lay it sooner, ahead of what waits after that water, or flood wetter before it',
  },
} as const;

const PREWET_WATER = 0.9;
const BLOOM_WATER = 0.95;

/**
 * Three layers, a wash each, laid at once: an even flood; a prewet with a drier line inside it, which leaves its level
 * as it was; and a flood bloomed into `on: 'damp'`.
 */
export const STAMP_GATE_DAMP_WINDOWS: PaintingSourceModule = {
  default: function gateDampWindows(): PaintingDocument {
    const fill = (key: string, [x0, y0, x1, y1]: readonly [number, number, number, number]) =>
      ({ key, kind: 'fill', area: { region: stampGateRectangle(x0, y0, x1, y1) }, brush: STAMP_GATE_ROUND_REF, diameterPx: 24, seed: key, charge: { kind: 'paint', mix: STAMP_GATE_POOL_MIX, water: STAMP_GATE_FLOOD_WATER } } as const);
    const line = { key: 'soaked-line', kind: 'stroke', subpaths: [stampGateLine(84, 24, 84, 96)], brush: STAMP_GATE_ROUND_REF, diameterPx: 8, seed: 'soaked-line', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.5 } } as const;
    const bloom = { key: 'lake-bloom', on: 'damp', effect: 'bloom', kind: 'stamps', placements: [{ x: 132, y: 60 }], brush: STAMP_GATE_ROUND_REF, diameterPx: 20, seed: 'lake-bloom', charge: { kind: 'water', water: BLOOM_WATER } } as const;
    return {
      widthPx: 160, heightPx: 120, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour',
      layers: [
        { key: 'pond', washes: [{ key: 'even', applications: [fill('even-flood', [8, 8, 56, 112])] }] },
        { key: 'marsh', washes: [{ key: 'soaked', prewet: { region: stampGateRectangle(64, 8, 104, 112), water: PREWET_WATER }, applications: [line] }] },
        { key: 'lake', washes: [{ key: 'bloomed', applications: [fill('lake-flood', [112, 8, 152, 112]), bloom] }] },
      ],
    };
  },
};

/**
 * The damp-window sheet's report as `studio paint check --solve` prints it, by the closed forms on the 1 ms grid:
 * each flood damp from (ℓ − d)/r until o + ℓ/r, ℓ the flood's water or the prewet's; the bloom, landing once its
 * flood turns matte, damp again from (w − d)/r after.
 */
export function stampGateDampWindowTexts(): { even: string; soaked: string; bloom: string } {
  const dampText = (level: number) => {
    const { matteFrom, setFrom } = stampDryingTimes(level, STAMP_GATE_SHEET_DRYING);
    return `damp from ${stampSheetSeconds(stampSheetGrid(0, matteFrom))} until ${stampSheetSeconds(stampSheetGrid(0, setFrom))}`;
  };
  const blooms = stampSheetGrid(0, stampDryingTimes(STAMP_GATE_FLOOD_WATER, STAMP_GATE_SHEET_DRYING).matteFrom);
  const again = stampSheetGrid(blooms, blooms + stampDryingTimes(BLOOM_WATER, STAMP_GATE_SHEET_DRYING).matteFrom);
  return {
    even: `  even: ${dampText(STAMP_GATE_FLOOD_WATER)}, set by `, soaked: `  soaked: ${dampText(PREWET_WATER)}, set by `,
    bloom: `  lake-bloom: rewets its footprint, damp again from ${stampSheetSeconds(again)} until `,
  };
}

const WET_CONTACT = { width: 160, height: 120 } as const;
const SHALLOWS_WATER = 0.75;
const FOOT_WATER = 1;
const FOOT = stampGateLine(70, 80, 80, 92, 92, 80);
/**
 * The sheet's drying scale and the foot's two times, scene seconds: the charge lands while the shallows shine (matte
 * by 1.65 s), the glaze once they and the charge's wetter water have set (by 3.1 s and 4.6 s).
 */
const WET_CONTACT_SCALE = 0.015;
const FOOT_CHARGE_AT = 0.5;
const FOOT_GLAZE_AT = 6;

const wetContactProperties = { heron: { type: 'boolean', default: true }, apart: { type: 'boolean', default: false } } as const satisfies PropertySchema;

/**
 * Shallows flooded across the sheet's foot from 0 s, and, `heron`, a rigged heron whose foot charges across their
 * edge at 0.5 s while they shine, their paint walking into its water, and glazes at 6 s once all under it has set
 * (`on: 'dry'`), on one sheet (ENGINE 4.1); `apart`, each on an own sheet at that scale.
 */
export const STAMP_GATE_WET_CONTACT: PaintingSourceModule<typeof wetContactProperties> = {
  properties: wetContactProperties,
  default: function gateWetContact({ heron, apart }: PropertyValues<typeof wetContactProperties>): PaintingDocument {
    const sheet = apart ? { sheet: { kind: 'own', paper: STAMP_GATE_SHEET_PAPER, dryingScale: WET_CONTACT_SCALE } } as const : {};
    const shallows = {
      key: 'shallows', ...sheet,
      washes: [{
        key: 'shallows-wash', clock: { origin: 0 },
        applications: [{ key: 'flood', kind: 'fill', area: { region: stampGateRectangle(0, 84, 160, 120) }, brush: STAMP_GATE_ROUND_REF, diameterPx: 24, seed: 'shallows', charge: { kind: 'paint', mix: STAMP_GATE_POOL_MIX, water: SHALLOWS_WATER } }],
      }],
    } as const;
    const foot = {
      key: 'foot',
      washes: [{
        key: 'foot-wash', clock: { origin: FOOT_CHARGE_AT },
        applications: [
          { key: 'charge', at: FOOT_CHARGE_AT, kind: 'stroke', subpaths: [FOOT], brush: STAMP_GATE_ROUND_REF, diameterPx: 10, seed: 'foot', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: FOOT_WATER } },
          { key: 'glaze', at: FOOT_GLAZE_AT, on: 'dry', kind: 'stroke', subpaths: [FOOT], brush: STAMP_GATE_ROUND_REF, diameterPx: 14, seed: 'glaze', charge: { kind: 'paint', mix: { ...STAMP_GATE_EARTH_MIX, strength: 0.5 }, water: 0.4 } },
        ],
      }],
    } as const;
    return {
      widthPx: WET_CONTACT.width, heightPx: WET_CONTACT.height, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour', ...(!apart && { dryingScale: WET_CONTACT_SCALE }),
      layers: heron ? [shallows, { key: 'heron', ...sheet, children: [foot] }] : [shallows],
    };
  },
};

/** The heron's second pose, a similarity that only moves it, document px: still across the shallows' edge. */
export const STAMP_GATE_HERON_POSE = { ma: 1, mb: 0, kx: 24, ky: -6 } as const;
/** A pose lifting the heron's foot clear of the shallows, onto paper nothing wetted. */
export const STAMP_GATE_HERON_AWAY = { ma: 1, mb: 0, kx: 0, ky: -70 } as const;

/** The wet-contact sheet's program with its heron posed by `pose`, as the shot poses a group (painting-pose.ts). */
export function stampGateHeronPosed(pose: PaintSimilarity): StampSheetProgram {
  const evaluation = painting(STAMP_GATE_WET_CONTACT), { program } = compilePaintingSelection(evaluation, stampGateSheetBrushOf).sheets[0];
  return paintingSheetPosed(evaluation.tree, program, new Map([['heron', paintingSimilarityPose(pose)]]));
}
/** Where the foot's charge touches at rest, document px; and a stretch of the shallows far from it. */
export const STAMP_GATE_FOOT_BOX = { x: 64, y: 74, w: 34, h: 24 } as const;
export const STAMP_GATE_FAR_SHALLOWS = { x: 0, y: 92, w: 32, h: 28 } as const;

/** The wet-contact entries' times, model seconds: each its scene second's on the clock run from the shallows' 0 s. */
export function stampGateWetContactTimes(): number[] {
  return [0, FOOT_CHARGE_AT / WET_CONTACT_SCALE, FOOT_GLAZE_AT / WET_CONTACT_SCALE];
}

/** The still solved baseline `id` draws: an evaluation, every layer of it compiled, and the poses it holds. */
export type StampGateSolvedStill = { readonly evaluation: PaintingEvaluation; readonly compiled: PaintingSelectionCompiled; readonly poses: PaintingPoses };

const SOLVED_STILLS: Readonly<Record<StampGateSolvedId, () => { evaluation: PaintingEvaluation; poses: PaintingPoses }>> = {
  'solved/forward': () => ({ evaluation: painting(STAMP_GATE_FORWARD), poses: new Map() }),
  'solved/wet-contact': () => ({ evaluation: painting(STAMP_GATE_WET_CONTACT), poses: new Map() }),
  'solved/paper-heron': () => ({ evaluation: painting(STAMP_GATE_PAPER_HERON), poses: stampGatePaperHeronPoses(STAMP_GATE_HERON_TURNED) }),
};

/** Solved baseline `id`'s still, compiled with the gate's brushes. */
export function stampGateSolvedStill(id: StampGateSolvedId): StampGateSolvedStill {
  const { evaluation, poses } = SOLVED_STILLS[id]();
  return { evaluation, compiled: compilePaintingSelection(evaluation, stampGateSheetBrushOf), poses };
}

/** What solved baseline `id` is drawn from, as text: its sheets' programs, how they're laid, its poses and the images it loads. */
export function stampGateSolvedInputs(id: StampGateSolvedId) {
  const { compiled, poses } = stampGateSolvedStill(id);
  // A similarity's words as they always were, so a baseline's inputs read alike.
  const posed = [...poses].map(([key, pose]) => [key, pose.kind === 'similarity' ? pose.map : pose.text]);
  return stampCanonicalJson({ programs: compiled.sheets.map(({ program }) => program), steps: compiled.steps, poses: posed, images: STAMP_GATE_SHEET_IMAGES });
}

const REBASE_WASHES = 22;
/**
 * A level whose set time, 400.0005 s after it lands on a paper of absorbency 0, sits half a step off the grid: f32
 * near 2¹³ s rounds by under a quarter of a step, so the f64 reference and the solve agree only if the rebase holds.
 */
const REBASE_LEVEL = (400.0005 * (0.5 + 0)) / PAINT_MEDIA.watercolour.wetting.drying;
const REBASE_PAPER = { color: '#ffffff', absorbency: 0 } as const;

/** Washes of one layer each flooding the same square once the last has set, past 2¹³ s, then one damp application. */
export const STAMP_GATE_REBASE: PaintingSourceModule = {
  default: function gateRebase(): PaintingDocument {
    const flood = (w: number) => ({ key: `flood${w}`, kind: 'fill', area: { region: stampGateRectangle(8, 8, 56, 56) }, brush: STAMP_GATE_ROUND_REF, diameterPx: 16, seed: `flood${w}`, charge: { kind: 'paint', mix: STAMP_GATE_POOL_MIX, water: REBASE_LEVEL } } as const);
    const late = { key: 'late', on: 'damp', kind: 'stamps', placements: [{ x: 32, y: 32 }], brush: STAMP_GATE_ROUND_REF, diameterPx: 12, seed: 'late', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.2 } } as const;
    return {
      widthPx: 64, heightPx: 64, paper: REBASE_PAPER, medium: 'watercolour',
      layers: [{ key: 'stack', washes: Array.from({ length: REBASE_WASHES }, (_, w) => ({ key: `wash${w}`, applications: w === REBASE_WASHES - 1 ? [flood(w), late] : [flood(w)] })) }],
    };
  },
};

/** The rebase document's times in f64: each wash once the last has set, the damp application once its flood turns matte. */
export function stampGateRebaseTimes(): number[] {
  const { matteFrom, setFrom } = stampDryingTimes(REBASE_LEVEL, stampDrying(PAINT_MEDIA.watercolour.wetting, REBASE_PAPER));
  const floods = Array.from({ length: REBASE_WASHES }).reduce<number[]>((times) => [...times, times.length ? stampSheetGrid(times.at(-1)!, times.at(-1)! + setFrom) : 0], []);
  return [...floods, stampSheetGrid(floods.at(-1)!, floods.at(-1)! + matteFrom)];
}

/** Whether each decision's τ is the closed form's, and none was warned near rounding. */
export function checkStampGateTimes(id: string, decisions: readonly StampSheetDecision[], times: readonly number[], names: readonly string[]): StampGateWashCheck {
  const off = decisions.flatMap(({ tau }, k) => (tau === times[k] ? [] : [`${names[k]} at ${tau} s, not ${times[k]} s`]));
  const warned = decisions.flatMap(({ warnings }) => warnings);
  return {
    id, passed: decisions.length === times.length && !off.length && !warned.length,
    detail: `${names.map((name, k) => `${name} ${decisions[k] ? stampSheetSeconds(decisions[k].tau) : '–'}`).join(', ')}${off.length ? `; ${off.join('; ')}` : ''}${warned.length ? `; warned: ${warned.join('; ')}` : ''}`,
  };
}

/** A film as a solve kept it: the painting points it covers (null for none) and its texels there. */
export type StampGateFilm = { box: StampPointBox | null; layer: StampGateLayer | null };

/** A film's channel `c` of layer `l` at painting point (x, y): 0 outside its box. */
function stampGateFilmValue({ box, layer }: StampGateFilm, x: number, y: number, l: number, c: number): number {
  if (!box || !layer || x < box.x || y < box.y || x >= box.x + box.w || y >= box.y + box.h) return 0;
  return layer.values[((l * box.h + (y - box.y)) * box.w + (x - box.x)) * 4 + c];
}

/** The largest difference between two films' texels over painting points `within` (where neither holds paint reads 0). */
export function stampGateFilmDifference(a: StampGateFilm, b: StampGateFilm, within: Pick<StampPointBox, 'x' | 'y' | 'w' | 'h'>): number {
  const layers = Math.max(a.layer?.layers ?? 0, b.layer?.layers ?? 0);
  let most = 0;
  for (let y = within.y; y < within.y + within.h; y++) {
    for (let x = within.x; x < within.x + within.w; x++) {
      for (let l = 0; l < layers; l++) for (let c = 0; c < 4; c++) most = Math.max(most, Math.abs(stampGateFilmValue(a, x, y, l, c) - stampGateFilmValue(b, x, y, l, c)));
    }
  }
  return most;
}

/** How much of `slot`'s pigment `film` holds over painting points `within`, end exclusive. */
export function stampGateFilmMass(film: StampGateFilm, slot: number, within: StampBox): number {
  const channel = slot + 1;
  let total = 0;
  for (let y = within.y0; y < within.y1; y++) for (let x = within.x0; x < within.x1; x++) total += stampGateFilmValue(film, x, y, channel >> 2, channel & 3);
  return total;
}

/** The centre of `slot`'s pigment in `film`, painting points; null for a film holding none. */
export function stampGateFilmCentre({ box, layer }: StampGateFilm, slot: number): { x: number; y: number } | null {
  if (!box || !layer) return null;
  const amounts = stampGateSlotAmounts(layer, slot);
  let total = 0, x = 0, y = 0;
  amounts.forEach((amount, i) => {
    total += amount;
    x += amount * (box.x + (i % box.w) + 0.5);
    y += amount * (box.y + Math.floor(i / box.w) + 0.5);
  });
  return total > 0 ? { x: x / total, y: y / total } : null;
}

/** Whether two films are the same texel for texel: the same box, every value equal. */
export function stampGateFilmsEqual(a: StampGateFilm, b: StampGateFilm): boolean {
  if (JSON.stringify(a.box) !== JSON.stringify(b.box)) return false;
  if (!a.layer || !b.layer) return a.layer === b.layer;
  return a.layer.values.length === b.layer.values.length && a.layer.values.every((v, i) => Object.is(v, b.layer!.values[i]));
}
