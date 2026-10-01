// stamp-paint-recipe-types.ts: what a stamp painting is as written, apart from how it's rendered or where its
// brushes came from: its materials, each deposit's settings, the scopes a recipe is written in (stamp-paint-recipe.ts)
// and the recipe they write, which stamp-paint-recipe-compile.ts checks and places.
//
// A recipe is ordered groups of ordered passes of deposits under the masking fluid declared before each; in a wash,
// a deposit may wet or lift, and the wash may wait to dry. Every stamp is placed once; a frame at `t` only chooses how
// much of each deposit shows. Scene time says when a deposit shows; painting time, advanced by a wash's waits, how
// wet the paper was as it landed (stamp-wetness.ts).

import type { PaintMaterial, StampPaintColor } from '#lib/paint/materials/models/paint-material.ts';
import type { StampBlend, StampBrush, StampBrushAsset } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampPlacement, StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import type { StampStrokeHand } from '#lib/paint/brush/models/stamp-stroke-hand.ts';
import type { StampFillApplication } from './stamp-fill.ts';
import type { StampPaintField } from './stamp-paint-field.ts';
import type { StampRecipePaint, StampRecipeWashAction } from './stamp-paint-action.ts';
import type { StampRegion } from './stamp-region.ts';
import type { StampArea, StampStandsBefore } from './stamp-area.ts';
import type { StampGroupBoil, StampGroupMotion, StampGroupPaper } from './stamp-group-motion.ts';
import type { CompiledStampMaterialKeys, StampMaterialKeys } from './stamp-material-keys.ts';
import type { StampMark } from './stamp-marks.ts';
import type { StampDepositName } from './stamp-deposit-identity.ts';
import type { StampBackrunSettings, StampChargeSettings, StampWaitOptions, StampWashWait, StampWrittenWait } from './stamp-wash-effects.ts';

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
export type StampToolSettings = {
  brush: StampBrush;
  diameter: number;
  /** The most this deposit can build to, 0..1, however its stamps overlap. */
  opacity?: number;
} & StampDepositReveal;

export type StampPaintSettings = StampToolSettings & {
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
export type StampDepositReveal = { appliedAt?: undefined; drawnOver?: undefined } | { appliedAt: number; drawnOver?: number };

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
 * Water dropped into a drying wash, a bloom: the wash waits until the paper under the drop is damp (wait('damp')),
 * then these placements land, `water` (1 when left out) each.
 */
export type StampBloomSettings = StampToolSettings & StampPlacementGeometry & { water?: number };
/**
 * Paint from a mark (StampMark): its brush, diameter and geometry are the mark's, and it's placed from the mark's
 * key, so whatever else is built from that mark lands the same stamps.
 */
export type StampMarkPaintSettings = { mark: StampMark; material: StampPaintMaterial; blend?: StampBlend; secondaryColor?: StampPaintColor; opacity?: number } & StampDepositReveal;

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
export type StampMasking = { mask: (id: string, settings: StampMaskSettings) => void; unmask: (id: string, settings: StampUnmaskSettings) => void };

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
  mark: (id: string, settings: StampMarkPaintSettings) => void;
  stroke: (id: string, settings: StampStrokeSettings) => void;
  stamps: (id: string, settings: StampPlacementSettings) => void;
  fill: (id: string, settings: StampFillSettings) => void;
};
/** A wash's scope: its paint carries water; it can wet, lift, soften, bloom, charge, backrun, and wait for itself to dry. */
export type StampWashScope = StampMasking & {
  mark: (id: string, settings: StampMarkPaintSettings & StampWashWater) => void;
  stroke: (id: string, settings: StampStrokeSettings & StampWashWater) => void;
  stamps: (id: string, settings: StampPlacementSettings & StampWashWater) => void;
  fill: (id: string, settings: StampFillSettings & StampWashWater) => void;
  water: (id: string, settings: StampWaterSettings) => void;
  lift: (id: string, settings: StampLiftSettings) => void;
  soften: (id: string, settings: StampSoftenSettings) => void;
  bloom: (id: string, settings: StampBloomSettings) => void;
  charge: (id: string, settings: StampChargeSettings) => void;
  backrun: (id: string, settings: StampBackrunSettings) => void;
  wait: (until: StampWashWait, options?: StampWaitOptions) => void;
};

/** The fluid as it stands: the latest op, over the fluid before it; null when there's none. */
export type StampPaintRecipeMask = {
  /** Its scope's IDs, then its own. */
  path: readonly string[];
  op: ({ kind: 'mask' } & StampMaskSettings) | ({ kind: 'unmask' } & StampUnmaskSettings);
  under: StampPaintRecipeMask | null;
} | null;
/** A deposit as written: compileDeposit checks it and places its stamps. */
export type StampPaintRecipeDeposit<A extends StampRecipeWashAction = StampRecipeWashAction> = {
  kind: 'deposit';
  /** Its name in its passage (stamp-deposit-identity.ts), which with the passage's IDs seeds it. */
  name: StampDepositName;
  /** The applications it was written under, outermost first: what organised it, which never seeds it. */
  provenance: readonly string[];
  geometry: StampDepositGeometry;
  // Loosened from StampToolSettings, whose reveal union a rest spread can't keep; its settings were checked as written.
  tool: { brush: StampBrush; diameter: number; opacity?: number; appliedAt?: number; drawnOver?: number };
  action: A;
  mask: StampPaintRecipeMask;
  /** The mark it's built from, whose key places it; absent for a deposit placed from its own ID. */
  mark?: StampMark;
};
export type StampPaintRecipeStep = StampPaintRecipeDeposit | StampWrittenWait;
export type StampPaintRecipePass = { id: string; clipped: boolean; within?: StampArea } & (
  | { wash: null; steps: readonly StampPaintRecipeDeposit<StampRecipePaint>[] }
  | { wash: { preparation?: StampWashOptions['preparation']; rim?: number; knockout: boolean }; steps: readonly StampPaintRecipeStep[] }
);
export type StampPaintRecipeGroup = { id: string; options: StampGroupOptions; passes: readonly StampPaintRecipePass[] };

/** A recipe as written, IDs unchecked: `compileStampPaintRecipe` checks it. */
export type StampPaintRecipe = { groups: readonly StampPaintRecipeGroup[]; masks: readonly NonNullable<StampPaintRecipeMask>[] };
