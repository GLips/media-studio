// stamp-paint-recipe-types.ts: what a stamp painting is as written, apart from how it's rendered or where its
// brushes came from: its materials and wells, each operation's settings, the scopes a recipe is written in
// (stamp-paint-recipe.ts, stamp-paint-passage.ts) and the recipe they write, which stamp-paint-recipe-compile.ts
// checks and places.
//
// A recipe is ordered groups of ordered passages, each one physical history, of deposits under the masking fluid
// declared before each; a passage with wet history may wet, lift and wait for its paint to set. Scene time says when
// a deposit shows (stamp-paint-score.ts); painting time, advanced by waits and conditions, how wet the paper was as
// it landed (stamp-wetness.ts).

import type { PaintMaterial, StampPaintColor } from '#lib/paint/materials/models/paint-material.ts';
import type { StampBlend, StampBrush, StampBrushAsset } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampPlacement, StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import type { StampStrokeHand } from '#lib/paint/brush/models/stamp-stroke-hand.ts';
import type { StampFillApplication } from './stamp-fill.ts';
import type { StampPaintField } from './stamp-paint-field.ts';
import type { StampRecipePaint, StampRecipeWashAction } from './stamp-paint-action.ts';
import type { StampRegion } from './stamp-region.ts';
import type { StampArea, StampStandsBefore, StampWithin } from './stamp-area.ts';
import type { StampGroupBoil, StampGroupMotion, StampGroupPaper } from './stamp-group-motion.ts';
import type { CompiledStampMaterialKeys, StampMaterialKeys } from './stamp-material-keys.ts';
import type { StampMaterialSet } from './stamp-material-set.ts';
import type { StampMark } from './stamp-marks.ts';
import type { StampDepositName } from './stamp-deposit-identity.ts';
import type { StampPaintMixing, StampPigmentMixing } from './stamp-pigment-paint.ts';
import type { StampAllocatedReveal, StampChildTiming, StampReveal, StampScoreOptions } from './stamp-paint-score.ts';
import type { StampSheet, StampSize } from './stamp-paint-sizes.ts';
import type { StampCondition, StampWrittenWait } from './stamp-wash-effects.ts';

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
 * What a recipe is written against: the paper, how its paint mixes (the medium whose capabilities it's checked
 * against), and the sheet a style's named sizes are measured on. A resolved style is one (ResolvedStampPaintStyle),
 * as is any fixture holding the three.
 */
export type StampPaintEnvironment = { paper: StampPaintPaper; mixing: StampPaintMixing; sheet?: StampSheet };

/** A material that may change over the scene: one throughout, or keyed over scene time (stamp-material-keys.ts); compiled, its keys checked. */
export type StampKeyedMaterial = PaintMaterial | StampMaterialKeys<PaintMaterial>;
export type CompiledStampKeyedMaterial = PaintMaterial | CompiledStampMaterialKeys<PaintMaterial>;

/**
 * A material across the painting: one throughout, or graded between two (stamp-paint-field.ts), as a graded wash
 * runs from a sky's ultramarine to its horizon's rose. Only a style that paints in pigment grades one, by amounts of
 * pigment, never by rendered colour. Each may be keyed over scene time; a graded one's ends are keyed apart.
 */
export type StampPaintMaterial = StampKeyedMaterial | StampPaintField<StampKeyedMaterial>;

/**
 * What a brush is loaded from: a material, or a set picked from per mark (a raw op picks once, by its own ID), and in
 * a passage with wet history, how much water it carries (0..1; its medium's brushWater when left out). Clean water
 * says its own `amount`.
 */
export type StampWell = { paint: StampPaintMaterial | StampMaterialSet; water?: number };

/** A passage's defaults, for any operation that doesn't say: its own, then a technique's, then these. */
export type StampPassageDefaults = { brush?: StampBrush; well?: StampWell; size?: StampSize };

/** What every application takes: its place in the score, and an area its deposits land within besides its passage's. */
export type StampApplicationOptions = StampScoreOptions & {
  /**
   * Narrows where this application's deposits land, within its passage's `within` and its enclosing applications':
   * a stretch it merges opens its own edge only, never theirs.
   */
  within?: StampWithin;
};

/**
 * `when`: just before the operation, the passage waits until the wettest paper under its deposits is no wetter than
 * its medium's `shiny` or `damp` (PaintSheen). The whole passage's painting time advances. Only in a passage with
 * wet history, in a medium with 'wet-conditions'.
 */
export type StampConditioned = { when?: StampCondition };

/** A depositing operation's brush and its stamp's size at full size (stamp-paint-sizes.ts), from its defaults when left out. */
export type StampToolOptions = {
  brush?: StampBrush;
  size?: StampSize;
  /** The most this deposit can build to, 0..1, however its stamps overlap. */
  opacity?: number;
};

