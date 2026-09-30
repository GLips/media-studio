// stamp-brush.ts: the normalized brush a stamp painting deposits with: a tip, a grain and the settings that place,
// size and fade each stamp along a stroke. The Procreate and Photoshop importers (procreate-brush.ts,
// photoshop-brush.ts) translate into this shape, so no importer's quirks reach a recipe or the renderer.
//
// Lengths are fractions of the stamp's diameter and angles are radians, so a brush means the same at any size.
//
// Imported, each image is a StampBrushAsset; a renderer binds each to what it samples (bindStampBrushImages), so a
// grain's image travels with its settings. A bristle tip is no image until then: it's drawn at the deposit's diameter.

import { drawStampBristleTip, STAMP_BRISTLE_CONTACT_RANGE, stampBristleTipSpan, type StampBristleTip } from './stamp-bristle-tip.ts';

/**
 * An image among a style's assets: `work/styles/<style>/brushes/<pack>/<file>`, `file` as the pack's manifest lists
 * it. Whole, so a painting using two styles names each image without doubt. Dark is paint.
 */
export type StampBrushAsset = { style: string; pack: string; file: string };

export type StampBlend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'colorBurn';

/**
 * How a grain's paint v (1 keeps paint) cuts coverage a at depth d; coverage-formulas.ts has the formulas.
 * `texture`: Photoshop's modes, identified from captures, depth inside each formula. `layer`: blends fitted to
 * Procreate's grains, a as base, mixed toward a by depth. Heights are a relief: `texture`'s 12da deep, `layer`'s
 * filled from its deepest point up to a.
 */
export type StampGrainBlend =
  | { family: 'texture'; mode: 'multiply' | 'subtract' | 'linearBurn' | 'colorDodge' | 'colorBurn' | 'darken' | 'overlay' | 'hardMix' | 'height' | 'linearHeight' }
  | { family: 'layer'; mode: 'multiply' | 'subtract' | 'linearBurn' | 'colorDodge' | 'colorBurn' | 'darken' | 'lighten' | 'divide' | 'hardMix' | 'height' | 'linearHeight' };

/**
 * How a dual's coverage s combines with the main brush's grained coverage p, never painting where p has none.
 * `texture`: Photoshop's Dual Brush modes, its texture formulas at full depth, s the pattern; `linearHeight` overlays
 * p by 1 − s. `layer`: blends fitted to Procreate's duals, p as base; `linearHeight` a relief p's stamps fill,
 * shaping p before its grain.
 */
export type StampDualBlend =
  | { family: 'texture'; mode: 'multiply' | 'darken' | 'overlay' | 'colorDodge' | 'colorBurn' | 'linearBurn' | 'hardMix' | 'linearHeight' }
  | { family: 'layer'; mode: 'normal' | 'multiply' | 'screen' | 'lighten' | 'difference' | 'colorBurn' | 'overlay' | 'darken' | 'linearHeight' };

/** A tip as a renderer samples it: an image, and a pressed tip's contact. */
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
  /**
   * How far each stamp's paint is broken into per-pixel noise, 0..1, none when left out: fresh in every stamp, so it
   * averages out where stamps pile up and shows at a stroke's soft edge (tipNoise).
   */
  noise?: number;
  /**
   * Each stamp's diameter in canvas pixels, whatever the deposit's diameter or its size dynamics, as an airbrush's
   * grains are; the deposit's diameter still sets its spacing and scatter.
   */
  pixels?: number;
  /**
   * A tip that touches the paper as it's pressed, as a bristle or erodible tip does: each texel lays its paint once the
   * stamp's pressure passes its contact (pressedTip), over a ramp `softness` wide. `contact`'s paint reads the contact
   * down from `range`'s high end to its low; with `diameter`, contacts grow with the stamp's diameter over it.
   */
  pressed?: { contact: Image; range: readonly [lo: number, hi: number]; softness: number; diameter?: number };
};

/**
 * A tip of bristles (stamp-bristle-tip.ts), held as its drawing rule: a renderer binds it at each deposit's diameter
 * into an image tip, since its bristles keep their pixel width at every size. A stamp its dynamics size away from the
 * deposit's diameter scales the image drawn at that diameter.
 */
export type StampBristleBrushTip = Pick<StampBrushTip, 'roundness' | 'sampling'> & { bristles: StampBristleTip };

