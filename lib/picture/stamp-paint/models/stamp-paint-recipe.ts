// stamp-paint-recipe.ts: what a stamp painting is, apart from how it's rendered or where its brushes came from.
//
// A recipe is ordered groups of ordered passes of deposits under the masking fluid declared before each; in a wash,
// a deposit may wet or lift, and the wash may wait to dry. Every stamp is placed once; a frame at `t` only chooses how
// much of each deposit shows. Scene time says when a deposit shows; painting time, advanced by a wash's waits, how
// wet the paper was as it landed (stamp-wetness.ts).
//
// Randomness comes from IDs, never order: each deposit is seeded by its ID, so adding a stroke changes no other.

import type { PaintMixture } from '#lib/picture/paint/models/paint-mixture.ts';
import type { StampBlend, StampBrush, StampBrushAsset } from './stamp-brush.ts';
import type { PlacedStamp, StampPlacement, StampStrokePoint, StampTint } from './stamp-placement.ts';
import type { StampStrokeHand } from './stamp-stroke-hand.ts';
import { checkedStampPolygon, compileDeposit } from './stamp-deposit-compile.ts';
import type { StampFillApplication, StampFloodBody, StampFloodBodyLevels, StampFloodFront } from './stamp-fill.ts';
import { stampPaintFieldEnds, stampPaintFieldProblem, stampSeededPaintField, type StampPaintField, type StampSeededPaintField } from './stamp-paint-field.ts';
import {
  compilePaintAction, compileWashAction, type CompiledStampAction, type CompiledStampPaintAction, type StampRecipePaint, type StampRecipeWashAction,
} from './stamp-paint-action.ts';
import type { StampPoint, StampRegion } from './stamp-region.ts';
import { compileStampArea, stampFluidHolder, stampStandsBeforeExclusions, type CompiledStampArea, type StampArea, type StampStandsBefore } from './stamp-area.ts';
import { checkStampGroupMotion, type StampGroupBoil, type StampGroupMotion, type StampGroupPaper } from './stamp-group-motion.ts';
import { stampMaterialKeysSpan, type CompiledStampMaterialKeys, type StampMaterialKeys } from './stamp-material-keys.ts';

export type StampPaintColor = `#${string}`;

/**
 * What a painting is laid on: a style's paper with each image named in full, as a painting is laid on it.
 * `absorbency`, 0..1 (0.5 when left out), is how fast it drinks a wash's water: a soft, unsized paper dries a wash
 * sooner than a hard-sized one (stamp-wetness.ts).
 */
export type StampPaintPaper = {
  color: StampPaintColor;
  image?: StampBrushAsset;
  grain?: { image: StampBrushAsset; scale: number; depth: number };
  absorbency?: number;
};

/**
 * What a deposit is made of. A `color` is flat colour, laid by its blend as Photoshop lays it; in a style that paints
 * in pigment it's fitted as a pigment of its own. A `mixture` is pigments in proportion at a strength
 * (paint-mixture.ts), which only a style that paints in pigment can lay.
 */
export type PaintMaterial = { kind: 'color'; color: StampPaintColor } | ({ kind: 'mixture' } & PaintMixture);

/** A material that may change over the scene: one throughout, or keyed over scene time (stamp-material-keys.ts); compiled, its keys checked. */
export type StampKeyedMaterial = PaintMaterial | StampMaterialKeys<PaintMaterial>;
export type CompiledStampKeyedMaterial = PaintMaterial | CompiledStampMaterialKeys<PaintMaterial>;

/**
 * A material across the painting: one throughout, or graded between two (stamp-paint-field.ts), as a graded wash
 * runs from a sky's ultramarine to its horizon's rose. Only a style that paints in pigment grades one, by amounts of
 * pigment, never by rendered colour. Each may be keyed over scene time; a graded one's ends are keyed apart.
 */
export type StampPaintMaterial = StampKeyedMaterial | StampPaintField<StampKeyedMaterial>;

/** What every deposit has: its brush, its stamp's diameter at full size in the painting's pixels, and when it shows. */
type StampToolSettings = {
  brush: StampBrush;
  diameter: number;
  /** The most this deposit can build to, 0..1, however its stamps overlap. */
  opacity?: number;
} & StampDepositReveal;

type StampPaintSettings = StampToolSettings & {
  material: StampPaintMaterial;
  /** Left out, the brush's own blend. */
  blend?: StampBlend;
  /** The colour a brush whose colour follows pressure moves toward (StampBrushColorDynamics); a colour material's own if left out. */
  secondaryColor?: StampPaintColor;
  /** Pressed beyond drawing, as a crayon burnishes: a dry medium's wax reaches every valley. Only a dry medium can. */
  burnish?: boolean;
};

