// stamp-gate-slices-reroll.ts: the gate's rerolling slices (shot/slices-reroll). The two-look figure, held, tiled by
// slices that reroll each drawing its plane's clock shows: four drawings held two animation frames each. Its frames
// are drawn in turn and shuffled, on renderers of their own, and must match; a drawing's frames match each other and
// reuse its tiles, and each drawing's tiles are its looks moved as shotSlicesCell says at that drawing.

import { paintAnimationFrameAt } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { shotFigure, shotPlace } from '#lib/paint/shot/models/shot-figure.ts';
import { slices } from '#lib/paint/shot/models/shot-slices.ts';
import { STAMP_GATE_FIGURE_FRAME, stampGateFootagePlane } from './stamp-gate-figure-card.ts';
import { stampGateFrameDifference, stampGateFrameDifferenceText } from './stamp-gate-frames.ts';
import { STAMP_GATE_SHOT_FPS, type StampGateShot } from './stamp-gate-shot-span.ts';
import { stampGateTiles, stampGateTiling, stampGateTwoLooksEvaluations, type StampGateTwoLooksFrames } from './stamp-gate-two-looks.ts';

/** The drawings shown, the animation frames each holds, and the animation fps. */
const DRAWINGS = 4, HOLD = 2, ANIMATION_FPS = 24;
/** Levels a px may stand from its look's, moved: as shot/two-looks allows. */
const TILE_SLACK = 3;

/** The frames drawn, in turn: every frame at the gate's fps while the four drawings show. */
export const STAMP_GATE_SLICES_REROLL_FRAMES: readonly number[] = Array.from({ length: Math.ceil((DRAWINGS * HOLD * STAMP_GATE_SHOT_FPS) / ANIMATION_FPS) }, (_, k) => k / STAMP_GATE_SHOT_FPS);
/** The same frames shuffled, a fixed order, so a frame rarely follows the one before it. */
export const STAMP_GATE_SLICES_REROLL_SHUFFLED: readonly number[] = [7, 2, 9, 0, 5, 3, 8, 1, 6, 4].map((k) => STAMP_GATE_SLICES_REROLL_FRAMES[k]);
/** The frame the baseline shows: the second drawing's first. */
export const STAMP_GATE_SLICES_REROLL_AT = STAMP_GATE_SLICES_REROLL_FRAMES[3];

/** The drawing frame `t` shows: its animation frame over the hold. */
const drawingAt = (t: number) => Math.floor(paintAnimationFrameAt(t, ANIMATION_FPS) / HOLD);

/** The footage, and the figure's two looks tiled in square cells by slices rerolling each drawing, the plane's drawing clock holding two. */
export function stampGateSlicesRerollShot(): StampGateShot {
  const stage = stampStage(STAMP_GATE_FIGURE_FRAME, 2);
  const [wash, gouache] = stampGateTwoLooksEvaluations().map((evaluation) => shotFigure(evaluation, 'figure', { at: 0 }));
  return {
    camera: { stage, fov: 35, lens: { bloom: 0, shutter: 'shut' }, animationFps: ANIMATION_FPS, plays: [] },
    planes: [stampGateFootagePlane(stage), shotPlace(slices({ source: wash, second: gouache }, stampGateTiles('rects', 'drawing')), { id: 'tiles', depth: 1, sourceClock: { hold: HOLD } })],
  };
}

/**
 * The rerolling tiles' frames, RGB bytes: drawn in turn, shuffled (in STAMP_GATE_SLICES_REROLL_SHUFFLED's order), each
 * look placed alone, and the tiles drawn anew (`effect misses`) per frame drawn in turn.
 */
export type StampGateSlicesRerollFrames = {
  readonly inTurn: readonly ArrayLike<number>[]; readonly shuffled: readonly ArrayLike<number>[]; readonly looks: StampGateTwoLooksFrames['looks']; readonly drawn: readonly number[];
};

/**
 * shot/slices-reroll: shuffled, every frame matches it drawn in turn; a drawing's frames match each other, and
 * each drawing's differ from the one before; the tiles are drawn once a drawing; every px is its cell's look moved
 * as shotSlicesCell says at its drawing.
 */
export function checkStampGateSlicesReroll({ inTurn, shuffled, looks, drawn }: StampGateSlicesRerollFrames) {
  const frames = STAMP_GATE_SLICES_REROLL_FRAMES, drawings = frames.map(drawingAt);
  const order = STAMP_GATE_SLICES_REROLL_SHUFFLED.map((t) => frames.indexOf(t));
  const apart = order.map((k, i) => stampGateFrameDifference(shuffled[i], inTurn[k])), worstApart = Math.max(...apart.map(({ max }) => max));
  const held = frames.flatMap((_, k) => (k && drawings[k] === drawings[k - 1] ? [stampGateFrameDifference(inTurn[k], inTurn[k - 1]).max] : []));
  const rerolled = frames.flatMap((_, k) => (k && drawings[k] !== drawings[k - 1] ? [stampGateFrameDifference(inTurn[k], inTurn[k - 1])] : []));
  const wanted = drawings.map((drawing, k) => (k && drawing === drawings[k - 1] ? 0 : 1));
  const params = stampGateTiles('rects', 'drawing'), strays = frames.map((_, k) => stampGateTiling(inTurn[k], params, looks, drawings[k]).stray);
  return [
    {
      id: 'shot/slices-reroll: shuffled order', passed: worstApart === 0,
      detail: `drawn in a shuffled order, its ${order.length} frames lie at most ${worstApart} levels from them drawn in turn (identical wanted)`,
    },
    {
      id: 'shot/slices-reroll: holds within a drawing, rerolls across', passed: held.every((max) => max === 0) && rerolled.length === DRAWINGS - 1 && rerolled.every(({ max }) => max > 0),
      detail: `frames within a drawing lie ${held.join(', ')} levels apart (all 0 wanted); each drawing lies ${rerolled.map(stampGateFrameDifferenceText).join('; ')} from the one before (${DRAWINGS - 1} differing wanted)`,
    },
    {
      id: 'shot/slices-reroll: tiles drawn once a drawing', passed: drawn.every((n, k) => n === wanted[k]),
      detail: `drawn in turn, frames drew the tiles ${drawn.join(', ')} times anew (${wanted.join(', ')} wanted: a drawing's first frame alone)`,
    },
    {
      id: 'shot/slices-reroll: each drawing its cells, moved', passed: strays.every((stray) => stray <= TILE_SLACK),
      detail: `every px strays at most ${strays.join(', ')} levels, frame by frame, from its cell's look placed alone, moved as its cell is at that drawing (${TILE_SLACK} allowed)`,
    },
  ];
}
