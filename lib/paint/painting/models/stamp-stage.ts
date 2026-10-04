// stamp-stage.ts: the stage, the painting's pixel space as the renderer holds it: the frame plus a margin past each
// side, so a camera moving a group's lay can bring in what lies just off the frame. Points keep the frame's origin:
// the margin lies at negative points and past the frame's width and height. Every target is the stage's size, a
// point's texel being the point plus the margin; the output shows the frame's window.
//
// Paper, grain, tooth and noise are read at points, never texels: a margin changes nothing within the frame.

declare const stampStageMade: unique symbol;
declare const stampPointBoxMade: unique symbol;

/**
 * A stage: `frame` is what the output shows, and what a painting's relative sizes (its paper's tooth) read. Only
 * stampStage makes one, so its targets' size is always the frame and the margin each side.
 */
export type StampStage = {
  readonly frame: { readonly width: number; readonly height: number };
  /** Whole px past each side of the frame. */
  readonly margin: number;
  /**
   * The period each axis repeats with, as WGSL reads it (STAGE_WRAP): the frame's width or height on an axis that
   * wraps, 0 on one that doesn't. On a stage that wraps, its margin is the halo marks are copied into
   * (stamp-sheet-wrap.ts).
   */
  readonly wrap: StampWrapPeriods;
  /** The targets' size: the frame and the margin each side. */
  readonly width: number;
  readonly height: number;
  readonly [stampStageMade]: true;
};

/**
 * Which axes a painting's sheets repeat across: 'x' meets the left edge to the right (round a cylinder), 'y' the top
 * to the bottom (a sky scrolling down), 'xy' both (a tile, as round a torus).
 */
export type StampWrap = 'x' | 'y' | 'xy';

/** An axis of the painting: x right, y down. */
export type StampAxis = 'x' | 'y';
export const STAMP_AXES: readonly StampAxis[] = ['x', 'y'];

/** Every StampWrap, for a check refusing any other. */
export const STAMP_WRAPS: readonly StampWrap[] = ['x', 'y', 'xy'];

/** Whether `wrap` (null: none) repeats across `axis`. */
export const stampWrapsAcross = (wrap: StampWrap | null, axis: StampAxis): boolean => wrap !== null && wrap.includes(axis);

/** The period, px, each axis repeats with: 0 on one that doesn't. */
export type StampWrapPeriods = { readonly x: number; readonly y: number };

/** The periods a `frame` wrapping as `wrap` (null: none) repeats with: its width across x, its height across y. */
export const stampWrapPeriods = (frame: { readonly width: number; readonly height: number }, wrap: StampWrap | null): StampWrapPeriods =>
  Object.freeze({ x: stampWrapsAcross(wrap, 'x') ? frame.width : 0, y: stampWrapsAcross(wrap, 'y') ? frame.height : 0 });

/**
 * The corner of the one wrap a deposit's pixels are read within, painting points, x then y (stageUnwrapped): on each
 * axis that wraps, where the wrap round where it was planned starts; read as nothing on one that doesn't.
 */
export type StampWrapFrom = readonly [x: number, y: number];

/** The wrapFrom of a deposit on a stage that doesn't wrap: unread. */
export const STAMP_WRAP_FROM_NONE: StampWrapFrom = [0, 0];

/**
 * The stage round a `frame` (whole px, above 0), `margin` px past each side, each axis `wrap` names repeating with the
 * frame's side. An even margin: a deposit's edge blur works at half size, and an odd one would pair the frame's
 * pixels otherwise, so the paint inside the frame would move a level.
 */
export function stampStage(frame: { readonly width: number; readonly height: number }, margin = 0, wrap: StampWrap | null = null): StampStage {
  const { width, height } = frame;
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) throw new Error(`stamp paint: a stage's frame is whole px above 0, not ${width} × ${height}`);
  if (!(Number.isInteger(margin) && margin >= 0 && margin % 2 === 0)) throw new Error(`stamp paint: a stage's margin is whole, even px from 0, not ${margin}`);
  // SAFETY: the brand says stampStage checked the frame and margin and derived the targets' size from them.
  return Object.freeze({ frame: Object.freeze({ width, height }), margin, wrap: stampWrapPeriods(frame, wrap), width: width + 2 * margin, height: height + 2 * margin }) as StampStage;
}

/**
 * The length a tile `length` px along an axis is laid at round a period `period` px long: the nearest that fits a
 * whole number of times, or of mirrored pairs when `mirrored` (a mirrored tile meets itself only after its mirror).
 * So a mirrored tile of half the period or more is laid at half the period.
 */
export function stampTileRoundWrap(period: number, length: number, mirrored: boolean): number {
  const pair = mirrored ? 2 : 1;
  return period / Math.max(1, Math.round(period / (pair * length))) / pair;
}

/**
 * A tile `size` (width, height, px) laid round `periods`: each axis that wraps fitted round its period
 * (stampTileRoundWrap), so what it textures meets itself at the seam; an axis that doesn't scaled as its fitted one,
 * the tile's aspect kept. Wrapping both ways, each side is fitted on its own, so the aspect may stretch.
 */
export function stampTileRoundWraps(periods: StampWrapPeriods, [width, height]: readonly [number, number], mirrored: boolean): [number, number] {
  const fitted = (period: number, length: number) => (period ? stampTileRoundWrap(period, length, mirrored) / length : null);
  const across = fitted(periods.x, width), down = fitted(periods.y, height), kept = across ?? down ?? 1;
  return [width * (across ?? kept), height * (down ?? kept)];
}