/** What a brush is loaded with: its well, from its defaults when left out. */
export type StampLoadOptions = {
  well?: StampWell;
  /** Left out, the brush's own blend. */
  blend?: StampBlend;
  /** The colour a brush whose colour follows pressure moves toward (StampBrushColorDynamics); a colour material's own if left out. */
  secondaryColor?: StampPaintColor;
  /** Pressed beyond drawing, as a crayon burnishes: a dry medium's wax reaches every valley. Only a medium with 'burnish'. */
  burnish?: boolean;
};

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
 * Over `region`, its passage's `area` when left out, reaching its edges (stamp-fill.ts). `application`: a flood or
 * strokes, by default as its brush's media lays it. `direction`: radians its rows run along (0: left to right); a
 * drawn fill reveals across them. `load`: how much it lays, 0..1, across the region (1 when left out).
 */
export type StampFillGeometry = { region?: StampRegion; application?: StampFillApplication; direction?: number; load?: StampPaintField<number> };
/** Where a deposit goes: along a stroke, at placements, or over a region. */
export type StampDepositGeometry = ({ kind: 'stroke' } & StampStrokeGeometry) | ({ kind: 'stamps' } & StampPlacementGeometry) | ({ kind: 'fill' } & StampFillGeometry);
/** A geometry as compiled reads it: a fill's region resolved. */
export type StampResolvedGeometry = Exclude<StampDepositGeometry, { kind: 'fill' }> | ({ kind: 'fill'; region: StampRegion } & StampFillGeometry);

type StampOperation = StampApplicationOptions & StampConditioned & StampToolOptions;
export type StampStrokeOptions = StampOperation & StampLoadOptions & StampStrokeGeometry;
export type StampPlacementOptions = StampOperation & StampLoadOptions & StampPlacementGeometry;
export type StampFillOptions = StampOperation & StampLoadOptions & StampFillGeometry;
/** Clean water, `amount` 0..1 (1 when left out): it wets the paper, and moves wet paint it meets. */
export type StampWaterOptions = StampOperation & StampDepositGeometry & { amount?: number };
/**
 * A thirsty brush, a tissue or an eraser lifting up to `strength` (0..1, 1 when left out) of the paint under it: in
 * a wet medium all it can of wet paint, less as the paint sets, and never a pigment's stain.
 */
export type StampLiftOptions = StampOperation & StampDepositGeometry & { strength?: number };
/**
 * Paint from a mark (StampMark): its brush, size and geometry are the mark's, and it's placed from the mark's key, so
 * whatever else is built from that mark lands the same stamps. Defaults never change its footprint.
 */
export type StampMarkPaintOptions = StampApplicationOptions & StampConditioned & Omit<StampLoadOptions, 'burnish'> & { mark: StampMark; opacity?: number };

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
  /**
   * The medium and pigments it paints in, when not the painting's: gouache butterflies in a watercolour. Only a
   * painting in pigment takes one. Its paint meets the groups under it dry, as any group's does (stamp-wetness.ts).
   */
  mixing?: StampPigmentMixing;
  motion?: StampGroupMotion;
  boil?: StampGroupBoil;
  /** Groups painted earlier that this one's `shape` is reserved from, as a near hill from the far range (StampStandsBefore). */
  standsBefore?: StampStandsBefore;
};

/** A passage's clean water before any paint: over its `area` (`'area'`), or a region of its own, `wetness` 0..1 (1). */
export type StampPreparation = 'area' | { region: StampRegion; wetness?: StampPaintField<number> };

/**
 * One physical history. Ending it finalises it, every drying closed once; the next passage starts with its paint set.
 * Splitting a passage is a physical decision, never an organisational one.
 */
export type StampPassageOptions = {
  /** What a fill with no region of its own covers, and a preparation of `'area'`. */
  area?: StampRegion;
  /**
   * Where its deposits may land (StampWithin): a reflection kept to its water; a ragged edge there seeded by its ID;
   * named stretches kept, feathered, or merged (which needs its wet history).
   */
  within?: StampWithin;
  /**
   * An earlier passage of its group whose paint clips it, as a Procreate clipping mask clips to the layer under it:
   * texture inside a silhouette. That passage is itself unclipped, and only passages clipped to it come between.
   */
  clipTo?: string;
  preparation?: StampPreparation;
  /** 0..2, 1 the medium's: how strongly each drying rims, its end's too, unless its wait('set') says. */
  rim?: number;
  /** No reveal here or on an application means it's static: there from the scene's start. */
  reveal?: StampReveal;
  children?: StampChildTiming;
  defaults?: StampPassageDefaults;
  /**
   * `false`: in a medium with wet history, this passage keeps none. Its paint lands by the direct law, with no flow,
   * landing or rim, as line work or paint that mustn't gather wet edges does. Left out, the medium's.
   */
  wetHistory?: false;
};

/** A knockout's water, wetting the paint behind the group as a passage's `preparation` wets its paper, for a lift. */
export type StampKnockoutOptions = { preparation?: Exclude<StampPreparation, 'area'> };