/**
 * When a deposit shows. `appliedAt`: seconds into the scene when it starts to appear; left out, it's there from the
 * start. `drawnOver`: seconds it takes to draw from `appliedAt` (so only with one), showing a growing share of a
 * stroke's length or of its placements, or a front crossing a fill; left out, it lands whole.
 */
type StampDepositReveal = { appliedAt?: undefined; drawnOver?: undefined } | { appliedAt: number; drawnOver?: number };

export type StampStrokeGeometry = {
  path: readonly StampStrokePoint[];
  /**
   * How a hand paints the path: a pressure profile, pressure and speed from its turns, and wobble (stamp-stroke-hand.ts),
   * composed with any pressure its points carry, and seeded by the deposit's ID. Left out, the points' pressure is all
   * there is and the stroke reveals at an even pace.
   */
  hand?: StampStrokeHand;
};
export type StampPlacementGeometry = { at: readonly StampPlacement[] };
/**
 * Over `region`, reaching its edges (stamp-fill.ts). `application`: a flood or strokes, by default as its brush's media
 * lays it. `direction`: radians its rows run along (0: left to right); a drawn fill reveals across them. `load`: how
 * much it lays, 0..1, across the region (1 when left out): a flood's coverage, each stroke stamp's opacity.
 */
export type StampFillGeometry = { region: StampRegion; application?: StampFillApplication; direction?: number; load?: StampPaintField<number> };
/** Where a deposit goes: along a stroke, at placements, or over a region. */
export type StampDepositGeometry = ({ kind: 'stroke' } & StampStrokeGeometry) | ({ kind: 'stamps' } & StampPlacementGeometry) | ({ kind: 'fill' } & StampFillGeometry);

export type StampStrokeSettings = StampPaintSettings & StampStrokeGeometry;
export type StampPlacementSettings = StampPaintSettings & StampPlacementGeometry;
export type StampFillSettings = StampPaintSettings & StampFillGeometry;

/** How much water a brush in a wash carries, 0..1: left out, its medium's (PaintWetting's brushWater). */
export type StampWashWater = { water?: number; burnish?: never };
/** Clean water from a brush carrying `water` (0..1, 1 when left out): it wets the paper, and moves wet paint it meets. */
export type StampWaterSettings = StampToolSettings & StampDepositGeometry & { water?: number };
/**
 * A thirsty brush or tissue lifting up to `strength` (0..1, 1 when left out) of the paint under it: all it can of wet
 * paint, less as the paint sets, and never a pigment's stain.
 */
export type StampLiftSettings = StampToolSettings & StampDepositGeometry & { strength?: number };
/** A damp brush drawn along an edge to soften it: a water stroke carrying `water` (STAMP_SOFTEN_WATER when left out). */
export type StampSoftenSettings = StampToolSettings & StampStrokeGeometry & { water?: number };
/**
 * Water dropped into a drying wash, a bloom: the wash waits until the paper under the drop is damp (StampBloomWait),
 * then these placements land, `water` (1 when left out) each.
 */
export type StampBloomSettings = StampToolSettings & StampPlacementGeometry & { water?: number };
/** A wash waiting in painting time: until its wettest paper is `damp` (PaintWetting's damp) or `dry`, or for `seconds`. */
export type StampWashWait = 'damp' | 'dry' | { seconds: number };
/**
 * A wait('dry')'s drying: `rim`, how strongly its rim gathers pigment (StampWashOptions' `rim`), its wash's when left
 * out. Only a wait for dry takes one: no other wait rims.
 */
export type StampWashWaitOptions = { rim?: number };

/** How much water a softening stroke carries unless it says: a damp brush, which moves an edge without flooding it. */
export const STAMP_SOFTEN_WATER = 0.3;

/**
 * Masking fluid over an area (StampArea): no deposit declared after it in its scope lands under it, until an unmask
 * lifts it. Paint already there stays.
 */
export type StampMaskSettings = StampArea;
/**
 * Lifts `amount` (0..1, 1 when left out) of the fluid within an area, or everywhere without one, for deposits
 * declared after it in its scope.
 */
export type StampUnmaskSettings = { amount?: number } & (StampArea | { region?: undefined; edge?: undefined; inset?: undefined });

/**
 * `opaque` covers what it's painted over, as body colour does; `glaze` lays over it at `opacity`, letting it show
 * through. `depth` orders groups far (higher) to near, and `order` overrides depth: a group with a higher order paints
 * after every group with a lower one, whatever their depths. Both default to 0, and ties keep the order written.
 */