/** A tile `size` (width, height, px) as `stage` reads it: fitted round its wraps (stampTileRoundWraps). */
export const stampStageTile = (stage: StampStage, size: readonly [number, number], mirrored: boolean): [number, number] => stampTileRoundWraps(stage.wrap, size, mirrored);

/** What a box of texels, a stage's or a texture's, carries: never StampPointBox's mark, so a point box is converted first. */
export type StampTexelBoxMark = { readonly [stampPointBoxMade]?: never };

/** A box of the stage's whole texels: a point's texel is the point plus the margin. */
export type StampStageTexels = { readonly x: number; readonly y: number; readonly w: number; readonly h: number } & StampTexelBoxMark;

/**
 * A box of whole painting points: what a region and a kept film hold. On a stage with a margin these aren't its
 * texels, so it reads as one only through stampStageTexelsOf.
 */
export type StampPointBox = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly [stampPointBoxMade]: true };

/** `box`, whole painting points, as a StampPointBox. */
export const stampPointBox = ({ x, y, w, h }: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): StampPointBox =>
  // SAFETY: the mark only says which space the box is in; the caller hands painting points.
  ({ x, y, w, h }) as StampPointBox;

/** The stage's extent in painting pixels: x0, y0 inclusive, x1, y1 exclusive. `0 - margin`, as -margin is -0 at 0. */
export const stampStageExtent = ({ margin, frame }: StampStage) => ({ x0: 0 - margin, y0: 0 - margin, x1: frame.width + margin, y1: frame.height + margin });

/** The stage's whole texels within painting points x0..x1, y0..y1, or null for none. */
export function stampStageTexelsWithin({ width, height, margin }: StampStage, x0: number, y0: number, x1: number, y1: number): StampStageTexels | null {
  const x = Math.max(0, Math.floor(x0) + margin), y = Math.max(0, Math.floor(y0) + margin);
  const w = Math.min(width, Math.ceil(x1) + margin) - x, h = Math.min(height, Math.ceil(y1) + margin) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** A box of painting points as `stage`'s texels. */
export const stampStageTexelsOf = ({ margin }: StampStage, box: StampPointBox): StampStageTexels => ({ x: box.x + margin, y: box.y + margin, w: box.w, h: box.h });

/** What of `box`, `stage`'s texels, lies within the frame, as painting points; null for none. */
export function stampStageFramed({ margin, frame }: StampStage, box: StampStageTexels): StampPointBox | null {
  const x = Math.max(0, box.x - margin), y = Math.max(0, box.y - margin);
  const w = Math.min(frame.width, box.x + box.w - margin) - x, h = Math.min(frame.height, box.y + box.h - margin) - y;
  return w > 0 && h > 0 ? stampPointBox({ x, y, w, h }) : null;
}

/** `box` grown by `by` texels each side, held to the stage. */
export function stampStageTexelsGrown({ width, height }: StampStage, box: StampStageTexels, by: number): StampStageTexels {
  const x = Math.max(0, box.x - by), y = Math.max(0, box.y - by);
  return { x, y, w: Math.min(width, box.x + box.w + by) - x, h: Math.min(height, box.y + box.h + by) - y };
}

/** A region's box (painting points) as a uniform's four words in `stage`'s texels; an empty box for none. */
export const stampRegionTexelWords = (box: StampPointBox | null | undefined, stage: StampStage): [number, number, number, number] =>
  (box ? [box.x + stage.margin, box.y + stage.margin, box.w, box.h] : [0, 0, 0, 0]);

/** A region's box as a uniform's four words in painting points, as its own texture's texel 0 lies; empty for none. */
export const stampPointBoxWords = (box: StampPointBox | null | undefined): [number, number, number, number] => (box ? [box.x, box.y, box.w, box.h] : [0, 0, 0, 0]);

/** The least box holding `a` and `b`, both texels or both painting points; either alone when the other is null. */
export function stampBoxUnion<B extends StampStageTexels | StampPointBox>(a: B | null, b: B | null): B | null {
  if (!a || !b) return a ?? b;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  // A point box's spread keeps its mark: the union of two boxes in one space is in it.
  return { ...a, x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * WGSL for `stage`: STAGE_MARGIN and STAGE_WRAP (its periods); stagePoint(texel), a texel's centre as a painting
 * point, exactly the texel's centre at margin 0, so a margin of 0 draws as no stage did; and stageUnwrapped(p, start),
 * `p` as a deposit planned within the wrap from `start` (StampWrapFrom) reads it, so its copies read as it does.
 */
export const stampStageWgsl = ({ margin, wrap }: StampStage) => /* wgsl */ `
const STAGE_MARGIN = vec2i(${margin});
const STAGE_WRAP = vec2f(${wrap.x.toFixed(1)}, ${wrap.y.toFixed(1)});
fn stagePoint(texel: vec2i) -> vec2f { return vec2f(texel - STAGE_MARGIN) + 0.5; }
fn stageUnwrapped(p: vec2f, start: vec2f) -> vec2f {
  let period = max(STAGE_WRAP, vec2f(1.0));
  return select(p, start + (p - start) - period * floor((p - start) / period), STAGE_WRAP > vec2f(0.0));
}`;