/** A brush layer's tip: an image, or, until a renderer binds it at a diameter (bindStampBrushImages), bristles. */
export type StampLayerTip<Image = StampBrushAsset> = StampBrushAsset extends Image ? StampBrushTip<Image> | StampBristleBrushTip : StampBrushTip<Image>;

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
   * The grain's paint is raised by `brightness` (-1..1) and pushed from its pivot by `contrast` (-1..1): below 0
   * flattened by (1 + contrast), above 0 steepened by 1 / (1 − contrast). About `midGrey`, Photoshop's pattern
   * adjustment: flattened then brightened, or brightened then steepened, a threshold at 1. About the grain's `mean`
   * (smallest mip), stretched then brightened, keeping its tone.
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
 * Wet edges. `pooling`, Photoshop's, on built coverage c before opacity: 2·peak·c to half coverage, easing to
 * `body` at full, so paint is darkest where it thins and never passes `peak`. `rim`, Procreate's: pigment a drying
 * glaze gathers `width` (of the radius) in from the outline, up to `rim` darker. `sharpness`: its rise where
 * coverage exceeds its `width`-wide blur.
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
  tip: StampLayerTip<Image>;
  grain?: StampBrushGrain<Image>;
  /** Distance between stamps along a stroke. Below about 0.05, stamps pile up faster than they read. */
  spacing: number;
  /**
   * How steps are measured. `spread`: in the deposit's diameter, evened out so a stamp lands on each end. `eachStamp`,
   * as Photoshop steps: each step is the spacing of the stamp it leaves at its own size (never under a pixel), from the
   * first point to the last whole step before the end, so a thinning stroke's stamps close up.
   */
  stepping: 'spread' | 'eachStamp';
  /** How each stamp's size, opacity, flow, roundness and turn, and each step's count, answer the stroke (StampDynamics). */
  dynamics: StampDynamics;
  /**
   * `count` stamps at each spacing step, before its count dynamics keep fewer (or, by random, more), each offset a
   * random way by a uniformly random distance up to `radius` diameters, so they crowd the stroke, and across the stroke
   * at random by up to `lateral` diameters either way.
   */
  scatter: {
    count: number; radius: number; lateral: number;
    /** A uniform draw to the share of `radius` a stamp strays, so stamps can fill a disc evenly, as a spray does. */
    distribution?: StampResponseCurve;
    /** The count is at `diameter` px, and grows as (the deposit's diameter / `diameter`)^`exponent`. */
    countGrowth?: { diameter: number; exponent: number };
    /**
     * What `radius` and `lateral` count in: the deposit's diameter (unset), or each stamp's own, after pressure, taper
     * and its size draw, so a smaller stamp strays less (Photoshop's).
     */
    reachIn?: 'stamp';
  };
  /**
   * The turn every stamp starts from, before its rotation dynamics: `angle`, plus with `randomStart` a random angle
   * drawn once per deposit.
   */
  // randomStart isn't a dynamic, which reads each stamp or step: as a sensor it would carry a deposit's stream in
  // every stamp's context for one boolean.
  rotation: { angle: number; randomStart: boolean };
  /** Whether each stamp is flipped across its width (`x`) or its length (`y`) at random, one in two. */
  flip: { x: boolean; y: boolean };
  /** How blurred each stamp is, 0..1 (1 about a sixteenth of its size), and up to how much of that `jitter` takes away. */
  blur: { amount: number; jitter: number };
  /**
   * The stroke's first `start` and last `end` fractions ease from `size` and `opacity` (0..1 of full) to full, so
   * it lifts off without a hard stamp. `shape` (0..1) bends the ease to hold width longer. `pressure` (0..1): how
   * far the taper replaces the stroke's pressure, 0 showing it through, 1 the taper alone.
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
 * What each target can be driven by. A scale target keeps a share of itself: `size`, `opacity`, `flow` (multiplying
 * with opacity), `roundness` (not moving the next step), a step's `count`, `scatter` (its reach) and `grainDepth` (how
 * much of a rolling grain's cut a stamp takes; a canvas grain cuts the built stroke). `rotation` turns by radians;
 * stamp-dynamics.ts reads sensors.
 */
export type StampTargetSensors = {
  size: 'pressure' | 'fade' | 'random';
  opacity: 'pressure' | 'fade' | 'random';
  flow: 'pressure' | 'fade' | 'random';
  roundness: 'pressure' | 'fade' | 'random';
  count: 'pressure' | 'fade' | 'random';
  scatter: 'pressure' | 'fade';
  grainDepth: 'pressure' | 'fade' | 'random';
  rotation: 'direction' | 'initialDirection' | 'pressure' | 'fade' | 'random';
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
 * How an angle target answers its sensor's signal (radians for `direction` and `initialDirection`, −1..1 for
 * `random`, 0..1 for `pressure` and `fade`): `linear` turns by amount × the signal, `curve` by the curve at it, in radians.
 */
