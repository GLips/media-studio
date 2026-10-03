// stamp-gate-clocks.ts: the gate's clocked sheets (ENGINE 9, test 4): one wash on a sheet drying at a scale, at
// `instant` and at `never`; a later wash at a `'set'` origin with its prewet; two layers' clocked washes interleaving;
// a fixed `at` refused, and one landing on an empty core; a clocked crayon drawing beside a clocked wash; and the
// forward sheet, unclocked, at a scale. Each is held to its closed form on the 1 ms grid, its scene seconds
// S + (τ − τc) × scale, every brush the gate's round.

import type { PaintingDocument } from '#lib/paint/document/models/painting-document.ts';
import type { PropertySchema, PropertyValues } from '#lib/paint/document/models/painting-properties.ts';
import type { PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { stampSheetGrid, stampSheetSeconds, type StampSheetDecision, type StampSheetMoment } from '#lib/paint/painting/models/stamp-sheet-schedule.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import {
  checkStampGateTimes, STAMP_GATE_EARTH_MIX, STAMP_GATE_FLOOD_WATER, STAMP_GATE_FORWARD, STAMP_GATE_POOL_MIX, STAMP_GATE_ROUND_REF, STAMP_GATE_SHEET_DRYING,
  STAMP_GATE_SHEET_PAPER, stampGateLine, stampGateRectangle,
} from './stamp-gate-sheets.ts';

const CLOCKS = { width: 160, height: 120 } as const;
/** The drying scale of every clocked gate sheet on a scale. */
export const STAMP_GATE_CLOCK_SCALE = 0.025;
const { openTime, damp, rate } = STAMP_GATE_SHEET_DRYING;
const brush = STAMP_GATE_ROUND_REF;

/** A fill flooding `[x0, y0, x1, y1]` with `mix` at `water`. */
const flood = (key: string, [x0, y0, x1, y1]: readonly [number, number, number, number], water: number, mix: typeof STAMP_GATE_POOL_MIX | typeof STAMP_GATE_EARTH_MIX = STAMP_GATE_POOL_MIX) =>
  ({ key, kind: 'fill', area: { region: stampGateRectangle(x0, y0, x1, y1) }, brush, diameterPx: 24, seed: key, charge: { kind: 'paint', mix, water } } as const);
/** A stroke through `xy` in the earth mix at `water`. */
const stroke = (key: string, xy: readonly number[], diameterPx: number, water: number) =>
  ({ key, kind: 'stroke', subpaths: [stampGateLine(...xy)], brush, diameterPx, seed: key, charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water } } as const);
/** A line through `xy` in the earth mix, laid dry. */
const drawn = (key: string, xy: readonly number[]) =>
  ({ key, kind: 'stroke', subpaths: [stampGateLine(...xy)], brush, diameterPx: 4, seed: key, charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX } } as const);

const GROUND_WATER = 0.6;
const POOL_ORIGIN = 2;
const DOT_AT = 9;

const clockedProperties = {
  drying: { type: 'enum', values: ['scale', 'instant', 'never'], default: 'scale' },
  rules: { type: 'boolean', default: true },
} as const satisfies PropertySchema;

/**
 * An unclocked ground flood, scrubbed `on: 'dry'` (left out under `never`, where nothing sets); then a pool clocked
 * from 2 s: its flood, a charge `on: 'wet'`, a bloom `on: 'damp'` (without `rules`, the charge plain and no bloom),
 * and a dot fixed at 9 s. The sheet dries at the gate's scale, `instant` or `never` as `drying` says.
 */