export type StampGroupOptions = ({ composite: 'opaque' } | { composite: 'glaze'; opacity: number }) & {
  depth?: number;
  order?: number;
  /** The painting's (`ground`, when left out) or its own, a collage's (StampGroupPaper). */
  paper?: StampGroupPaper;
  motion?: StampGroupMotion;
  boil?: StampGroupBoil;
  /** Groups painted earlier that this one's `shape` is reserved from, as a near hill from the far range (StampStandsBefore). */
  standsBefore?: StampStandsBefore;
};

/**
 * A `clipped` pass lands only where the nearest unclipped pass before it in its group holds paint, as a Procreate
 * clipping mask clips to the layer under it: texture inside a silhouette. A pass `within` an area lands only inside
 * it (StampArea), a reflection kept to its water; a ragged edge there is seeded by the pass's ID.
 */
export type StampPassOptions = { clipped?: boolean; within?: StampArea };

/**
 * A wash: a pass painted wet, whose deposits land as wet paint does (stamp-wetness.ts). With a `preparation`, its
 * `region` is wetted with clean water first (`wetness`, 0..1, 1 when left out), for painting wet-in-wet; without, it's
 * painted onto dry paper, wet only where its own brushes wet it.
 */
export type StampWashOptions = StampPassOptions & {
  preparation?: { region: StampRegion; wetness?: StampPaintField<number> };
  /** 0..2, 1 the medium's: how strongly each drying rims, its end's too, unless its wait('dry') says. */
  rim?: number;
};

/**
 * Masks and unmasks, in any scope. Each changes the fluid for what's declared after it in its scope and the scopes
 * inside it; leaving a scope puts back the fluid it began with, so an element's reserve never leaks into the next.
 * Their IDs name them within their scope as a deposit's do, and seed a ragged edge.
 */
type StampMasking = { mask: (id: string, settings: StampMaskSettings) => void; unmask: (id: string, settings: StampUnmaskSettings) => void };

export type StampPaintScope = StampMasking & { group: (id: string, options: StampGroupOptions, body: (group: StampGroupScope) => void) => void };
export type StampGroupScope = StampMasking & {
  /**
   * What the group takes out of everything painted before it, declared first and once: its masking fluid crossed by
   * its water is a reserve (paper the paint behind never reached: crisp, white), its lifts take that paint up by the
   * lift law (soft, leaving the stain of the pigments there). It moves with the group; the group paints over it.
   */
  knockout: (id: string, options: StampKnockoutOptions, body: (knockout: StampKnockoutScope) => void) => void;
  pass: (id: string, options: StampPassOptions, body: (pass: StampPassScope) => void) => void;
  wash: (id: string, options: StampWashOptions, body: (wash: StampWashScope) => void) => void;
};
/** A knockout's water, wetting the paint behind the group as a wash's `preparation` wets its paper, for a lift. */
export type StampKnockoutOptions = Pick<StampWashOptions, 'preparation'>;
/**
 * A knockout's scope: the paint behind the group, as wet as its water leaves it. Its fluid is its own, gone when it
 * ends, so the group's paint isn't held off by it.
 */
export type StampKnockoutScope = StampMasking & Pick<StampWashScope, 'water' | 'lift' | 'wait'>;
export type StampPassScope = StampMasking & {
  stroke: (id: string, settings: StampStrokeSettings) => void;
  stamps: (id: string, settings: StampPlacementSettings) => void;
  fill: (id: string, settings: StampFillSettings) => void;
};
/** A wash's scope: its paint carries water; it can wet, lift, soften, bloom, and wait for itself to dry. */
export type StampWashScope = StampMasking & {
  stroke: (id: string, settings: StampStrokeSettings & StampWashWater) => void;
  stamps: (id: string, settings: StampPlacementSettings & StampWashWater) => void;
  fill: (id: string, settings: StampFillSettings & StampWashWater) => void;
  water: (id: string, settings: StampWaterSettings) => void;
  lift: (id: string, settings: StampLiftSettings) => void;
  soften: (id: string, settings: StampSoftenSettings) => void;
  bloom: (id: string, settings: StampBloomSettings) => void;
  wait: (until: StampWashWait, options?: StampWashWaitOptions) => void;
};

/** The fluid as it stands: the latest op, over the fluid before it; null when there's none. */
type StampPaintRecipeMask = {
  /** Its scope's IDs, then its own. */
  path: readonly string[];
  op: ({ kind: 'mask' } & StampMaskSettings) | ({ kind: 'unmask' } & StampUnmaskSettings);
  under: StampPaintRecipeMask | null;
} | null;
/** A deposit as written: compileDeposit checks it and places its stamps. */
export type StampPaintRecipeDeposit<A extends StampRecipeWashAction = StampRecipeWashAction> = {
  kind: 'deposit';
  id: string;
  geometry: StampDepositGeometry;
  // Loosened from StampToolSettings, whose reveal union a rest spread can't keep; its settings were checked as written.
  tool: { brush: StampBrush; diameter: number; opacity?: number; appliedAt?: number; drawnOver?: number };
  action: A;
  mask: StampPaintRecipeMask;
};
/**
 * A bloom's wait: until the paper under the drop that follows it is damp, not the whole wash, so paint laid elsewhere
 * in the meantime doesn't hold the drop back until the paper under it has set.
 */
