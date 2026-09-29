// stamp-brush.ts: the normalized brush a stamp painting deposits with. A brush is a stamp (its tip), a grain and the
// settings that place, size and fade each stamp along a stroke. Every importer (Procreate today, Photoshop ABR later)
// translates its own fields into this shape, so no importer's names or quirks reach a recipe or the renderer.
//
// Lengths are fractions of the stamp's diameter and angles are radians, so a brush means the same at any size.

/**
 * An image among a style's imported assets: `work/styles/<style>/brushes/<pack>/<file>`, where `file` is as the
 * pack's manifest lists it. Whole, so a painting that uses two styles names each image without doubt. Dark is paint.
 */
export type StampBrushAsset = { style: string; pack: string; file: string };

export type StampBlend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

export type StampBrushTip = {
  image: StampBrushAsset;
  /** Height over width of the stamp, (0, 1]: 1 keeps the image's own proportions, less squashes it across the stroke. */
  roundness: number;
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
};

/** A ring of pigment gathered at the rim of the brush's own wet deposit (a wet edge) or a darkened rim (a burnt edge). */
export type StampBrushEdge = {
  /** How far in from the rim, as a fraction of the stamp's radius. */
  width: number;
  /** How much darker the rim is than the body, 0..1. */
  strength: number;
};

/** How one brush lays its stamps: everything but its name and what it does to a whole stroke. */
export type StampBrushStamping = {
  tip: StampBrushTip;
  grain?: StampBrushGrain;
  /** Distance between stamps along a stroke. Below about 0.05, stamps pile up faster than they read. */
  spacing: number;
  /** Each stamp's random variation, 0..1: sideways offset (in diameters), and size and opacity lost. */
  jitter: { lateral: number; size: number; opacity: number };
  /** `count` stamps at each spacing step, each offset at random within `radius` of the stroke. */
  scatter: { count: number; radius: number };
  /**
   * `angle` turns every stamp; `follow` (0..1) turns it with the stroke's direction, unwrapped along the stroke so a
   * partial follow never jumps; `jitter` turns each at random.
   */
  rotation: { angle: number; follow: number; jitter: number };
  /**
   * The stroke's first `start` and last `end` fractions of its length ease in from `size` and `opacity` (each 0..1 of
   * full) to full, so a stroke starts and lifts off without a hard stamp at either end.
   */
  taper: { start: number; end: number; size: number; opacity: number };
  /** How much of each stamp's paint lands, 0..1. */
  flow: number;
  /** How far a stroke's pressure moves each stamp's size and opacity, 0..1: 0 ignores pressure. */
  pressure: { size: number; opacity: number };
};

/** A brush's own stamps and how they pool: all of a brush but its name and its dual. */
export type StampBrushLayer = StampBrushStamping & {
  /**
   * How a stroke's own stamps combine. `glaze`: where they overlap each other they don't darken, so the stroke reaches
   * at most its flow, and only a later stroke builds on it. `build`: each stamp lays over the ones before, so overlaps
   * darken within the stroke.
   */
  accumulation: 'glaze' | 'build';
  wetEdge?: StampBrushEdge;
  burntEdge?: StampBrushEdge;
};

/**
 * How a dual brush's coverage combines with the main brush's. Beyond the deposit blends: `colorBurn` and `difference`
 * as their layer modes; `linearHeight` cuts the main coverage by the dual's, as grain cuts a stamp.
 */
export type StampDualBlend = StampBlend | 'colorBurn' | 'difference' | 'linearHeight';

export type StampBrush = StampBrushLayer & {
  /** Its name in its pack, as the manifest keys it. Part of no seed: renaming a brush changes no painting's randomness. */
  name: string;
  /**
   * A second, whole brush stamped along the same stroke and combined with the first by `blend`, only where the first
   * has paint: a dry, broken texture inside the main shape. It places its stamps by its own settings, pools by its own
   * edges and accumulation, and its stamps are `scale` times the main brush's diameter.
   */
  dual?: StampBrushLayer & { blend: StampDualBlend; scale: number };
};