export const STAMP_GATE_CLOCKED: PaintingSourceModule<typeof clockedProperties> = {
  properties: clockedProperties,
  default: function gateClocked({ drying, rules }: PropertyValues<typeof clockedProperties>): PaintingDocument {
    const scrub = { ...drawn('ground-scrub', [32, 24, 32, 96]), diameterPx: 10, on: 'dry', charge: { kind: 'lift', strength: 0.6 } } as const;
    const bloom = { key: 'pool-bloom', on: 'damp', effect: 'bloom', kind: 'stamps', placements: [{ x: 128, y: 60 }], brush, diameterPx: 20, seed: 'pool-bloom', charge: { kind: 'water', water: 0.95 } } as const;
    const dot = { key: 'pool-dot', at: DOT_AT, kind: 'stamps', placements: [{ x: 112, y: 88 }], brush, diameterPx: 12, seed: 'pool-dot', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.5 } } as const;
    return {
      widthPx: CLOCKS.width, heightPx: CLOCKS.height, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour', dryingScale: drying === 'scale' ? STAMP_GATE_CLOCK_SCALE : drying,
      layers: [
        { key: 'ground', washes: [{ key: 'under', applications: [flood('ground-flood', [8, 8, 56, 112], GROUND_WATER, STAMP_GATE_EARTH_MIX), ...(drying === 'never' ? [] : [scrub])] }] },
        {
          key: 'pond',
          washes: [{
            key: 'pool', clock: { origin: POOL_ORIGIN },
            applications: [
              flood('pool-flood', [72, 16, 152, 104], STAMP_GATE_FLOOD_WATER),
              { ...stroke('pool-charge', [88, 32, 96, 56, 90, 80], 10, 0.6), ...(rules && { on: 'wet' as const }) },
              ...(rules ? [bloom] : []),
              dot,
            ],
          }],
        },
      ],
    };
  },
};

/**
 * The clocked sheet's moments on the scale: the ground at once and its scrub once it sets, which is τc; the pool's
 * flood and charge at τc, scene 2 s; the bloom once the pool turns matte; the dot at 9 s.
 */
export function stampGateClockedMoments(): StampSheetMoment[] {
  const tc = stampSheetGrid(0, openTime + GROUND_WATER / rate), matte = stampSheetGrid(tc, tc + (STAMP_GATE_FLOOD_WATER - damp) / rate);
  return [
    { tau: 0, scene: null }, { tau: tc, scene: null }, { tau: tc, scene: POOL_ORIGIN }, { tau: tc, scene: POOL_ORIGIN },
    { tau: matte, scene: POOL_ORIGIN + (matte - tc) * STAMP_GATE_CLOCK_SCALE }, { tau: tc + (DOT_AT - POOL_ORIGIN) / STAMP_GATE_CLOCK_SCALE, scene: DOT_AT },
  ];
}

/** How the clocked sheet's charge is refused under `instant`, and its bloom under `never`, but for the model second and boxes. */
export const STAMP_GATE_INSTANT_REFUSAL = {
  starts: "pool-charge: unreachable from this committed prefix: on 'wet' held over at most 0% of its core (needs 95%), at model ",
  ends: '; settled before it (`instant`). Unscheduled after it: pool-bloom, pool-dot',
} as const;
export const STAMP_GATE_NEVER_REFUSAL = {
  starts: "pool-bloom: unreachable from this committed prefix: on 'damp' held over at most 0% of its core (needs 95%), at model 0 s [",
  ends: '; nothing dries (`never`). Unscheduled after it: pool-dot',
} as const;

/** One layer's two washes clocked from 0 s: a flood, then, at `'set'`, a prewet a charge `on: 'wet'` reads. */
export const STAMP_GATE_SET_ORIGIN: PaintingSourceModule = {
  default: function gateSetOrigin(): PaintingDocument {
    return {
      widthPx: CLOCKS.width, heightPx: CLOCKS.height, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour', dryingScale: STAMP_GATE_CLOCK_SCALE,
      layers: [{
        key: 'lake',
        washes: [
          { key: 'first', clock: { origin: 0 }, applications: [flood('first-flood', [8, 8, 104, 80], GROUND_WATER)] },
          { key: 'second', clock: { origin: 'set' }, prewet: { region: stampGateRectangle(56, 40, 152, 112), water: 0.9 }, applications: [{ ...stroke('second-charge', [72, 64, 104, 92, 136, 72], 10, 0.6), on: 'wet' }] },
        ],
      }],
    };
  },
};

const RIPPLE_ORIGIN = 6;
const interleaveProperties = { reeds: { type: 'boolean', default: true } } as const satisfies PropertySchema;

/**
 * `water`: a basin flooded from 0 s, and ripples clipped to it from 6 s, the second at 8 s; and, `reeds`, a direct
 * wash in front clocked from 1 s, its lines at 7 s, between the ripples, and 8 s, tying the second.
 */