export type StampBloomWait = { kind: 'wait'; until: 'damp'; under: 'drop' };
/** A wash's wait as written and compiled: a wait('dry') may carry its drying's `rim`. */
export type StampWashWaitStep = { kind: 'wait'; until: StampWashWait; rim?: number };
type StampPaintRecipeStep = StampPaintRecipeDeposit | StampWashWaitStep | StampBloomWait;
type StampPaintRecipePass = { id: string; clipped: boolean; within?: StampArea } & (
  | { wash: null; steps: readonly StampPaintRecipeDeposit<StampRecipePaint>[] }
  | { wash: { preparation?: StampWashOptions['preparation']; rim?: number; knockout: boolean }; steps: readonly StampPaintRecipeStep[] }
);
type StampPaintRecipeGroup = { id: string; options: StampGroupOptions; passes: readonly StampPaintRecipePass[] };

/** A recipe as written, IDs unchecked: `compileStampPaintRecipe` checks it. */
export type StampPaintRecipe = { groups: readonly StampPaintRecipeGroup[]; masks: readonly NonNullable<StampPaintRecipeMask>[] };

/** Splits a deposit's settings into where it goes and the rest. */
function splitGeometry<S extends StampToolSettings>(kind: StampDepositGeometry['kind'], settings: S & Partial<StampStrokeGeometry & StampPlacementGeometry & StampFillGeometry>) {
  const { path, hand, at, region, application, direction, load, ...rest } = settings;
  const geometries: Record<StampDepositGeometry['kind'], () => StampDepositGeometry> = {
    stroke: () => ({ kind: 'stroke', path: path!, ...(hand && { hand }) }),
    stamps: () => ({ kind: 'stamps', at: at! }),
    fill: () => ({ kind: 'fill', region: region!, ...(application && { application }), ...(direction !== undefined && { direction }), ...(load && { load }) }),
  };
  return { geometry: geometries[kind](), rest };
}

