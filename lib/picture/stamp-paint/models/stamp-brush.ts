// stamp-brush.ts: the normalized brush a stamp painting deposits with. A brush is a stamp (its tip), a grain and the
// settings that place, size and fade each stamp along a stroke. Both importers, Procreate's (procreate-brush.ts) and
// Photoshop's (photoshop-brush.ts), translate their own fields into this one shape, so no importer's names or quirks
// reach a recipe or the renderer.
//
// Lengths are fractions of the stamp's diameter and angles are radians, so a brush means the same at any size.

/**
 * An image among a style's imported assets: `work/styles/<style>/brushes/<pack>/<file>`, where `file` is as the
 * pack's manifest lists it. Whole, so a painting that uses two styles names each image without doubt. Dark is paint.
 */
export type StampBrushAsset = { style: string; pack: string; file: string };

export type StampBlend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'colorBurn';

/**
 * How a grain's paint v cuts a coverage a (each 0..1, v 1 keeps paint) at depth d, by the grain's `formula`
 * (coverage-formulas.ts has both). As a `texture`, Photoshop's texture modes, identified from its captures (vid-97):
 * `multiply` a(1 − d(1 − v)), `subtract` a − v mixed in by d, `linearBurn` a − d(1 − v), `darken` min(a, 1 − d(1 − v)),
 * `overlay` a as base, `colorDodge` and `colorBurn` with v scaled by depth, `hardMix` 4a + 3dv − 3, and `height` and
 * `linearHeight` the grain as a relief 12da deep; `lighten` and `divide`, no Photoshop mode, as layers. As a `layer`,
 * each is its layer formula with a as base, mixed back toward a by depth, and `height` and `linearHeight` a relief the
 * paint fills from its deepest point up to a, with a crisp waterline or a soft one.
 */
export type StampGrainBlend = 'multiply' | 'subtract' | 'linearBurn' | 'colorDodge' | 'colorBurn' | 'darken' | 'lighten' | 'overlay' | 'divide' | 'hardMix' | 'height' | 'linearHeight';

export type StampBrushTip = {
  image: StampBrushAsset;
  /** Height over width of the stamp, (0, 1]: 1 keeps the image's own proportions, less squashes it across the stroke. */
  roundness: number;
  /**
   * How the image is resampled as a stamp shrinks it: `anisotropic`, as Photoshop resamples a squashed tip, so squashing
   * blurs it only across the squash; `isotropic`, at the level its more-shrunk side reads, as vid-89 read Procreate's.
   */
  sampling: 'anisotropic' | 'isotropic';
  /**
   * The image's width over the stamp's diameter, 1 when left out. More when the tip's soft edge reaches past its
   * diameter, as a Photoshop computed tip's does; spacing and size still go by the diameter.
   */
  span?: number;
  /**
   * The point of the image, as shares of its width and height, that lands on the stamp's place: its middle when left
   * out. Photoshop centres a sample on its middle texel, which in an even width is half a texel past the middle.
   */
  center?: readonly [number, number];
};

export type StampBrushGrain = {
  image: StampBrushAsset;
  /** The grain image's size over the stamp's diameter. */
  scale: number;
  /**
   * `rolling` moves the grain with each stamp, as a textured tip does; `texturized` fixes it to the canvas, so every
   * stamp reveals the same field, as paper tooth does.
   */
  mode: 'rolling' | 'texturized';
  /** How strongly the grain cuts into the stamp, 0..1. */
  depth: number;
  blend: StampGrainBlend;
  /** Which formulas `blend` names: depth inside a `texture` mode's formula, or a `layer` blend mixed back by depth. */
  formula: StampBlendFormula;
  /**
   * The grain's paint is raised by `brightness` (-1..1) and pushed from its pivot by `contrast` (-1..1, 0 as drawn):
   * below 0 it flattens by (1 + contrast), above 0 it steepens by 1 / (1 − contrast). About `midGrey` it's Photoshop's
   * pattern adjustment: flattened then brightened, or brightened then steepened, all but a threshold at 1. About the
   * grain's `mean` paint (its smallest mip) it's stretched then brightened, so a contrasty grain keeps its overall tone.
   */
  brightness: number;
  contrast: number;
  contrastPivot: 'midGrey' | 'mean';
  /**
   * How the image repeats: `repeat` as drawn, showing any seam, as Photoshop's patterns do; `mirror` flipped every
   * other tile, so a grain that isn't seamless never shows one, as vid-89 read Procreate's.
   */
  tiling: 'repeat' | 'mirror';
  /** How far each deposit shifts the grain, at random, as a share of its tile: 0 lays every stroke on the same patch. */
  offsetJitter: number;
  /**
   * A rolling grain's reading of each stamp. `zoom`: 1 grows its tile with the stamp's own size, 0 keeps the size it
   * has at the deposit's diameter. `movement`: 1 keeps it still on the canvas, each stamp showing the patch under it;
   * 0 carries one patch along with every stamp (between, it slides). `rotation`: how far it turns with the stroke's direction, 0..1. A texturized grain ignores all three.
   */
  zoom: number;
  movement: number;
  rotation: number;
};

