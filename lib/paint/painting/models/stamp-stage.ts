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
   * The width x repeats with, as WGSL reads it (STAGE_WRAP): the frame's on a stage that wraps, 0 on one that doesn't.
   * Its margin is then the halo marks are copied into (stamp-sheet-wrap.ts).
   */
  readonly wrap: number;
  /** The targets' size: the frame and the margin each side. */
  readonly width: number;
  readonly height: number;
  readonly [stampStageMade]: true;
};

/**
 * The stage round a `frame` (whole px, above 0), `margin` px past each side, its x repeating with the frame's width
 * when `wrap` is 'x'. An even margin: a deposit's edge blur works at half size, and an odd one would pair the frame's
 * pixels otherwise, so the paint inside the frame would move a level.
 */
export function stampStage(frame: { readonly width: number; readonly height: number }, margin = 0, wrap: 'x' | null = null): StampStage {
  const { width, height } = frame;
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) throw new Error(`stamp paint: a stage's frame is whole px above 0, not ${width} × ${height}`);
  if (!(Number.isInteger(margin) && margin >= 0 && margin % 2 === 0)) throw new Error(`stamp paint: a stage's margin is whole, even px from 0, not ${margin}`);
  // SAFETY: the brand says stampStage checked the frame and margin and derived the targets' size from them.
  return Object.freeze({ frame: Object.freeze({ width, height }), margin, wrap: wrap === 'x' ? width : 0, width: width + 2 * margin, height: height + 2 * margin }) as StampStage;
}

/**
 * The width a tile `width` px across is laid at round a wrap `wrap` px wide: the nearest that fits a whole number of
 * times, or of mirrored pairs when `mirrored` (a mirrored tile meets itself only after its mirror). So a mirrored tile
 * of half the wrap or more is laid at half the wrap.
 */
export function stampTileRoundWrap(wrap: number, width: number, mirrored: boolean): number {
  const pair = mirrored ? 2 : 1;
  return wrap / Math.max(1, Math.round(wrap / (pair * width))) / pair;
}

/**
 * A tile `size` (width, height, px) as `stage` reads it: on a stage that wraps, fitted round the wrap
 * (stampTileRoundWrap), its aspect kept, so what it textures meets itself at the seam; else as given.
 */
export function stampStageTile(stage: StampStage, [width, height]: readonly [number, number], mirrored: boolean): [number, number] {
  if (!stage.wrap) return [width, height];
  const fitted = stampTileRoundWrap(stage.wrap, width, mirrored);
  return [fitted, height * (fitted / width)];
}

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
 * WGSL for `stage`: STAGE_MARGIN and STAGE_WRAP; stagePoint(texel), a texel's centre as a painting point, exactly the
 * texel's centre at margin 0, so a margin of 0 draws as no stage did; and stageUnwrapped(p, start), `p` as a deposit
 * planned within the wrap from x `start` reads it, so its copies' pixels read as its own.
 */
export const stampStageWgsl = ({ margin, wrap }: StampStage) => /* wgsl */ `
const STAGE_MARGIN = vec2i(${margin});
const STAGE_WRAP = ${wrap.toFixed(1)};
fn stagePoint(texel: vec2i) -> vec2f { return vec2f(texel - STAGE_MARGIN) + 0.5; }
fn stageUnwrapped(p: vec2f, start: f32) -> vec2f {
  if (STAGE_WRAP <= 0.0) { return p; }
  return vec2f(start + (p.x - start) - STAGE_WRAP * floor((p.x - start) / STAGE_WRAP), p.y);
}`;
