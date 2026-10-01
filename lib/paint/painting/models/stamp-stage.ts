// stamp-stage.ts: the stage, the painting's pixel space as the renderer holds it: the frame plus a margin past each
// side, so a camera moving a group's lay can bring in what lies just off the frame. Points keep the frame's origin:
// the margin lies at negative points and past the frame's width and height. Every target is the stage's size, a
// point's texel being the point plus the margin; the output shows the frame's window.
//
// Paper, grain, tooth and noise are read at points, never texels: a margin changes nothing within the frame.

declare const stampStageMade: unique symbol;

/**
 * A stage: `frame` is what the output shows, and what a painting's relative sizes (its paper's tooth) read. Only
 * stampStage makes one, so its targets' size is always the frame and the margin each side.
 */
export type StampStage = {
  readonly frame: { readonly width: number; readonly height: number };
  /** Whole px past each side of the frame. */
  readonly margin: number;
  /** The targets' size: the frame and the margin each side. */
  readonly width: number;
  readonly height: number;
  readonly [stampStageMade]: true;
};

/**
 * The stage round a `frame` (whole px, above 0), `margin` px past each side. An even margin: a deposit's edge blur
 * works at half size, and an odd one would pair the frame's pixels otherwise, so the paint inside the frame would move
 * a level.
 */
export function stampStage(frame: { readonly width: number; readonly height: number }, margin = 0): StampStage {
  const { width, height } = frame;
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) throw new Error(`stamp paint: a stage's frame is whole px above 0, not ${width} × ${height}`);
  if (!(Number.isInteger(margin) && margin >= 0 && margin % 2 === 0)) throw new Error(`stamp paint: a stage's margin is whole, even px from 0, not ${margin}`);
  // SAFETY: the brand says stampStage checked the frame and margin and derived the targets' size from them.
  return Object.freeze({ frame: Object.freeze({ width, height }), margin, width: width + 2 * margin, height: height + 2 * margin }) as StampStage;
}

/** The stage's extent in painting pixels: x0, y0 inclusive, x1, y1 exclusive. `0 - margin`, as -margin is -0 at 0. */
export const stampStageExtent = ({ margin, frame }: StampStage) => ({ x0: 0 - margin, y0: 0 - margin, x1: frame.width + margin, y1: frame.height + margin });

/**
 * WGSL for `stage`: STAGE_MARGIN, and stagePoint(texel), a stage texel's centre as a painting point. At margin 0 it's
 * the texel's centre exactly, so a margin of 0 draws as no stage did.
 */
export const stampStageWgsl = ({ margin }: StampStage) => /* wgsl */ `
const STAGE_MARGIN = vec2i(${margin});
fn stagePoint(texel: vec2i) -> vec2f { return vec2f(texel - STAGE_MARGIN) + 0.5; }`;