/**
 * Wet edges as Photoshop paints them, on the built coverage c before the stroke's opacity: 2·peak·c up to half
 * coverage, then easing down to `body` at full, so paint reads darkest where it thins, along its outline, and a
 * stroke laid over itself never passes `peak`.
 */
export type StampBrushPooling = { peak: number; body: number };

/**
 * Pigment a wet glaze gathers at the rim of its own deposit as it dries, `width` in from the outline as a fraction of
 * the stamp's radius, darkening it by up to `rim` (0..1) over the body. The body keeps its density: a wash reads pale
 * inside its rim only when something else (its flow, its dual) keeps it pale. `sharpness` is how steeply the rim
 * rises where the deposit's coverage stands above its blur `width` wide: higher keeps it a crisp line at the outline.
 */
export type StampBrushWetEdge = { width: number; rim: number; sharpness: number };

/**
 * A rim, `width` in from the deposit's outline as a fraction of its radius, that darkens paint already there, the
 * group's or the deposit's own: `strength` (0..1) of the deposit's paint laid over it by `blend` along the rim, as a
 * stamp's edge burns into the paint it lands on. `sharpness` as a wet edge's.
 */
export type StampBrushBurntEdge = { width: number; strength: number; sharpness: number; blend: StampBlend };

/** How one brush lays its stamps: everything but its name and what it does to a whole stroke. */
export type StampBrushStamping = {
  tip: StampBrushTip;
  grain?: StampBrushGrain;
  /** Distance between stamps along a stroke. Below about 0.05, stamps pile up faster than they read. */
  spacing: number;
  /**
   * How steps are measured. `spread`: in the deposit's diameter, evened out so a stamp lands on each end. `eachStamp`:
   * each step is the spacing of the stamp it leaves, at that stamp's own size (never under a pixel), from a stamp on
   * the first point to the last whole step before the end, as Photoshop steps: a thinning stroke's stamps close up.
   */
  stepping: 'spread' | 'eachStamp';
  /**
   * Each stamp's random variation, 0..1: sideways offset (in diameters), size and opacity lost, `flow` lost (as a
   * wetter or drier stamp lays less paint, independently of opacity), and `roundness` lost, a share of the tip's own
   * that squashes the stamp across its length without moving the next step.
   */
  jitter: { lateral: number; size: number; opacity: number; flow: number; roundness: number };
  /**
   * `count` stamps at each spacing step, each offset a random way by a uniformly random distance up to `radius`
   * diameters, so they crowd the stroke; `countJitter` (0..1) drops up to that share of them at random, step by step.
   * `countPressure` (0..1) is how far pressure thins them: a step keeps the whole stamps of count × its pressured share.
   */
  scatter: { count: number; countJitter: number; countPressure: number; radius: number };
  /**
   * `angle` turns every stamp; `follow` (-1..1) turns it with the stroke's direction (against it when negative),
   * unwrapped along the stroke so a partial follow never jumps; `jitter` turns each at random; `randomStart` turns a
   * whole deposit by a random angle.
   */
  rotation: { angle: number; follow: number; jitter: number; randomStart: boolean };
  /** Whether each stamp is flipped across its width (`x`) or its length (`y`) at random, one in two. */
  flip: { x: boolean; y: boolean };
  /** How blurred each stamp is, 0..1 (1 about a sixteenth of its size), and up to how much of that `jitter` takes away. */
  blur: { amount: number; jitter: number };
  /**
   * The stroke's first `start` and last `end` fractions of its length ease in from `size` and `opacity` (each 0..1 of
   * full) to full, so a stroke starts and lifts off without a hard stamp at either end. `shape` (0..1) bends the ease
   * so the taper holds its width longer and narrows at the tip. `pressure` (0..1) is how far the taper stands in for the
   * stroke's own pressure: at 0 the pressure shows through the taper, at 1 the taper alone sets size and opacity.
   */
  taper: { start: number; end: number; size: number; opacity: number; shape: number; pressure: number };
  /**
   * How fast a stroke fades along its length, 0..1: its paint keeps (1 − falloff) of itself every ten diameters
   * travelled, so a small falloff fades a long stroke gently.
   */
  falloff: number;
  /** How much of each stamp's paint lands, 0..1. */
  flow: number;
  /**
   * How far a stroke's pressure moves each stamp's size, opacity, flow and roundness, 0..1: 0 ignores pressure. Opacity
   * and flow multiply, so a brush can thin by pressure through either; roundness squashes the stamp as its jitter does.
   */
  pressure: { size: number; opacity: number; flow: number; roundness: number };
};