/**
 * Masks and unmasks, in any scope. Each changes the fluid for what's declared after it in its scope and the scopes
 * inside it; leaving a group or passage puts back the fluid it began with, so an element's reserve never leaks into
 * the next (an application never does). Masks aren't applications: they take no weight and no reveal.
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
  passage: (id: string, options: StampPassageOptions, body: (p: StampPassageScope) => void) => void;
};

/**
 * A wait in painting time, costing no scene time: `set`, until the passage's paint is no longer workable, a drying
 * (it rims, by `rim` when given); `{ seconds }`, as long, and a drying too if the passage has set by then;
 * `shiny`/`damp`, until the passage's wettest paper, or `region`'s, is no wetter than that.
 */
export type StampPassageWait = {
  (until: 'set', options?: { rim?: number }): void;
  (until: { seconds: number }): void;
  (until: StampCondition, options?: { region?: StampRegion }): void;
};

/**
 * A passage's scope. Raw ops are singleton applications, each one deposit whose ID is unique in its passage, timed
 * by the score. Water, a lift, a condition and a state wait need the passage's history, and its medium's capability.
 */
export type StampPassageScope = StampMasking & {
  mark: (id: string, options: StampMarkPaintOptions) => void;
  stroke: (id: string, options: StampStrokeOptions) => void;
  stamps: (id: string, options: StampPlacementOptions) => void;
  fill: (id: string, options: StampFillOptions) => void;
  water: (id: string, options: StampWaterOptions) => void;
  lift: (id: string, options: StampLiftOptions) => void;
  wait: StampPassageWait;
  /**
   * Organises calls under one application: one share of the score, one provenance node. Changes nothing else: no
   * identity, random draw or mask lifetime, and with no score options of its own, no interval.
   */
  apply: (id: string, options: StampApplicationOptions, body: (p: StampPassageScope) => void) => void;
  /**
   * `body` once per item, each an application whose deposits are named under `key` and the item's `id`. Ids are
   * unique; adding or reordering items renames none of the others.
   */
  each: <T extends { id: string }>(key: string, items: readonly T[], body: (p: StampPassageScope, item: T) => void) => void;
};

/** A knockout's scope: the paint behind the group, as wet as its water leaves it. Its fluid is its own, gone when it ends. */
export type StampKnockoutScope = Pick<StampPassageScope, 'mask' | 'unmask' | 'water' | 'lift' | 'wait'>;

/** The fluid as it stands: the latest op, over the fluid before it; null when there's none. */
export type StampPaintRecipeMask = {
  /** Its scope's IDs, then its own. */
  path: readonly string[];
  op: ({ kind: 'mask' } & StampMaskSettings) | ({ kind: 'unmask' } & StampUnmaskSettings);
  under: StampPaintRecipeMask | null;
} | null;
/** An application's `within` as a deposit lands under it: its area, its ragged edge seeded by `seed`. */
export type StampDepositWithin = { area: StampWithin; seed: string };
/** A deposit as written: compileDeposit checks it and places its stamps. */
export type StampPaintRecipeDeposit<A extends StampRecipeWashAction = StampRecipeWashAction> = {
  kind: 'deposit';
  /** Its name in its passage (stamp-deposit-identity.ts), which with the passage's IDs seeds it. */
  name: StampDepositName;
  /** The applications it was written under, outermost first: what organised it, which never seeds it. */
  provenance: readonly string[];
  geometry: StampResolvedGeometry;
  /** Its brush, its stamp's diameter at full size in the painting's pixels, and the most it builds to. */
  tool: { brush: StampBrush; diameter: number; opacity?: number };
  action: A;
  mask: StampPaintRecipeMask;
  /** When it shows, as the score allotted it; absent, it's there from the start. */
  reveal?: StampAllocatedReveal;
  /** The areas of the applications it was written under, outermost first; absent for none. Deposits of one share it. */
  within?: readonly StampDepositWithin[];
  /** The mark it's built from, whose key places it; absent for a deposit placed from its own ID. */
  mark?: StampMark;
};
export type StampPaintRecipeStep = StampPaintRecipeDeposit | StampWrittenWait;
/** A passage as written: without wet history all paint (`wash` null), with it a schedule of deposits and waits. */
export type StampPaintRecipePass = { id: string; clipTo?: string; within?: StampWithin } & (
  | { wash: null; steps: readonly StampPaintRecipeDeposit<StampRecipePaint>[] }
  | { wash: { preparation?: { region: StampRegion; wetness?: StampPaintField<number> }; rim?: number; knockout: boolean }; steps: readonly StampPaintRecipeStep[] }
);
export type StampPaintRecipeGroup = { id: string; options: StampGroupOptions; passes: readonly StampPaintRecipePass[] };

/** A recipe as written, IDs unchecked: `compileStampPaintRecipe` checks it. */
export type StampPaintRecipe = { environment: StampPaintEnvironment; groups: readonly StampPaintRecipeGroup[]; masks: readonly NonNullable<StampPaintRecipeMask>[] };
