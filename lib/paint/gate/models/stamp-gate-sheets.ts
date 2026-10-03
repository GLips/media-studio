// stamp-gate-sheets.ts: the gate's sheet solves (ENGINE 9, tests 3, 7 and 8, unclocked): painting documents compiled
// and solved forward on the GPU, held to the wet laws' closed forms on the 1 ms grid, to what an appended application
// or a posed group may change, and the reductions to exact integer totals. Two are accepted by eye
// (STAMP_GATE_SOLVED_IDS). Every brush a gate document names is the gate's round.

import meadow from '#lib/paint/document/models/meadow.painting.ts';
import { compilePaintingSelection } from '#lib/paint/document/models/painting-document-compile.ts';
import { paintingSheetPosed } from '#lib/paint/document/models/painting-pose.ts';
import type { BrushRef, PaintingDocument, Region, Subpath } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import { painting, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { WATERCOLOUR_PIGMENTS } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { StampPixelBox } from '#lib/paint/painting/models/stamp-blur-region.ts';
import type { StampSheetProgram } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { stampSheetGrid, stampSheetSeconds, type StampSheetDecision } from '#lib/paint/painting/models/stamp-sheet-schedule.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import { stampDrying } from '#lib/paint/painting/models/stamp-wetness.ts';
import { stampGateSlotAmounts, type StampGateLayer, type StampGateWashCheck } from './stamp-gate-layer.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, type StampGateImage } from './stamp-gate-paintings.ts';

export const STAMP_GATE_SHEET_IDS = ['schedule/forward', 'schedule/reductions', 'sheet/wet-contact'] as const;
export type StampGateSheetId = (typeof STAMP_GATE_SHEET_IDS)[number];

/** The sheet solves accepted by eye: each a baseline subject, its document's still. */
export const STAMP_GATE_SOLVED_IDS = ['solved/forward', 'solved/wet-contact'] as const;
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

const GATE_ROUND: BrushRef = { style: 'gate', brush: 'round' };
const { cerulean, ultramarine, burntSienna } = WATERCOLOUR_PIGMENTS;
const POOL = { parts: [{ pigment: cerulean, amount: 1 }, { pigment: ultramarine, amount: 0.3 }], strength: 0.5 };
const EARTH = { parts: [{ pigment: burntSienna, amount: 1 }], strength: 0.8 };

/**
 * A paper whose drying rate puts no closed-form time on the 1 ms grid: a decision a step off its closed form is the
 * solver's, never a tie f32 broke.
 */
const SHEET_PAPER = { color: '#ffffff', absorbency: 0.37 } as const;
const DRYING = stampDrying(PAINT_MEDIA.watercolour.wetting, SHEET_PAPER);

const rectangle = (x0: number, y0: number, x1: number, y1: number): Region => ({ kind: 'polygon', rings: [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]] });
const line = (...xy: number[]): Subpath => xy.flatMap((v, i) => (i % 2 ? [] : [{ x: v, y: xy[i + 1] }]));

const FORWARD = { width: 160, height: 120 } as const;
const FLOOD_WATER = 0.85;

const forwardProperties = { appended: { type: 'boolean', default: false } } as const satisfies PropertySchema;

/**
 * A flood; a charge `on: 'wet'` into it; a bloom `on: 'damp'` once it turns matte; a scrub `on: 'dry'` once it sets;
 * and, `appended`, a veil after them all in the flood's own paint.
 */
export const STAMP_GATE_FORWARD: PaintingSourceModule<typeof forwardProperties> = {
  properties: forwardProperties,
  default: function gateForward({ appended }: PropertyValues<typeof forwardProperties>): PaintingDocument {
    return {
      widthPx: FORWARD.width, heightPx: FORWARD.height, paper: SHEET_PAPER, medium: 'watercolour',
      layers: [{
        key: 'pond',
        washes: [{
          key: 'pool',
          applications: [
            { key: 'flood', kind: 'fill', area: { region: rectangle(16, 16, 144, 104) }, brush: GATE_ROUND, diameterPx: 24, seed: 'flood', charge: { kind: 'paint', mix: POOL, water: FLOOD_WATER } },
            { key: 'charge', on: 'wet', kind: 'stroke', subpaths: [line(36, 40, 48, 60, 40, 80)], brush: GATE_ROUND, diameterPx: 10, seed: 'charge', charge: { kind: 'paint', mix: EARTH, water: 0.6 } },
            { key: 'bloom', on: 'damp', effect: 'bloom', kind: 'stamps', placements: [{ x: 96, y: 60 }], brush: GATE_ROUND, diameterPx: 20, seed: 'bloom', charge: { kind: 'water', water: 0.95 } },
            { key: 'scrub', on: 'dry', kind: 'stroke', subpaths: [line(126, 32, 128, 88)], brush: GATE_ROUND, diameterPx: 10, seed: 'scrub', charge: { kind: 'lift', strength: 0.6 } },
            ...(appended ? [{ key: 'veil', kind: 'stroke', subpaths: [line(24, 96, 136, 96)], brush: GATE_ROUND, diameterPx: 12, seed: 'veil', charge: { kind: 'paint', mix: POOL, water: 0.5 } } as const] : []),
          ],
        }],
      }],
    };
  },
};