/**
 * How a brush's colour varies from its deposit's, each 0..1: hue (as a share of the colour wheel), saturation,
 * lightening and darkening. `stamp` varies each stamp at random, `stroke` the whole deposit at random, and `pressure`
 * moves each stamp by how light its pressure is; `pressure.secondary` blends toward the deposit's secondary colour.
 */
export type StampBrushColorDynamics = {
  stamp: { hue: number; saturation: number; lightness: number; darkness: number };
  stroke: { hue: number; saturation: number; lightness: number; darkness: number };
  pressure: { hue: number; saturation: number; lightness: number; secondary: number };
};

/** A brush's own stamps and how they pool: all of a brush but its name and its dual. */
export type StampBrushLayer = StampBrushStamping & {
  /**
   * How a stroke's own stamps combine. `glaze`: where they overlap each other they darken only as far as `glazeBuild`
   * lets them, so the stroke reaches at most a stamp's full paint, and only a later stroke builds on it. `build`: each
   * stamp lays its flow × opacity over the ones before, so overlaps darken toward full paint without limit.
   * `buildToOpacity`, as Photoshop builds: each stamp lays its flow over the ones before, toward its own opacity, and
   * never lowers what's there, so overlaps darken up to the highest opacity a stamp brought.
   */
  accumulation: 'glaze' | 'build' | 'buildToOpacity';
  /**
   * How far a glaze's overlapping stamps build within the stroke, 0 to 1 (0 by default): at 0 an overlap is as dark as
   * its darkest stamp; at 1 stamps lay over each other up to a stamp's paint before its tip (its flow through its grain).
   */
  glazeBuild?: number;
  wetEdge?: StampBrushWetEdge;
  pooling?: StampBrushPooling;
  burntEdge?: StampBrushBurntEdge;
};

/**
 * How a dual brush's coverage s combines with the main brush's grained coverage p, by the dual's `formula`. As a
 * `texture`, Photoshop's modes, identified from its captures (vid-97): its texture formulas at full depth with s as the
 * pattern (`multiply`, `darken`, `overlay`, `colorBurn`, `linearBurn`, `colorDodge`, `hardMix`), and `linearHeight` an
 * overlay of p by 1 − s, each painting nothing where p has none; `normal`, `screen`, `lighten` and `difference` as
 * layers. As a `layer`, each is its layer formula with p as base, held to where p has paint, and `linearHeight` the
 * dual as a relief p's stamps fill, which shapes p before its grain cuts it.
 */
export type StampDualBlend = StampBlend | 'difference' | 'linearHeight' | 'linearBurn' | 'colorDodge' | 'hardMix';

/**
 * Which formulas a grain's or dual's blend names. `texture`: Photoshop's texture modes, depth inside each formula.
 * `layer`: the layer blend of that name, mixed back toward the coverage by depth, as vid-89 read Procreate's.
 */
export type StampBlendFormula = 'texture' | 'layer';

/**
 * Paint a brush takes up from the canvas and mixes into its own as it paints, each 0..1: `load`, how much paint it
 * carries before it runs dry; `wetness`, how much of the paint under it it takes up; `mix`, the share of taken-up paint
 * in what it lays. `sampleAllLayers` takes paint up from everything under it, not only its own deposit's layer.
 * Carried from the source but not yet painted: the renderer mixes pigment only between deposits (vid-90).
 */
export type StampBrushWetMix = { load: number; wetness: number; mix: number; sampleAllLayers: boolean };

export type StampBrush = StampBrushLayer & {
  /** Its name in its pack, as the manifest keys it. Part of no seed: renaming a brush changes no painting's randomness. */
  name: string;
  /** The blend a deposit paints in unless it states its own. */
  blend: StampBlend;
  /** How its colour varies stamp to stamp and stroke to stroke; none when left out. */
  color?: StampBrushColorDynamics;
  /**
   * A second, whole brush stamped along the same stroke and combined with the first by `blend`, only where the first
   * has paint: a dry, broken texture inside the main shape. It places its stamps by its own settings, pools by its own
   * edges and accumulation, and its stamps are `scale` times the main brush's diameter.
   */
  dual?: StampBrushLayer & { blend: StampDualBlend; formula: StampBlendFormula; scale: number };
  wetMix?: StampBrushWetMix;
};