export type StampAngleResponse = { kind: 'linear'; amount: number } | { kind: 'curve'; points: StampResponseCurve };

export type StampResponseFor<T extends StampDynamicTarget> = T extends StampAngleTarget ? StampAngleResponse : StampScaleResponse;

/**
 * Each sensor's own parameters, which its binding carries beside the response and its signal reads (stamp-dynamics.ts):
 * `fade`'s `steps`, the count of spacing steps its signal runs full over.
 */
export type StampSensorParams = {
  pressure: Record<never, never>;
  fade: { steps: number };
  /**
   * `around`: the draw spreads a size or count either side of what the stroke gives it, by 1 + amount × (2u − 1),
   * where it would only take it down: a size past the deposit's diameter folds back under it, and a count reaches
   * twice its own (Photoshop's jitter, the `random size jitter …` and `random count …` probes).
   */
  random: { around?: boolean };
  direction: Record<never, never>;
  initialDirection: Record<never, never>;
};

/** One target's binding to one sensor: how the target answers it, and the sensor's own parameters. */
export type StampBinding<T extends StampDynamicTarget, S extends StampSensor> = StampResponseFor<T> & StampSensorParams[S];

/**
 * A brush's dynamics: at most one binding per target and sensor. Bindings of one target compose, in a fixed sensor
 * order: a scale target keeps the product of each binding's share (pressure × fade × random), save count, which keeps
 * whole stamps binding by binding; an angle target turns by the sum of each binding's angle.
 */
export type StampDynamics = { readonly [T in StampDynamicTarget]?: { readonly [S in StampTargetSensors[T]]?: StampBinding<T, S> } };

/** Every target, and each target's sensors, in the one order a brush's dynamics are written and composed in. */
const STAMP_TARGET_SENSORS: { readonly [T in StampDynamicTarget]: readonly StampTargetSensors[T][] } = {
  size: ['pressure', 'fade', 'random'],
  opacity: ['pressure', 'fade', 'random'],
  flow: ['pressure', 'fade', 'random'],
  roundness: ['pressure', 'fade', 'random'],
  count: ['pressure', 'fade', 'random'],
  scatter: ['pressure', 'fade'],
  grainDepth: ['pressure', 'fade', 'random'],
  rotation: ['direction', 'initialDirection', 'pressure', 'fade', 'random'],
};
const STAMP_DYNAMIC_TARGETS: readonly StampDynamicTarget[] = ['size', 'opacity', 'flow', 'roundness', 'count', 'scatter', 'grainDepth', 'rotation'];

/** Bindings by target and sensor, any left out or undefined: what stampDynamicsOf writes in order. */
export type StampDynamicsBindings = { readonly [T in StampDynamicTarget]?: { readonly [S in StampTargetSensors[T]]?: StampBinding<T, S> | undefined } };

/**
 * A brush's dynamics from its bindings, written in one order so two brushes that answer alike compare equal; a
 * linear binding of amount 0 is no binding, and a target with none is left out.
 */
export function stampDynamicsOf(bindings: StampDynamicsBindings): StampDynamics {
  const dynamics: Record<string, Record<string, StampBinding<StampDynamicTarget, StampSensor>>> = {};
  for (const target of STAMP_DYNAMIC_TARGETS) {
    const by: Partial<Record<StampSensor, StampBinding<StampDynamicTarget, StampSensor>>> = bindings[target] ?? {};
    for (const sensor of STAMP_TARGET_SENSORS[target]) {
      const binding = by[sensor];
      if (binding && !(binding.kind === 'linear' && !binding.amount)) (dynamics[target] ??= {})[sensor] = binding;
    }
  }
  return dynamics;
}

/** Linear amounts by target and sensor, for the sensors that take no parameters. */
type StampLinearAmounts = { readonly [T in StampDynamicTarget]?: { readonly [S in Exclude<StampTargetSensors[T], 'fade'>]?: number } };

