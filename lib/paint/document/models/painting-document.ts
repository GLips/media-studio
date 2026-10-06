// painting-document.ts: the PaintingDocument a painting source's factory returns: resolved physical operations, while
// techniques and geometry stay in the source's TS. Values sit where they're used (a paper, a brush, a mix); keys name
// only the tree. Lengths are paper px, x right, y down; angles radians, positive turning clockwise on screen.
//
// docs/painting-authoring.md is the author's page for all of it; painting-document-check.ts holds a document to it.

import type { StampBrushAsset } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampPlacement, StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import type { StampStrokeHand } from '#lib/paint/brush/models/stamp-stroke-hand.ts';
import type { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import type { StampFillReach, StampFillStrokes } from '#lib/paint/painting/models/stamp-fill-strokes.ts';
import type { StampSeededPaintField } from '#lib/paint/painting/models/stamp-paint-field.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampRevealStroke } from '#lib/paint/painting/models/stamp-reveal.ts';
import type { StampWrap } from '#lib/paint/painting/models/stamp-stage.ts';
import type { PaintingReveal } from './painting-reveal-profile.ts';

// ---- identity ------------------------------------------------------------------------------------------------------

/**
 * Names a layer, group, wash or application, unique across the document, with no `/`, `|` or whitespace, and not
 * starting with `#`. A layer's, wash's and application's keys name its deposits, seeding their colour and water, so
 * renaming one repaints them and leaving a layer out repaints no other; a group's key repaints nothing.
 */
export type Key = string;
export type LayerKey = Key;
export type GroupKey = Key;
/** A layer's or a group's key: what a selection or a rig's cel names. */
export type NodeKey = Key;
export type WashKey = Key;
export type ApplicationKey = Key;

/** Seeds one random process. Equal seeds draw equal randomness, so two applications given one seed repeat each other's marks. */
export type Seed = string;

export type Hex = `#${string}`;

export type MediumName = keyof typeof PAINT_MEDIA;

// ---- geometry ------------------------------------------------------------------------------------------------------

/** A closed ring, its first point not repeated. */
export type Ring = readonly StampPoint[];

/**
 * `polygon`: its rings read even-odd, so a ring inside another is a hole, one inside a hole an island, and rings side
 * by side a union; rings never cross (compute an overlap's union in TS). Curves arrive flattened. Paint outside the
 * document rectangle is clipped away, except across an axis the document wraps (`wrap`): it comes round.
 */
export type Region =
  | { readonly kind: 'polygon'; readonly rings: readonly Ring[] }
  | { readonly kind: 'ellipse'; readonly center: StampPoint; readonly radiusX: number; readonly radiusY: number };

/**
 * A stroke point. `pressure` 0..1 (1), times the hand's profile, drives what the brush binds to pressure (size,
 * opacity, flow: the author page's brush table). `scale` above 0 (1) multiplies the diameter. To close a loop,
 * repeat the first point last.
 */
export type StrokePoint = Omit<StampStrokePoint, 'lift'>;

/** One pen-down run. A pen-up between subpaths lays nothing, yet the hand's profile counts the gap's length. */
export type Subpath = readonly StrokePoint[];

/**
 * A quantity varying over paper, in document px: the engine's field (constant; linear; radial, linear in distance
 * out to `radius`; noise), held at its ends past them.
 */
export type Field<T> = StampSeededPaintField<T>;

/** A 0..1 share, constant or varying. */
export type Amount = number | Field<number>;

// ---- edges and clips -----------------------------------------------------------------------------------------------

/** Ragged displacement of an edge's line, by up to `amountPx`, features about `featurePx` apart. */
export type Roughness = { readonly amountPx: number; readonly featurePx: number; readonly seed: Seed };

/**
 * `crisp`: a wall paint and water stop at, where a drying wash gathers its rim. `feather`: still that wall, with
 * coverage ramping to nothing over `widthPx` inside the line. `bleed`: no wall; a ramp `reachPx` wide past the line
 * where paint and water land fading and dry with no rim. Past it, paint walks only into water already there.
 */
export type Edge =
  | { readonly kind: 'crisp'; readonly roughness?: Roughness }
  | { readonly kind: 'feather'; readonly widthPx: number; readonly roughness?: Roughness }
  | { readonly kind: 'bleed'; readonly reachPx: number; readonly roughness?: Roughness };

/**
 * A stretch of a region's outline with an edge of its own: every point within 1 px of one ring (or of the traced
 * ellipse), either direction. Two stretches running along each other with different edges are refused.
 */
export type Boundary = { readonly path: readonly StampPoint[]; readonly edge: Edge };

/** A region, its outline's edge (crisp when left out), and stretches with their own. */
export type EdgedRegion = { readonly region: Region; readonly edge?: Edge; readonly boundaries?: readonly Boundary[] };

/**
 * Where an application may land and its own paint walk; several intersect. It binds only its own application: a later
 * unclipped deposit's water still moves open paint across it. `anchor: 'paper'` keeps it still on the sheet while a
 * scene poses its layer, so a moving element passes behind it; left out, it moves with the layer.
 */
export type Clip = EdgedRegion & { readonly anchor?: 'paper' };

// ---- materials -----------------------------------------------------------------------------------------------------

/** A pigment by appearance (WATERCOLOUR_PIGMENTS hold them), or a hex fitted as a pigment of its own. */
export type MixPart = { readonly pigment: PaintPigmentAppearance | Hex; readonly amount: number };

/**
 * Pigments by relative amount (≥ 0, one positive), at `strength` 0..1 of a full load. Below 1, watercolour thins with
 * water; gouache and crayon add their own white. A field of mixes grades each pigment's amount (share × strength),
 * never colour: its ends may name different pigments, one an end lacks being 0 there.
 */
export type Mix = { readonly parts: readonly MixPart[]; readonly strength: number };

/** A brush by its style's own name for it (the author page's brush table). It paints in any medium. */
export type BrushRef = { readonly style: string; readonly brush: string };

/**
 * A paper: a style's `paper` plus `absorbency` 0..1, which sets drying: a flooded wash dries in medium.drying ÷
 * (0.5 + absorbency) model seconds. `grain.scale` is the grain image's width over the document's.
 */
export type Paper = {
  readonly color: Hex;
  readonly image?: StampBrushAsset;
  readonly grain?: { readonly image: StampBrushAsset; readonly scale: number; readonly depth: number };
  readonly absorbency: number;
};

/**
 * How scene time drives a sheet's drying once a clocked wet wash starts its clock: a number, the scene seconds a model
 * second takes; `instant`, the sheet sets before each clocked application; `never`, nothing on it dries, its unclocked
 * work included. A sheet with no clocked wet wash dries in model time whatever its scale.
 */
export type DryingScale = number | 'instant' | 'never';

/**
 * What a layer or group is painted on. Left out: its parent's sheet. `own`: a new sheet of `paper`, a cut-out hiding
 * what's behind as far as its layers' paint lies, at its own `dryingScale` (1). `scene`: the root's sheet, past any
 * enclosing own sheet, at the root's scale. Layers on one sheet share its wet history and clock.
 */
export type Sheet =
  | { readonly kind: 'own'; readonly paper: Paper; readonly dryingScale?: DryingScale }
  | { readonly kind: 'scene'; readonly dryingScale?: never };

// ---- what an application lays ---------------------------------------------------------------------------------------

export type StrokeGeometry = { readonly kind: 'stroke'; readonly subpaths: readonly Subpath[]; readonly hand?: StampStrokeHand };

/** Touches placed by hand, each its own centre, and optionally `diameter` (px), rotation and pressure. */
export type StampsGeometry = { readonly kind: 'stamps'; readonly placements: readonly StampPlacement[] };

/**
 * Over `area`: a wet brush floods it in strokes `diameterPx` wide round the outline and in rows across (reaching
 * inside or past its edge by that many diameters); a dry one shades it in strokes. `direction`: radians the rows run
 * along (0). `load`: the share of a full load laid (1), as `opacityCap` on a flood, per stamp in strokes.
 */
export type FillGeometry = {
  readonly kind: 'fill';
  readonly area: EdgedRegion;
  readonly laying?: { readonly kind: 'flood'; readonly reach?: StampFillReach } | ({ readonly kind: 'strokes' } & StampFillStrokes);
  readonly direction?: number;
  readonly load?: Amount;
};

export type DepositGeometry = StrokeGeometry | StampsGeometry | FillGeometry;

/** The tip: its brush, nominal diameter, and the seed of everything random in how it lays. */
export type Tip = { readonly brush: BrushRef; readonly diameterPx: number; readonly seed: Seed };

/**
 * Pigment. `water` 0..1: the wetness the brush brings, raising the paper's toward it by contact (the medium's default
 * when left out). `maxSpreadPx` caps how far this application's paint walks as it lands. `opacityCap` 0..1: the most
 * of a full load this application builds at a texel, a dark colour thinning toward its tint. `burnish`: pressed into
 * every valley (crayon).
 */
export type PaintCharge = {
  readonly kind: 'paint';
  readonly mix: Mix | Field<Mix>;
  readonly water?: number;
  readonly maxSpreadPx?: number;
  readonly opacityCap?: number;
  readonly burnish?: true;
};
/** Pigment laid by the dry law, in a wash without wet history: no water, so nothing walks. */
export type DryPaintCharge = Omit<PaintCharge, 'water' | 'maxSpreadPx'> & { readonly water?: never; readonly maxSpreadPx?: never };
/** Clean water, raising the paper's wetness toward `water` 0..1 by contact, and moving any open paint it meets. */
export type WaterCharge = { readonly kind: 'water'; readonly water: number };
/** A thirsty brush, tissue or eraser taking up to `strength` 0..1 of the paint under it, as the medium allows. */
export type LiftCharge = { readonly kind: 'lift'; readonly strength: number };
export type Charge = PaintCharge | WaterCharge | LiftCharge;

/** The footprint of explicit marks laid through a tip: masking fluid brushed on, or wax. */
export type MarkFootprint = Tip & (StrokeGeometry | StampsGeometry) & { readonly anchor?: 'paper' };

/**
 * Where masking fluid lies: a region with a crisp or feathered edge, or the footprint of explicit marks.
 * `anchor: 'paper'` keeps it still on the sheet while a scene poses its layer; left out, it moves with the layer.
 */
export type Footprint = ({ readonly kind: 'region'; readonly region: Region; readonly edge?: Exclude<Edge, { readonly kind: 'bleed' }>; readonly anchor?: 'paper' }) | MarkFootprint;

/**
 * Wax on the paper's peaks, laid by marks (a brush's grain is what catches the peaks; a region has none): the
 * application keeps 1 − `amount` of its contact there. Protects nothing outright.
 */
export type Resist = { readonly footprints: readonly MarkFootprint[]; readonly amount: number };

/**
 * One mark, or one run of marks, laid through one tip. `reserves`: masking fluid excluding this application's
 * deposition and transport; it doesn't remove water or paint already present, and binds no other application.
 * Share one across applications as a TS constant. Reserves, resists and clips move with the posed layer unless
 * anchored to the paper.
 */
export type Deposit<C extends { readonly kind: string } = Charge> = DepositGeometry & Tip & {
  readonly charge: C;
  readonly clips?: readonly Clip[];
  readonly reserves?: readonly Footprint[];
  readonly resists?: readonly Resist[];
};

// ---- applications --------------------------------------------------------------------------------------------------

/**
 * The incoming state an application waits for, judged over its core by its sheet's water, before it lands, wherever
 * a scene poses it: `wet`, shiny over the core's share; `damp`, matte yet workable over it; `dry`, no workable paint
 * or water at any texel.
 */
export type Wetness = 'wet' | 'damp' | 'dry';

/**
 * `bloom`, on water only: checked to have surplus water over open paint on workable paper, so it can spread a bloom or
 * backrun; if it certainly can't, the solve fails.
 */
type Labelled = (Deposit & { readonly effect?: undefined }) | (Deposit<WaterCharge> & { readonly effect: 'bloom' });

/**
 * A deposit landing at the earliest painting time at or after its predecessor's in its sheet's order at which `on`
 * holds; without `on`, at its predecessor's time, into whatever is still open. `key` names it in problems and reports;
 * left out, problems name it `<wash>.applications[i]`.
 */
export type Application = Labelled & { readonly key?: ApplicationKey; readonly on?: Wetness; readonly at?: never };

/**
 * In a clocked wash an application may fix `at`, a scene second at or after the wash's start and its predecessor's
 * landing. It never moves; if `on` fails there, it's an error. On a shared sheet it lands among other washes'
 * applications by that time.
 */
export type TimedApplication = Labelled & { readonly key?: ApplicationKey; readonly on?: Wetness; readonly at?: number };

/** Paint and lifts laid by the dry law: no water field, flow or rim. Line work, crayon, body colour laid dry. */
export type DirectApplication = Deposit<DryPaintCharge | LiftCharge> & { readonly key?: ApplicationKey; readonly at?: never };
export type TimedDirectApplication = Deposit<DryPaintCharge | LiftCharge> & { readonly key?: ApplicationKey; readonly at?: number };

/** Any application a wash may hold, as the checks and the compiler read it. */
export type AnyApplication = Application | TimedApplication | DirectApplication | TimedDirectApplication;

// ---- reveals -------------------------------------------------------------------------------------------------------

/**
 * One stroke of a reveal: a band `widthPx` wide round `points` (document px), its front moving along them at constant
 * speed from scene second `from` to `to`. `cap` `'round'` (left out) reaches half the width past each end; `'flat'`
 * stops square. Size it by the stroke's visible width (paintingStrokeVisibleWidthPx), then look: wider than its
 * rows' spacing, it shows theirs.
 */
export type RevealStroke = StampRevealStroke;

/**
 * Where and when a node's finished paint shows at the selection's `at` (all of it when left out): an arrival time per
 * texel. `strokes`: the earliest stroke covering it; uncovered never shows. `field`: `base` through its `profile`,
 * plus `delay`, in scene seconds. A texel shows over `softS` seconds once reached. It cuts what's laid: solves, water
 * and checkpoints are untouched.
 */
export type Reveal = PaintingReveal;

// ---- washes, layers, groups ----------------------------------------------------------------------------------------

/**
 * Clean water laid evenly at its wash's start, before the first application is scheduled (whose `on` reads it),
 * `water` 0..1 (1), with no brush texture; none lands under its `reserves`. Later water is a timed water application.
 */
export type Prewet = { readonly region: Region; readonly water?: Amount; readonly reserves?: readonly Footprint[] };

/**
 * A clocked wash, which its sheet's clock times at the sheet's `dryingScale`. `origin`: the earliest scene second its
 * first application lands (negative ages the sheet before the shot), or `'set'`: once the layer's earlier washes have
 * set.
 */
export type WashClock = { readonly origin: number | 'set' };

type WashCommon = {
  readonly key: WashKey;
  /** An earlier wash of the same layer whose paint coverage, graded, clips this one: texture inside a silhouette. */
  readonly clipTo?: WashKey;
};

type WetWashCommon = WashCommon & {
  readonly prewet?: Prewet;
  /** 0..2 (1, the medium's): how dark a drying wash's edge line gathers. */
  readonly rim?: number;
  readonly wetHistory?: undefined;
};

type DirectWashCommon = WashCommon & { readonly wetHistory: false; readonly prewet?: never; readonly rim?: never };

/**
 * A run of applications in its sheet's wet history, meeting its layer's earlier washes set. Unclocked, it's painted
 * before any clock starts and shown with every application; clocked, a scene can show it partway. `wetHistory:
 * false` touches no water, in any medium (crayon's only kind), so it has no say in its sheet's drying.
 */
export type Wash =
  | (WetWashCommon & { readonly clock?: undefined; readonly applications: readonly Application[] })
  | (WetWashCommon & { readonly clock: WashClock; readonly applications: readonly TimedApplication[] })
  | (DirectWashCommon & { readonly clock?: undefined; readonly applications: readonly DirectApplication[] })
  | (DirectWashCommon & { readonly clock: WashClock; readonly applications: readonly TimedDirectApplication[] });

/**
 * One film of paint, glazed over what's behind. It shares its sheet's water: its paint lands into whatever is still
 * wet there and glazes over what's dry. `medium` and `sheet` are inherited when left out. Posed on a sheet it
 * doesn't own, it's repainted into that sheet at each distinct pose.
 */
export type Layer = {
  readonly key: LayerKey;
  readonly medium?: MediumName;
  readonly sheet?: Sheet;
  /** Cuts this layer's film alone: the ground and sibling films stay, with what its water did to them. */
  readonly reveal?: Reveal;
  readonly washes: readonly Wash[];
  readonly children?: never;
};

/** Layers and groups sharing a sheet choice and a motion parent: what a scene poses and rigs. Paints nothing itself. */
export type LayerGroup = {
  readonly key: GroupKey;
  readonly medium?: MediumName;
  readonly sheet?: Sheet;
  /**
   * Cuts every film under it, multiplying with their own reveals, and the cards of sheets it or a node under it owns
   * with their paint; never the root's paper.
   */
  readonly reveal?: Reveal;
  readonly children: readonly LayerNode[];
  readonly washes?: never;
};

export type LayerNode = Layer | LayerGroup;

// ---- document ------------------------------------------------------------------------------------------------------

/**
 * Any size; (0, 0) is its top-left corner. `paper` is the root's own sheet, the whole document rectangle, drying at
 * `dryingScale` (1) once a clocked wet wash on it starts its clock. `wrap` (StampWrap): paper, marks and wet stages
 * run on across each seam it names, on every sheet.
 */
export type PaintingDocument = {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly paper: Paper;
  readonly medium: MediumName;
  readonly dryingScale?: DryingScale;
  readonly wrap?: StampWrap;
  /** Back to front. */
  readonly layers: readonly LayerNode[];
};