export const STAMP_GATE_INTERLEAVE: PaintingSourceModule<typeof interleaveProperties> = {
  properties: interleaveProperties,
  default: function gateInterleave({ reeds }: PropertyValues<typeof interleaveProperties>): PaintingDocument {
    const water = {
      key: 'water',
      washes: [
        { key: 'basin', clock: { origin: 0 }, applications: [flood('basin-flood', [16, 24, 144, 104], STAMP_GATE_FLOOD_WATER)] },
        { key: 'ripple', clock: { origin: RIPPLE_ORIGIN }, clipTo: 'basin', applications: [stroke('ripple-a', [4, 48, 156, 56], 8, 0.5), { ...stroke('ripple-b', [4, 84, 156, 72], 8, 0.5), at: 8 }] },
      ],
    } as const;
    const lines = {
      key: 'reeds',
      washes: [{
        key: 'reed-lines', wetHistory: false, clock: { origin: 1 },
        applications: [drawn('reed-a', [40, 4, 44, 116]), { ...drawn('reed-b', [80, 4, 84, 116]), at: 7 }, { ...drawn('reed-c', [120, 4, 116, 116]), at: 8 }],
      }],
    } as const;
    return { widthPx: CLOCKS.width, heightPx: CLOCKS.height, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour', dryingScale: STAMP_GATE_CLOCK_SCALE, layers: reeds ? [water, lines] : [water] };
  },
};

/** The interleaved sheet's entries by their order times, a tie in document order, and their moments. */
export const STAMP_GATE_INTERLEAVED = [
  { name: 'basin-flood', scene: 0 }, { name: 'reed-a', scene: 1 }, { name: 'ripple-a', scene: RIPPLE_ORIGIN }, { name: 'reed-b', scene: 7 }, { name: 'ripple-b', scene: 8 },
  { name: 'reed-c', scene: 8 },
].map(({ name, scene }) => ({ name, tau: scene / STAMP_GATE_CLOCK_SCALE, scene }));

const LATE_AT = 1;

/** A flood clocked from 0 s, softened `on: 'damp'`, then an application fixed at 1 s, before the softening could land. */
export const STAMP_GATE_FIXED_TOO_EARLY: PaintingSourceModule = {
  default: function gateFixedTooEarly(): PaintingDocument {
    return {
      widthPx: CLOCKS.width, heightPx: CLOCKS.height, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour', dryingScale: STAMP_GATE_CLOCK_SCALE,
      layers: [{
        key: 'field',
        washes: [{
          key: 'soft', clock: { origin: 0 },
          applications: [flood('soft-flood', [16, 16, 144, 104], STAMP_GATE_FLOOD_WATER), { ...stroke('soften', [40, 60, 120, 60], 12, 0.5), on: 'damp' }, { ...stroke('late', [40, 80, 120, 80], 8, 0.5), at: LATE_AT }],
        }],
      }],
    };
  },
};

/** What the fixed `at` before its predecessor fails with, to the letter: the softening lands once the flood turns matte. */
export const stampGateFixedTooEarlyMessage = () =>
  `late: fixed at ${stampSheetSeconds(LATE_AT)} precedes its predecessor at ${stampSheetSeconds(stampSheetGrid(0, (STAMP_GATE_FLOOD_WATER - damp) / rate) * STAMP_GATE_CLOCK_SCALE)}`;

const STRAY_AT = 2;

/** A flood clocked from 0 s, and a stamp `on: 'wet'` fixed at 2 s wholly off the paper. */
export const STAMP_GATE_STRAY: PaintingSourceModule = {
  default: function gateStray(): PaintingDocument {
    const stray = { key: 'stray', on: 'wet', at: STRAY_AT, kind: 'stamps', placements: [{ x: -200, y: -200 }], brush, diameterPx: 12, seed: 'stray', charge: { kind: 'paint', mix: STAMP_GATE_EARTH_MIX, water: 0.5 } } as const;
    return {
      widthPx: CLOCKS.width, heightPx: CLOCKS.height, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour', dryingScale: STAMP_GATE_CLOCK_SCALE,
      layers: [{ key: 'mist', washes: [{ key: 'haze', clock: { origin: 0 }, applications: [flood('haze-flood', [16, 16, 144, 104], STAMP_GATE_FLOOD_WATER), stray] }] }],
    };
  },
};

/** The stray stamp's moment: at its `at`, as nothing of it can wait. */
export const STAMP_GATE_STRAY_MOMENT = { tau: STRAY_AT / STAMP_GATE_CLOCK_SCALE, scene: STRAY_AT } as const;

const GLAZE_AT = 7;
const drawingProperties = { drawing: { type: 'boolean', default: true } } as const satisfies PropertySchema;

/**
 * A pond clocked from 0 s, glazed `on: 'dry'` at 7 s; and, `drawing`, crayon lines in front clocked from 1 s, one a
 * second, across it.
 */
export const STAMP_GATE_DRAWING: PaintingSourceModule<typeof drawingProperties> = {
  properties: drawingProperties,
  default: function gateDrawing({ drawing }: PropertyValues<typeof drawingProperties>): PaintingDocument {
    const pond = {
      key: 'pond',
      washes: [{ key: 'pond-wash', clock: { origin: 0 }, applications: [flood('pond-flood', [16, 16, 144, 104], STAMP_GATE_FLOOD_WATER), { ...stroke('pond-glaze', [32, 92, 128, 92], 12, 0.4), on: 'dry', at: GLAZE_AT }] }],
    } as const;
    const ink = {
      key: 'ink', medium: 'crayon',
      washes: [{
        key: 'lines', wetHistory: false, clock: { origin: 1 },
        applications: [drawn('line-1', [8, 24, 152, 40]), { ...drawn('line-2', [8, 56, 152, 64]), at: 2 }, { ...drawn('line-3', [8, 100, 152, 80]), at: 3 }],
      }],
    } as const;
    return { widthPx: CLOCKS.width, heightPx: CLOCKS.height, paper: STAMP_GATE_SHEET_PAPER, medium: 'watercolour', dryingScale: STAMP_GATE_CLOCK_SCALE, layers: drawing ? [pond, ink] : [pond] };
  },
};

/** The drawing sheet's moments with its lines, and the pond's alone. */
export const STAMP_GATE_DRAWN = [0, 1, 2, 3, GLAZE_AT].map((scene) => ({ tau: scene / STAMP_GATE_CLOCK_SCALE, scene }));
export const STAMP_GATE_POND_ALONE = [0, GLAZE_AT].map((scene) => ({ tau: scene / STAMP_GATE_CLOCK_SCALE, scene }));
/** Scene seconds the drawing sheet is shown at, one between each landing and the next, and how many entries each shows. */
export const STAMP_GATE_DRAWING_PLAYBACK = [{ at: 0.5, through: 1 }, { at: 1.5, through: 2 }, { at: 2.5, through: 3 }, { at: 3.5, through: 4 }, { at: 7.5, through: 5 }] as const;
/** The `'set'` sheet shown before its second wash starts, and after. */
export const STAMP_GATE_SET_PLAYBACK = [{ at: 1, through: 1 }, { at: 5, through: 2 }] as const;

/** The forward sheet at the gate's scale, with no clocked wash: its times model seconds whatever the scale. */
export const STAMP_GATE_FORWARD_SCALED: PaintingSourceModule = {
  default: function gateForwardScaled(): PaintingDocument {
    return { ...STAMP_GATE_FORWARD.default({ appended: false }), dryingScale: STAMP_GATE_CLOCK_SCALE };
  },
};

const sameScene = (a: number | null, b: number | null | undefined) => (a === null || b === null || b === undefined ? a === b : Math.abs(a - b) <= 1e-9);

/** Whether each decision lands at its moment, model second and scene second, and none was warned near rounding. */
export function checkStampGateMoments(id: string, decisions: readonly StampSheetDecision[], moments: readonly StampSheetMoment[], names: readonly string[]): StampGateWashCheck {
  const times = checkStampGateTimes(id, decisions, moments.map(({ tau }) => tau), names);
  const off = decisions.flatMap(({ scene }, k) => (sameScene(scene, moments[k]?.scene) ? [] : [`${names[k]} at scene ${scene ?? '–'}, not ${moments[k]?.scene ?? '–'}`]));
  const scenes = decisions.map(({ scene }) => (scene === null ? '–' : stampSheetSeconds(scene))).join(', ');
  return { id, passed: times.passed && !off.length, detail: `${times.detail}; scenes ${scenes}${off.length ? `; ${off.join('; ')}` : ''}` };
}
