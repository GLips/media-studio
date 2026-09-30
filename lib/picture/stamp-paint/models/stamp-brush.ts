// stamp-brush.ts: the normalized brush a stamp painting deposits with. A brush is a stamp (its tip), a grain and the
// settings that place, size and fade each stamp along a stroke. Both importers, Procreate's (procreate-brush.ts) and
// Photoshop's (photoshop-brush.ts), translate their own fields into this one shape, so no importer's names or quirks
// reach a recipe or the renderer.
//
// Lengths are fractions of the stamp's diameter and angles are radians, so a brush means the same at any size.
//
// A brush is generic in its images: as imported, each is a StampBrushAsset; a renderer binds each to what it samples
// (bindStampBrushImages), so a grain's image travels with the grain's settings and nothing looks it up apart.

/**
 * An image among a style's imported assets: `work/styles/<style>/brushes/<pack>/<file>`, where `file` is as the
 * pack's manifest lists it. Whole, so a painting that uses two styles names each image without doubt. Dark is paint.
 */
export type StampBrushAsset = { style: string; pack: string; file: string };

export type StampBlend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'colorBurn';

/**
 * How a grain's paint v cuts a coverage a (each 0..1, v 1 keeps paint) at depth d (coverage-formulas.ts has each
 * formula). `texture`: Photoshop's texture modes, identified from its captures (vid-97), depth inside each formula:
 * `multiply` a(1 − d(1 − v)), `subtract` a − v mixed in by d, `linearBurn` a − d(1 − v), `darken` min(a, 1 − d(1 − v)),
 * `overlay` a as base, `colorDodge` and `colorBurn` with v scaled by depth, `hardMix` 4a + 3dv − 3, and `height` and
 * `linearHeight` the grain as a relief 12da deep. `layer`: the layer blends vid-89 fitted Procreate's grains with, a as
 * base, mixed back toward a by depth; `height` and `linearHeight` a relief the paint fills from its deepest point up to
 * a, with a crisp waterline or a soft one.
 */
export type StampGrainBlend =
  | { family: 'texture'; mode: 'multiply' | 'subtract' | 'linearBurn' | 'colorDodge' | 'colorBurn' | 'darken' | 'overlay' | 'hardMix' | 'height' | 'linearHeight' }
  | { family: 'layer'; mode: 'multiply' | 'subtract' | 'linearBurn' | 'colorDodge' | 'colorBurn' | 'darken' | 'lighten' | 'divide' | 'hardMix' | 'height' | 'linearHeight' };

/**
 * How a dual brush's coverage s combines with the main brush's grained coverage p. `texture`: Photoshop's Dual Brush
 * modes, identified from its captures (vid-97), its texture formulas at full depth with s as the pattern, and
 * `linearHeight` an overlay of p by 1 − s, each painting nothing where p has none. `layer`: the layer blends vid-89
 * fitted Procreate's duals with, p as base, held to where p has paint; `linearHeight` the dual as a relief p's stamps
 * fill, which shapes p before its grain cuts it.
 */
export type StampDualBlend =
  | { family: 'texture'; mode: 'multiply' | 'darken' | 'overlay' | 'colorDodge' | 'colorBurn' | 'linearBurn' | 'hardMix' | 'linearHeight' }
  | { family: 'layer'; mode: 'normal' | 'multiply' | 'screen' | 'lighten' | 'difference' | 'colorBurn' | 'overlay' | 'darken' | 'linearHeight' };