/** A brush's dynamics from linear amounts by target and sensor (stampDynamicsOf's order; an amount of 0 is none). */
export function stampLinearDynamics(amounts: StampLinearAmounts): StampDynamics {
  const bindings: Record<string, Record<string, { kind: 'linear'; amount: number }>> = {};
  for (const [target, by] of Object.entries(amounts)) {
    for (const [sensor, amount] of Object.entries(by ?? {})) (bindings[target] ??= {})[sensor] = { kind: 'linear', amount: amount ?? 0 };
  }
  return stampDynamicsOf(bindings);
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
 * How a stroke's own stamps combine. `glaze`: overlaps darken by `build` (0..1): at 0 to the darkest stamp, at 1 to
 * a stamp's paint before its tip (flow through grain); only a later stroke builds past. `build`: each lays
 * flow × opacity over the last, toward full. `buildToOpacity`, Photoshop's: each lays its flow toward its own
 * opacity, never lowering what's there.
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

/**
 * An image a bound brush samples that no pack holds: a bristle tip's footprint or contact, drawn at a deposit's
 * diameter. `key` names what's drawn and at what size, so a renderer draws and uploads each once; `draw` draws it,
 * `size` texels square, dark is paint.
 */
export type StampDrawnImage = { key: string; draw: () => { size: number; pixels: Uint8Array } };

/** An image a brush names, bound by a renderer to what it samples: a pack's asset, or one drawn for the deposit. */
export type StampBrushImageSource = StampBrushAsset | StampDrawnImage;

/** `tip` with its images bound by `bind`, a bristle tip drawn at `diameter`. */
function bindTipImages<B>(tip: StampLayerTip, diameter: number, bind: (image: StampBrushImageSource) => B): StampBrushTip<B> {
  if ('bristles' in tip) {
    const { bristles, ...look } = tip, key = `bristles|${JSON.stringify(bristles)}@${diameter}`;
    let drawn: ReturnType<typeof drawStampBristleTip> | undefined;
    const drawing = () => (drawn ??= drawStampBristleTip(bristles, diameter));
    return {
      ...look,
      image: bind({ key, draw: () => ({ size: drawing().size, pixels: drawing().image }) }),
      span: stampBristleTipSpan(bristles, diameter),
      pressed: { contact: bind({ key: `${key}|contact`, draw: () => ({ size: drawing().size, pixels: drawing().contact }) }), range: STAMP_BRISTLE_CONTACT_RANGE, softness: bristles.softness },
    };
  }
  const { pressed, ...plain } = tip;
  return { ...plain, image: bind(tip.image), ...(pressed && { pressed: { ...pressed, contact: bind(pressed.contact) } }) };
}

/** `layer` with its tip's and grain's images bound by `bind`, its tip at `diameter`, the rest as it is. */
function bindLayerImages<B, L extends StampBrushLayer>(layer: L, diameter: number, bind: (image: StampBrushImageSource) => B): Omit<L, 'tip' | 'grain'> & StampBrushLayer<B> {
  const { tip, grain, ...rest } = layer;
  return { ...rest, tip: bindTipImages(tip, diameter, bind), ...(grain && { grain: { ...grain, image: bind(grain.image) } }) };
}

/**
 * Every asset `brush` paints with, its dual's too, and how each wraps: a grain tiles, a tip or its contact doesn't. A
 * bristle tip has none: it's drawn as it's bound.
 */
export function stampBrushImages(brush: StampBrush): { image: StampBrushAsset; wrap: 'tile' | 'clamp' }[] {
  const images: { image: StampBrushAsset; wrap: 'tile' | 'clamp' }[] = [];
  for (const layer of brush.dual ? [brush, brush.dual] : [brush]) {
    if (!('bristles' in layer.tip)) {
      images.push({ image: layer.tip.image, wrap: 'clamp' });
      if (layer.tip.pressed) images.push({ image: layer.tip.pressed.contact, wrap: 'clamp' });
    }
    if (layer.grain) images.push({ image: layer.grain.image, wrap: 'tile' });
  }
  return images;
}

/**
 * `brush` with each of its images, and its dual's, bound by `bind` to what a renderer samples, for a deposit at
 * `diameter`: a bristle tip is drawn at it, its dual's at the dual's own.
 */
export function bindStampBrushImages<B>(brush: StampBrush, diameter: number, bind: (image: StampBrushImageSource) => B): StampBrush<B> {
  const { dual, ...main } = brush;
  return { ...bindLayerImages(main, diameter, bind), ...(dual && { dual: bindLayerImages(dual, diameter * dual.scale, bind) }) };
}

/**
 * A source brush's setting the normalized brush doesn't carry as meant: `approximated` into a nearby setting,
 * `unsupported` dropped, `inapplicable` dropped as a painting never has its input (a pen's tilt). `unprobed`: a
 * Photoshop setting at a value no probe gave it, its pipeline unidentified there. `setting` is the source's field
 * name.
 */
export type StampBrushSupportNote = { level: 'approximated' | 'unsupported' | 'inapplicable' | 'unprobed'; setting: string; detail: string };