/** The forward entries' times by the closed forms: flood and charge at once, the bloom when the flood turns matte, the scrub when it sets. */
export function stampGateForwardTimes(): number[] {
  const matte = stampSheetGrid(0, (FLOOD_WATER - DRYING.damp) / DRYING.rate);
  return [0, 0, matte, stampSheetGrid(matte, DRYING.openTime + FLOOD_WATER / DRYING.rate)];
}

/** One damp application on paper nothing wetted. */
export const STAMP_GATE_NEVER_WETTED: PaintingSourceModule = {
  default: function gateNeverWetted(): PaintingDocument {
    return {
      widthPx: 96, heightPx: 64, paper: SHEET_PAPER, medium: 'watercolour',
      layers: [{ key: 'sheet', washes: [{ key: 'dry', applications: [{ key: 'early', on: 'damp', kind: 'stroke', subpaths: [line(20, 32, 76, 32)], brush: GATE_ROUND, diameterPx: 12, seed: 'early', charge: { kind: 'paint', mix: EARTH, water: 0.5 } }] }] }],
    };
  },
};

/** What a damp application over never-wetted paper fails with, to the letter. */
export const STAMP_GATE_NEVER_WETTED_MESSAGE =
  "early: unreachable from this committed prefix: on 'damp' held over at most 0% of its core (needs 95%), at model 0 s [0,0 → 96,64]; never wetted on this sheet";

const WET_CONTACT = { width: 160, height: 120 } as const;
const SHALLOWS_WATER = 0.75;
const FOOT_WATER = 1;
const FOOT = line(70, 80, 80, 92, 92, 80);

const wetContactProperties = { heron: { type: 'boolean', default: true } } as const satisfies PropertySchema;

/**
 * Shallows flooded across the foot of the sheet, and, `heron`, a rigged heron group whose foot charges across their
 * edge while they shine, its water letting their paint walk out into it, and glazes once all under it has set (`on:
 * 'dry'`), on the same sheet.
 */
export const STAMP_GATE_WET_CONTACT: PaintingSourceModule<typeof wetContactProperties> = {
  properties: wetContactProperties,
  default: function gateWetContact({ heron }: PropertyValues<typeof wetContactProperties>): PaintingDocument {
    const shallows = {
      key: 'shallows',
      washes: [{ key: 'shallows-wash', applications: [{ key: 'flood', kind: 'fill', area: { region: rectangle(0, 84, 160, 120) }, brush: GATE_ROUND, diameterPx: 24, seed: 'shallows', charge: { kind: 'paint', mix: POOL, water: SHALLOWS_WATER } }] }],
    } as const;
    const foot = {
      key: 'foot',
      washes: [{
        key: 'foot-wash',
        applications: [
          { key: 'charge', kind: 'stroke', subpaths: [FOOT], brush: GATE_ROUND, diameterPx: 10, seed: 'foot', charge: { kind: 'paint', mix: EARTH, water: FOOT_WATER } },
          { key: 'glaze', on: 'dry', kind: 'stroke', subpaths: [FOOT], brush: GATE_ROUND, diameterPx: 14, seed: 'glaze', charge: { kind: 'paint', mix: { ...EARTH, strength: 0.5 }, water: 0.4 } },
        ],
      }],
    } as const;
    return {
      widthPx: WET_CONTACT.width, heightPx: WET_CONTACT.height, paper: SHEET_PAPER, medium: 'watercolour',
      layers: heron ? [shallows, { key: 'heron', children: [foot] }] : [shallows],
    };
  },
};

/** The heron's second pose, a similarity that only moves it, document px: still across the shallows' edge. */
export const STAMP_GATE_HERON_POSE = { ma: 1, mb: 0, kx: 24, ky: -6 } as const;
/** A pose lifting the heron's foot clear of the shallows, onto paper nothing wetted. */
export const STAMP_GATE_HERON_AWAY = { ma: 1, mb: 0, kx: 0, ky: -70 } as const;