export type StampBrushTip<Image = StampBrushAsset> = {
  image: Image;
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

/**
 * A grain: `canvas` is fixed to the canvas and cuts the built stroke, so every stamp reveals the same field, as paper
 * tooth does; `rolling` sits under each stamp and cuts it as it lands, as a textured tip does.
 */
export type StampBrushGrain<Image = StampBrushAsset> = StampGrainLook<Image> & (
  | { kind: 'canvas' }
  | {
    kind: 'rolling';
    /** 1 grows the grain's tile with the stamp's own size; 0 keeps the size it has at the deposit's diameter. */
    zoom: number;
    /** 1 keeps it still on the canvas, each stamp showing the patch under it; 0 carries one patch along (between, it slides). */
    movement: number;
    /** How far it turns with the stroke's direction, 0..1. */
    rotation: number;
  }
);

/** What a grain is, however it's laid. */
export type StampGrainLook<Image = StampBrushAsset> = {
  image: Image;
  /** The grain image's size over the stamp's diameter. */
  scale: number;
  /** How strongly the grain cuts into the stamp, 0..1. */
  depth: number;
  blend: StampGrainBlend;
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
};

/**
 * Wet edges, as either app paints them. `pooling`, Photoshop's, on the built coverage c before the stroke's opacity:
 * 2·peak·c up to half coverage, then easing down to `body` at full, so paint reads darkest where it thins, along its
 * outline, and a stroke laid over itself never passes `peak`. `rim`, Procreate's: pigment a wet glaze gathers at the
 * rim of its own deposit as it dries, `width` in from the outline as a fraction of the stamp's radius, darkening it by
 * up to `rim` (0..1) over the body, which keeps its density. `sharpness` is how steeply the rim rises where the
 * deposit's coverage stands above its blur `width` wide: higher keeps it a crisp line at the outline.
 */
export type StampBrushWetEdges = { kind: 'pooling'; peak: number; body: number } | { kind: 'rim'; width: number; rim: number; sharpness: number };

/**
 * A rim, `width` in from the deposit's outline as a fraction of its radius, that darkens paint already there, the
 * group's or the deposit's own: `strength` (0..1) of the deposit's paint laid over it by `blend` along the rim, as a
 * stamp's edge burns into the paint it lands on. `sharpness` as a wet edge's.
 */
export type StampBrushBurntEdge = { width: number; strength: number; sharpness: number; blend: StampBlend };

/** How one brush lays its stamps: everything but its name and what it does to a whole stroke. */
export type StampBrushStamping<Image = StampBrushAsset> = {
  tip: StampBrushTip<Image>;
  grain?: StampBrushGrain<Image>;
  /** Distance between stamps along a stroke. Below about 0.05, stamps pile up faster than they read. */
  spacing: number;
  /**
   * How steps are measured. `spread`: in the deposit's diameter, evened out so a stamp lands on each end. `eachStamp`:
   * each step is the spacing of the stamp it leaves, at that stamp's own size (never under a pixel), from a stamp on
   * the first point to the last whole step before the end, as Photoshop steps: a thinning stroke's stamps close up.
   */
  stepping: 'spread' | 'eachStamp';
  /** How each stamp's size, opacity, flow, roundness and turn, and each step's count, answer the stroke (StampDynamics). */
  dynamics: StampDynamics;
  /**
   * `count` stamps at each spacing step, before its count dynamics keep fewer, each offset a random way by a uniformly
   * random distance up to `radius` diameters, so they crowd the stroke, and across the stroke at random by up to
   * `lateral` diameters either way.
   */
  scatter: { count: number; radius: number; lateral: number };
  /**
   * The turn every stamp starts from, before its rotation dynamics: `angle`, and with `randomStart` a random angle
   * drawn once for the whole deposit.
   */
  // randomStart isn't a dynamic: it's one draw per deposit, always over the whole circle, where a dynamic reads each
  // stamp or step. A sensor for it would carry a deposit's stream in every stamp's context for one boolean.
  rotation: { angle: number; randomStart: boolean };
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
};

/**
 * What each target can be driven by. A scale target keeps a share of its own: a stamp's `size`, `opacity`, `flow`
 * (which multiply with opacity, as a wetter or drier stamp lays less paint) and `roundness` (a share of the tip's, which
 * squashes the stamp without moving the next step), and a step's `count` of stamps. An angle target, `rotation`, turns
 * each stamp by radians. A sensor is added to a target here, and read in stamp-dynamics.ts.
 */
export type StampTargetSensors = {
  size: 'pressure' | 'random';
  opacity: 'pressure' | 'random';
  flow: 'pressure' | 'random';
  roundness: 'pressure' | 'random';
  count: 'pressure' | 'random';
  rotation: 'direction' | 'random';
};
export type StampDynamicTarget = keyof StampTargetSensors;
export type StampAngleTarget = 'rotation';
export type StampScaleTarget = Exclude<StampDynamicTarget, StampAngleTarget>;
export type StampSensor = StampTargetSensors[StampDynamicTarget];

/**
 * A curve's control points, input to output, sorted by input: read piecewise-linearly between them and held flat past
 * the first and the last.
 */
export type StampResponseCurve = readonly (readonly [input: number, output: number])[];

/**
 * How a scale target answers its sensor's signal s (0..1, how far the sensor takes it from full; stamp-dynamics.ts):
 * `linear` keeps 1 − amount × s of it, `curve` keeps the curve at s.
 */
export type StampScaleResponse = { kind: 'linear'; amount: number } | { kind: 'curve'; points: StampResponseCurve };

/**
 * How an angle target answers its sensor's signal (radians for `direction`, −1..1 for `random`): `linear` turns by
 * amount × the signal, `curve` by the curve at it, in radians.
 */
export type StampAngleResponse = { kind: 'linear'; amount: number } | { kind: 'curve'; points: StampResponseCurve };

export type StampResponseFor<T extends StampDynamicTarget> = T extends StampAngleTarget ? StampAngleResponse : StampScaleResponse;

/**
 * Each sensor's own parameters, which its binding carries beside the response and its signal reads (stamp-dynamics.ts).
 * None of today's sensors has any; a sensor that needs one declares it here, as Photoshop's fade (vid-105) would
 * `{ steps: number }`, the count of steps its signal runs full over.
 */
export type StampSensorParams = { pressure: Record<never, never>; random: Record<never, never>; direction: Record<never, never> };

/** One target's binding to one sensor: how the target answers it, and the sensor's own parameters. */
export type StampBinding<T extends StampDynamicTarget, S extends StampSensor> = StampResponseFor<T> & StampSensorParams[S];

/**
 * A brush's dynamics: at most one binding per target and sensor. Bindings of one target compose, in a fixed sensor
 * order: a scale target keeps the product of each binding's share (pressure × random), save count, which keeps whole
 * stamps binding by binding; an angle target turns by the sum of each binding's angle (direction + random).
 */
export type StampDynamics = { readonly [T in StampDynamicTarget]?: { readonly [S in StampTargetSensors[T]]?: StampBinding<T, S> } };

/** Every target, and each target's sensors, in the one order a brush's dynamics are written and composed in. */
const STAMP_TARGET_SENSORS: { readonly [T in StampDynamicTarget]: readonly StampTargetSensors[T][] } = {
  size: ['pressure', 'random'],
  opacity: ['pressure', 'random'],
  flow: ['pressure', 'random'],
  roundness: ['pressure', 'random'],
  count: ['pressure', 'random'],
  rotation: ['direction', 'random'],
};
const STAMP_DYNAMIC_TARGETS: readonly StampDynamicTarget[] = ['size', 'opacity', 'flow', 'roundness', 'count', 'rotation'];

/**
 * A brush's dynamics from linear amounts by target and sensor, written in one order so two brushes that answer alike
 * compare equal; an amount of 0 is no binding, and a target with none is left out.
 */
export function stampLinearDynamics(amounts: { readonly [T in StampDynamicTarget]?: { readonly [S in StampTargetSensors[T]]?: number } }): StampDynamics {
  const dynamics: Record<string, Record<string, { kind: 'linear'; amount: number }>> = {};
  for (const target of STAMP_DYNAMIC_TARGETS) {
    const by: Partial<Record<StampSensor, number>> = amounts[target] ?? {};
    for (const sensor of STAMP_TARGET_SENSORS[target]) {
      const amount = by[sensor] ?? 0;
      if (amount) (dynamics[target] ??= {})[sensor] = { kind: 'linear', amount };
    }
  }
  return dynamics;
}

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

/**
 * How a stroke's own stamps combine. `glaze`: where they overlap each other they darken only as far as `build` (0..1)
 * lets them: at 0 an overlap is as dark as its darkest stamp, at 1 stamps lay over each other up to a stamp's paint
 * before its tip (its flow through its grain), so the stroke reaches at most that, and only a later stroke builds on
 * it. `build`: each stamp lays its flow × opacity over the ones before, so overlaps darken toward full paint without
 * limit. `buildToOpacity`, as Photoshop builds: each stamp lays its flow over the ones before, toward its own opacity,
 * and never lowers what's there, so overlaps darken up to the highest opacity a stamp brought.
 */
export type StampAccumulation = { kind: 'glaze'; build: number } | { kind: 'build' } | { kind: 'buildToOpacity' };

/** A brush's own stamps and how they pool: all of a brush but its name and its dual. */
export type StampBrushLayer<Image = StampBrushAsset> = StampBrushStamping<Image> & {
  accumulation: StampAccumulation;
  wetEdges?: StampBrushWetEdges;
  burntEdge?: StampBrushBurntEdge;
};

export type StampBrush<Image = StampBrushAsset> = StampBrushLayer<Image> & {
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
  dual?: StampBrushLayer<Image> & { blend: StampDualBlend; scale: number };
};

/** `layer` with its tip's and grain's images bound by `bind`, the rest as it is. */
function bindLayerImages<A, B, L extends StampBrushLayer<A>>(layer: L, bind: (image: A) => B): Omit<L, 'tip' | 'grain'> & StampBrushLayer<B> {
  const { tip, grain, ...rest } = layer;
  return { ...rest, tip: { ...tip, image: bind(tip.image) }, ...(grain && { grain: { ...grain, image: bind(grain.image) } }) };
}

/** `brush` with each of its images, and its dual's, bound by `bind` to what a renderer samples. */
export function bindStampBrushImages<A, B>(brush: StampBrush<A>, bind: (image: A) => B): StampBrush<B> {
  const { dual, ...main } = brush;
  return { ...bindLayerImages(main, bind), ...(dual && { dual: bindLayerImages(dual, bind) }) };
}

/**
 * A setting of a source brush the normalized brush doesn't carry as the source means it: `approximated` is read into
 * a nearby setting, `unsupported` is dropped, and `inapplicable` is dropped because a painting never has what it
 * responds to (a pen's tilt). `unprobed`: a Photoshop setting at a value vid-97's probes never gave it, so the
 * pipeline wasn't identified there. `setting` is the source format's own field name, so it can be looked up.
 */
export type StampBrushSupportNote = { level: 'approximated' | 'unsupported' | 'inapplicable' | 'unprobed'; setting: string; detail: string };