/** Writes a recipe by calling `body`, which declares groups, their passes and the passes' deposits in painting order. */
export function stampPaintRecipe(body: (paint: StampPaintScope) => void): StampPaintRecipe {
  const groups: StampPaintRecipeGroup[] = [], masks: NonNullable<StampPaintRecipeMask>[] = [];
  let fluid: StampPaintRecipeMask = null;
  const masking = (scope: readonly string[]): StampMasking => {
    const push = (op: NonNullable<StampPaintRecipeMask>['op'], id: string) => {
      fluid = { path: [...scope, id], op, under: fluid };
      masks.push(fluid);
    };
    return { mask: (id, settings) => push({ kind: 'mask', ...settings }, id), unmask: (id, settings) => push({ kind: 'unmask', ...settings }, id) };
  };
  /** Runs `inner`, then puts the fluid back as it was. */
  const scoped = (inner: () => void) => {
    const outer = fluid;
    try {
      inner();
    } finally {
      fluid = outer;
    }
  };
  type PaintSettings = StampPaintSettings & { water?: number } & Partial<StampStrokeGeometry & StampPlacementGeometry & StampFillGeometry>;
  /** A paint deposit as written, and the water its brush carries in a wash (undefined: its medium's); a dry pass drops it. */
  const paintDeposit = (kind: StampDepositGeometry['kind'], id: string, settings: PaintSettings) => {
    const { geometry, rest: { material, blend, secondaryColor, burnish, water, ...tool } } = splitGeometry(kind, settings);
    const action: StampRecipePaint = { kind: 'paint', material, ...(blend && { blend }), ...(secondaryColor && { secondaryColor }), ...(burnish && { burnish }) };
    return { deposit: { kind: 'deposit' as const, id, geometry, tool, mask: fluid, action }, water };
  };
  /** A dry pass's scope writing into `steps`: paint only. */
  const dryScope = (scope: readonly string[], steps: StampPaintRecipeDeposit<StampRecipePaint>[]): StampPassScope => {
    const paint = (kind: StampDepositGeometry['kind']) => (id: string, settings: PaintSettings) => steps.push(paintDeposit(kind, id, settings).deposit);
    return { ...masking(scope), stroke: paint('stroke'), stamps: paint('stamps'), fill: paint('fill') };
  };
  /** A wash's scope writing into `steps`. */
  const washScope = (scope: readonly string[], steps: StampPaintRecipeStep[]): StampWashScope => {
    const paint = (kind: StampDepositGeometry['kind']) => (id: string, settings: PaintSettings) => {
      const { deposit, water } = paintDeposit(kind, id, settings);
      steps.push({ ...deposit, action: { ...deposit.action, ...(water !== undefined && { water }) } });
    };
    const water = (id: string, geometry: StampDepositGeometry, tool: StampPaintRecipeDeposit['tool'], amount: number) =>
      steps.push({ kind: 'deposit', id, geometry, tool, action: { kind: 'water', water: amount }, mask: fluid });
    return {
      ...masking(scope),
      stroke: paint('stroke'),
      stamps: paint('stamps'),
      fill: paint('fill'),
      water: (id, { water: amount = 1, ...settings }) => {
        const { geometry, rest } = splitGeometry(settings.kind, settings);
        water(id, geometry, withoutKind(rest), amount);
      },
      lift: (id, { strength, ...settings }) => {
        const { geometry, rest } = splitGeometry(settings.kind, settings);
        steps.push({ kind: 'deposit', id, geometry, tool: withoutKind(rest), action: { kind: 'lift', ...(strength !== undefined && { strength }) }, mask: fluid });
      },
      soften: (id, { water: amount = STAMP_SOFTEN_WATER, ...settings }) => {
        const { geometry, rest } = splitGeometry('stroke', settings);
        water(id, geometry, rest, amount);
      },
      bloom: (id, { water: amount = 1, ...settings }) => {
        steps.push({ kind: 'wait', until: 'damp', under: 'drop' });
        const { geometry, rest } = splitGeometry('stamps', settings);
        water(id, geometry, rest, amount);
      },
      wait: (until, { rim } = {}) => steps.push({ kind: 'wait', until, ...(rim !== undefined && { rim }) }),
    };
  };
  body({
    ...masking([]),
    group(id, options, groupBody) {
      const passes: StampPaintRecipePass[] = [];
      groups.push({ id, options, passes });
      scoped(() => groupBody({
        ...masking([id]),
        pass: (passId, passOptions, passBody) => {
          const steps: StampPaintRecipeDeposit<StampRecipePaint>[] = [];
          passes.push({ ...writtenPass(passId, passOptions), wash: null, steps });
          scoped(() => passBody(dryScope([id, passId], steps)));
        },
        knockout: (passId, { preparation }, knockoutBody) => {
          if (passes.length) throw new Error(`stamp paint: ${id}/${passId} is a knockout after ${id}'s ${passes.map((pass) => pass.id).join(', ')}; a group knocks out once, before it paints`);
          const steps: StampPaintRecipeStep[] = [];
          passes.push({ ...writtenPass(passId, {}), wash: { ...(preparation && { preparation }), knockout: true }, steps });
          scoped(() => {
            const { mask, unmask, water, lift, wait } = washScope([id, passId], steps);
            knockoutBody({ mask, unmask, water, lift, wait });
          });
        },
        wash: (passId, { preparation, rim, ...passOptions }, washBody) => {
          const steps: StampPaintRecipeStep[] = [];
          passes.push({ ...writtenPass(passId, passOptions), wash: { ...(preparation && { preparation }), ...(rim !== undefined && { rim }), knockout: false }, steps });
          scoped(() => washBody(washScope([id, passId], steps)));
        },
      }));
    },
  });
  return { groups, masks };
}

/** A pass's settings as written. */
const writtenPass = (passId: string, { clipped = false, within }: StampPassOptions) => ({ id: passId, clipped, ...(within && { within }) });

const withoutKind = <T extends { kind?: unknown }>(settings: T): Omit<T, 'kind'> => {
  const { kind, ...rest } = settings;
  void kind;
  return rest;
};

/**
 * The fluid a deposit lands under: its latest op over the fluid before it, null for none. Deposits under the same
 * fluid share one object, so the renderer works each out once.
 */
export type CompiledStampMask = {
  /**
   * `<scope>/<op>`, unique in the painting; or `<group>/stands-before`, a group's reserve over the fluid of each
   * deposit of the groups it stands before, last, so none of their unmasks lifts it.
   */
  id: string;
  under: CompiledStampMask | null;
} & ({ kind: 'mask'; area: CompiledStampArea } | { kind: 'unmask'; amount: number; area: CompiledStampArea | null });