/** The wet-contact sheet's program with its heron posed by `pose`, as the shot poses a group (painting-pose.ts). */
export function stampGateHeronPosed(pose: typeof STAMP_GATE_HERON_POSE | typeof STAMP_GATE_HERON_AWAY): StampSheetProgram {
  const heron = painting(STAMP_GATE_WET_CONTACT).tree.nodes.findIndex(({ node }) => node.key === 'heron');
  return paintingSheetPosed(stampGateSheetProgram(STAMP_GATE_WET_CONTACT), new Map([[heron, pose]]));
}
/** Where the foot's charge touches at rest, document px; and a stretch of the shallows far from it. */
export const STAMP_GATE_FOOT_BOX = { x: 64, y: 74, w: 34, h: 24 } as const;
export const STAMP_GATE_FAR_SHALLOWS = { x: 0, y: 92, w: 32, h: 28 } as const;

/**
 * The wet-contact entries' times by the closed forms: the shallows and the foot's charge at once, the glaze once all
 * under it has set, the charge's wetter water last.
 */
export function stampGateWetContactTimes(): number[] {
  return [0, 0, stampSheetGrid(0, DRYING.openTime + Math.max(SHALLOWS_WATER, FOOT_WATER) / DRYING.rate)];
}

/** The program solved baseline `id` draws. */
export const stampGateSolvedProgram = (id: StampGateSolvedId) => (id === 'solved/forward' ? stampGateSheetProgram(STAMP_GATE_FORWARD) : stampGateSheetProgram(STAMP_GATE_WET_CONTACT));

/** What solved baseline `id` is drawn from, as text: its program and the images it loads. */
export const stampGateSolvedInputs = (id: StampGateSolvedId) => stampCanonicalJson({ program: stampGateSolvedProgram(id), images: STAMP_GATE_SHEET_IMAGES });

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
    const flood = (w: number) => ({ key: `flood${w}`, kind: 'fill', area: { region: rectangle(8, 8, 56, 56) }, brush: GATE_ROUND, diameterPx: 16, seed: `flood${w}`, charge: { kind: 'paint', mix: POOL, water: REBASE_LEVEL } } as const);
    const late = { key: 'late', on: 'damp', kind: 'stamps', placements: [{ x: 32, y: 32 }], brush: GATE_ROUND, diameterPx: 12, seed: 'late', charge: { kind: 'paint', mix: EARTH, water: 0.2 } } as const;
    return {
      widthPx: 64, heightPx: 64, paper: REBASE_PAPER, medium: 'watercolour',
      layers: [{ key: 'stack', washes: Array.from({ length: REBASE_WASHES }, (_, w) => ({ key: `wash${w}`, applications: w === REBASE_WASHES - 1 ? [flood(w), late] : [flood(w)] })) }],
    };
  },
};

/** The rebase document's times in f64: each wash once the last has set, the damp application once its flood turns matte. */
export function stampGateRebaseTimes(): number[] {
  const { rate, damp, openTime } = stampDrying(PAINT_MEDIA.watercolour.wetting, REBASE_PAPER);
  const floods = Array.from({ length: REBASE_WASHES }).reduce<number[]>((times) => [...times, times.length ? stampSheetGrid(times.at(-1)!, times.at(-1)! + openTime + REBASE_LEVEL / rate) : 0], []);
  return [...floods, stampSheetGrid(floods.at(-1)!, floods.at(-1)! + (REBASE_LEVEL - damp) / rate)];
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

/** A film as a solve kept it: the stage texels it covers (null for none) and its texels there. */
export type StampGateFilm = { box: StampPixelBox | null; layer: StampGateLayer | null };

/** A film's channel `c` of layer `l` at stage texel (x, y): 0 outside its box. */
function stampGateFilmValue({ box, layer }: StampGateFilm, x: number, y: number, l: number, c: number): number {
  if (!box || !layer || x < box.x || y < box.y || x >= box.x + box.w || y >= box.y + box.h) return 0;
  return layer.values[((l * box.h + (y - box.y)) * box.w + (x - box.x)) * 4 + c];
}

/** The largest difference between two films' texels over stage texels `within` (where neither holds paint reads 0). */
export function stampGateFilmDifference(a: StampGateFilm, b: StampGateFilm, within: StampPixelBox): number {
  const layers = Math.max(a.layer?.layers ?? 0, b.layer?.layers ?? 0);
  let most = 0;
  for (let y = within.y; y < within.y + within.h; y++) {
    for (let x = within.x; x < within.x + within.w; x++) {
      for (let l = 0; l < layers; l++) for (let c = 0; c < 4; c++) most = Math.max(most, Math.abs(stampGateFilmValue(a, x, y, l, c) - stampGateFilmValue(b, x, y, l, c)));
    }
  }
  return most;
}

/** The centre of `slot`'s pigment in `film`, stage texels; null for a film holding none. */
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