/**
 * A flood's placed body and how its front crosses it (stamp-fill.ts). `tint`: what its brush's stamps average to
 * (stampExpectedTint), which the body lays as its stamps lay theirs, so where the edge stroke's stamps give out the
 * colour carries on rather than stepping back to the deposit's own.
 */
export type CompiledStampFlood = StampFloodBody & { load: StampSeededPaintField<number>; levels: StampFloodBodyLevels; tint: StampTint; front: StampFloodFront };

type CompiledStampDepositCommon<A extends CompiledStampAction> = {
  /** `<group>/<pass>/<deposit>`, unique in the painting: the seed of every stamp in it. */
  id: string;
  brush: StampBrush;
  action: A;
  /** Where the brush's grain and its dual's start, as shares of their tiles: each deposit's own, by offset jitter. */
  grainOffset: { main: readonly [number, number]; dual: readonly [number, number] };
  /** The stamp's diameter at full size, as the deposit states it: what its texturized grain and edges scale with. */
  diameter: number;
  blend: StampBlend;
  opacity: number;
  /** The fluid it lands under. */
  mask: CompiledStampMask | null;
  /** When it shows (StampDepositReveal): from `at` seconds, drawn over `over` (0 lands whole); none, there throughout. */
  reveal?: { at: number; over: number };
  /** Every stamp of the finished deposit, in reveal order: a flood's are its edge stroke's. */
  stamps: readonly PlacedStamp[];
  /** The brush's dual stamps, placed by its own settings along the same stroke, in reveal order; none without one. */
  dualStamps: readonly PlacedStamp[];
};

/**
 * A stroke's stamps overlap along its path (a fill laid in strokes is one); placed stamps each land alone; a flood is
 * a body under its edge stroke.
 */
export type CompiledStampDeposit<A extends CompiledStampAction = CompiledStampAction> = CompiledStampDepositCommon<A> & ({ kind: 'stroke' | 'stamps' } | { kind: 'flood'; flood: CompiledStampFlood });

/**
 * A wash in painting order: each deposit and each wait. `preparation` is the clean water laid over its region before
 * any of it, null for dry paper. `rim`, its dryings' unless a wait('dry') says (stampWashDryings), absent for the
 * medium's own.
 */
export type CompiledStampWash = {
  /** `held`: a standing before's reserve, which its water doesn't reach either; absent for none (StampStandsBefore). */
  preparation: { polygon: readonly StampPoint[]; wetness: StampSeededPaintField<number>; held?: CompiledStampMask } | null;
  schedule: readonly CompiledStampWashStep[];
  rim?: number;
};
export type CompiledStampWashStep = { kind: 'deposit'; deposit: CompiledStampDeposit } | StampWashWaitStep | StampBloomWait;

/** A pass painted `dry`, its deposits all paint (each lands as vid-83's paint does), or as a `wash`. */
export type CompiledStampPass = {
  /** `<group>/<pass>`. */
  id: string;
  /** The pass this one is clipped to, by ID: it lands only where that pass holds paint. Absent for an unclipped pass. */
  clipTo?: string;
  /** The area it lands within; null for none. */
  within: CompiledStampArea | null;
} & ({ kind: 'dry'; deposits: readonly CompiledStampDeposit<CompiledStampPaintAction>[] } | { kind: 'wash'; wash: CompiledStampWash; knockout: boolean });

const washDeposits = new WeakMap<CompiledStampWash, readonly CompiledStampDeposit[]>();

/** What seeds deposit `id`'s randomness at boil `epoch`: its ID as written at 0, and a seed of the epoch's own after. */
export const stampBoilSeed = (id: string, epoch: number) => (epoch ? `${id}|boil${epoch}` : id);

/** `pass`'s deposits in painting order: a wash's are its schedule's, worked out once per wash. */
export function stampPassDeposits(pass: CompiledStampPass): readonly CompiledStampDeposit[] {
  if (pass.kind === 'dry') return pass.deposits;
  let deposits = washDeposits.get(pass.wash);
  if (!deposits) washDeposits.set(pass.wash, (deposits = pass.wash.schedule.flatMap((step) => (step.kind === 'deposit' ? [step.deposit] : []))));
  return deposits;
}

/** How much an opaque group's coverage is raised as it lands, in flat colour and pigment alike: paint at half its density or more covers. */
export const STAMP_OPAQUE_COVER = 2;

export type CompiledStampGroup = {
  id: string; composite: 'opaque' | 'glaze'; opacity: number; paper: StampGroupPaper; passes: readonly CompiledStampPass[];
  /** Absent for a group that stays where it's painted. */
  motion?: StampGroupMotion;
  /** The scene seconds over which its paint changes (a keyed material's first key to its last); absent for paint that doesn't. */
  recolours?: { from: number; to: number };
  /**
   * Absent for a group painted once. `epoch`: which of its boil's paintings this is (0, as written); `reseeded`
   * compiles this group alone at another epoch, each deposit's randomness drawn afresh and its ID, fluid, colour and
   * reveal kept, so an epoch reshapes marks but never repaints the palette.
   */
  boil?: StampGroupBoil & { epoch: number; reseeded: (epoch: number) => CompiledStampGroup };
};

/** Whether `group` takes out of the paint behind it: its first pass is a knockout, as only a first may be. */
export const stampGroupKnocksOut = ({ passes: [first] }: CompiledStampGroup) => first?.kind === 'wash' && first.knockout;

/** A checked recipe with every stamp placed, its groups in the order they paint. */
export type CompiledStampPaint = { groups: readonly CompiledStampGroup[] };

/**
 * Checks `recipe` and places every stamp. Throws on an ID used twice at one level (it would seed two deposits alike)
 * or holding `/` or `|` (the seed's separators), a clipped pass with nothing before it, a deposit with no points or
 * diameter, a region that isn't a shape, or any number out of its range.
 */
export function compileStampPaintRecipe(recipe: StampPaintRecipe): CompiledStampPaint {
  const seen = new Set<string>(), duplicates = new Set<string>();
  const claim = (id: string, parent?: string) => {
    if (!id || /[/|]/.test(id)) throw new Error(`stamp paint: "${id}" isn't an ID: IDs are non-empty and hold no "/" or "|"`);
    const full = parent ? `${parent}/${id}` : id;
    if (seen.has(full)) duplicates.add(full);
    seen.add(full);
    return full;
  };
  const masks = new Map<NonNullable<StampPaintRecipeMask>, CompiledStampMask>();
  for (const node of recipe.masks) {
    const { path, op, under } = node;
    const full = claim(path.at(-1)!, path.slice(0, -1).join('/') || undefined);
    const common = { id: full, under: under ? masks.get(under)! : null };
    if (op.kind === 'mask') {
      masks.set(node, { ...common, kind: 'mask', area: compileStampArea(op, full) });
      continue;
    }
    const amount = op.amount ?? 1;
    if (!(amount >= 0 && amount <= 1)) throw new Error(`stamp paint: ${full} lifts ${amount} of the fluid, and an unmask lifts 0..1 of it`);
    masks.set(node, { ...common, kind: 'unmask', amount, area: op.region ? compileStampArea(op, full) : null });
  }
  // Groups in the order they paint; a standing before reaches only groups earlier in it.
  const resolved = recipe.groups.map((group, written) => ({ written, order: group.options.order ?? 0, depth: group.options.depth ?? 0, group }));
  resolved.sort((a, b) => a.order - b.order || b.depth - a.depth || a.written - b.written);
  const exclusions = stampStandsBeforeExclusions(resolved.map(({ group: { id, options } }) => ({ id, ...(options.standsBefore && { standsBefore: options.standsBefore }) })));
  const holders = new Map(resolved.map(({ group: { id } }) => [id, stampFluidHolder(exclusions.get(id) ?? [])]));
  /**
   * `group` compiled with every deposit seeded for boil `epoch` (0: as written). IDs are claimed only as written:
   * an epoch's are those same IDs, checked already.
   */
  const compileGroup = ({ id, options, passes }: StampPaintRecipeGroup, epoch: number): CompiledStampGroup => {
    const named = epoch ? (child: string, parent?: string) => (parent ? `${parent}/${child}` : child) : claim;
    const groupId = named(id), held = holders.get(id)!;
    let clipBase: string | undefined;
    const compiledPasses = passes.map((pass, index): CompiledStampPass => {
      const passId = named(pass.id, groupId);
      if (pass.wash?.knockout) {
        if (index > 0) throw new Error(`stamp paint: ${passId} is a knockout after ${groupId}'s first pass; a group knocks out once, before it paints`);
        const painted = pass.steps.flatMap((step) => (step.kind === 'deposit' && step.action.kind === 'paint' ? [step] : []))[0];
        if (painted) throw new Error(`stamp paint: ${passId} is a knockout and ${painted.id} paints in it; a knockout only reserves and lifts`);
      }
      if (pass.clipped && !clipBase) throw new Error(`stamp paint: ${passId} is clipped, but no unclipped pass comes before it in ${groupId}`);
      const clipTo = pass.clipped ? clipBase : undefined;
      // A knockout holds no paint of the group's, so nothing clips to it.
      if (!pass.clipped && !pass.wash?.knockout) clipBase = passId;
      /** `step` compiled, its action by `action` from the colour jitter drawn for it. */
      const deposit = <W extends StampRecipeWashAction, A extends CompiledStampAction>(step: StampPaintRecipeDeposit<W>, action: (full: string, draws: readonly number[]) => A) => {
        const full = named(step.id, passId), fluid = step.mask && masks.get(step.mask)!;
        // A knockout acts on the paint behind the group, which a standing before doesn't hold off.
        return compileDeposit(full, step, (draws) => action(full, draws), pass.wash?.knockout ? fluid : held(fluid), stampBoilSeed(full, epoch));
      };
      const common = { id: passId, ...(clipTo && { clipTo }), within: pass.within ? compileStampArea(pass.within, passId) : null };
      if (!pass.wash) {
        // Deposits before kind, as the stamp gate's input prints have held a dry pass since vid-117's Phase 0.
        return { ...common, deposits: pass.steps.map((step) => deposit(step, (full, draws) => compilePaintAction(full, step.action, step.tool.brush, draws))), kind: 'dry' };
      }
      const schedule = pass.steps.map((step): CompiledStampWashStep => {
        if (step.kind === 'deposit') return { kind: 'deposit', deposit: deposit(step, (full, draws) => compileWashAction(full, step.action, step.tool.brush, draws)) };
        return 'under' in step ? step : checkedWait(step, passId);
      });
      const { preparation, rim, knockout } = pass.wash;
      if (rim !== undefined) checkedRim(rim, passId);
      let prepared: CompiledStampWash['preparation'] = null;
      if (preparation) {
        const wetness = preparation.wetness ?? { kind: 'constant' as const, value: 1 };
        const problem = stampPaintFieldProblem(wetness, (value) => (value >= 0 && value <= 1 ? null : `a wetness of ${value}, outside 0..1`));
        if (problem) throw new Error(`stamp paint: ${passId}'s preparation can't be laid: ${problem}`);
        const reserved = knockout ? null : held(null);
        prepared = { polygon: checkedStampPolygon(preparation.region, passId), wetness: stampSeededPaintField(wetness, passId), ...(reserved && { held: reserved }) };
      }
      return { ...common, kind: 'wash', wash: { preparation: prepared, schedule, ...(rim !== undefined && { rim }) }, knockout };
    });
    const opacity = options.composite === 'glaze' ? options.opacity : 1;
    const { motion, boil } = options;
    if (motion) checkStampGroupMotion(motion, groupId);
    if (boil && !(Number.isInteger(boil.every) && boil.every >= 1)) throw new Error(`stamp paint: ${groupId} boils every ${boil.every} frames, and a boil repaints every whole number of frames from 1`);
    const written = { id, options, passes };
    const recolours = stampGroupRecolours(compiledPasses);
    return {
      id: groupId, composite: options.composite, opacity, paper: options.paper ?? 'ground', passes: compiledPasses, ...(motion && { motion }), ...(recolours && { recolours }),
      ...(boil && { boil: { every: boil.every, epoch, reseeded: (next: number) => compileGroup(written, next) } }),
    };
  };
  const groups = resolved.map(({ group }) => compileGroup(group, 0));
  if (duplicates.size) throw new Error(`stamp paint: IDs used twice, which would seed two deposits alike: ${[...duplicates].join(', ')}`);
  return { groups };
}

/** The scene seconds over which `passes`' paint changes, every keyed material's span joined; null for none. */
function stampGroupRecolours(passes: readonly CompiledStampPass[]): CompiledStampGroup['recolours'] | null {
  const spans = passes.flatMap((pass) => stampPassDeposits(pass)).flatMap(({ action }) => {
    if (action.kind !== 'paint') return [];
    const { first, second } = stampPaintFieldEnds(action.material);
    return [first, second].flatMap((end) => (end.kind === 'keys' ? [stampMaterialKeysSpan(end)] : []));
  });
  return spans.length ? { from: Math.min(...spans.map(({ from }) => from)), to: Math.max(...spans.map(({ to }) => to)) } : null;
}

function checkedWait(step: StampWashWaitStep, passId: string): StampWashWaitStep {
  const { until, rim } = step;
  if (typeof until === 'object' && !(until.seconds >= 0 && Number.isFinite(until.seconds))) throw new Error(`stamp paint: ${passId} waits ${until.seconds}s, and a wait takes a finite 0 or more`);
  if (rim !== undefined) {
    if (until !== 'dry') throw new Error(`stamp paint: ${passId} gives a rim to a wait for ${JSON.stringify(until)}, and only a wait for dry rims`);
    checkedRim(rim, passId);
  }
  return step;
}

function checkedRim(rim: number, passId: string) {
  if (!(rim >= 0 && rim <= 2)) throw new Error(`stamp paint: ${passId} rims at ${rim}, and a rim's strength is 0..2`);
}
