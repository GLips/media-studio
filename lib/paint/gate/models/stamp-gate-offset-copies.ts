// stamp-gate-offset-copies.ts: the gate's effect over an image in no plane (shot/offset-copies). The figure image's
// figure (stamp-gate-figure-card.ts), read as a shot's figure no plane places, drawn by offsetCopies over footage:
// the figure, then two copies behind it, each 45 px right and half as visible again, the last lying past the box
// the figure's own paint reaches.

import { painting } from '#lib/paint/document/models/painting-source.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { shotFigure, shotPlace } from '#lib/paint/shot/models/shot-figure.ts';
import { offsetCopies } from '#lib/paint/shot/models/shot-offset-copies.ts';
import { stampGateBoxLuma, type StampGateCardShadowsBox } from './stamp-gate-card-shadows.ts';
import { STAMP_GATE_FIGURE_FRAME, STAMP_GATE_FIGURE_IMAGE, stampGateFigureImageShot, stampGateFootagePlane } from './stamp-gate-figure-card.ts';
import { STAMP_GATE_FRAME_TOLERANCE, stampGateFrameDifference, stampGateFrameDifferenceText, stampGateFramePasses } from './stamp-gate-frames.ts';
import type { StampGateShot } from './stamp-gate-shot-span.ts';

const { width } = STAMP_GATE_FIGURE_FRAME;
/** The copies' offset, px, and how visible each is beside the one before. */
const STEP = 45, FADE = 0.5;
/** The figure's card, x, document px, with its bleed and fade: past it, the figure itself lays nothing. */
const FIGURE = { x0: 20, x1: 90, reach: 16 } as const;

/** The footage, and the figure image's figure drawn by offsetCopies on a plane of its own, the figure itself in none. */
export function stampGateOffsetCopiesShot(): StampGateShot {
  const stage = stampStage(STAMP_GATE_FIGURE_FRAME, 2), figure = shotFigure(painting(STAMP_GATE_FIGURE_IMAGE, { revealed: true }), 'figure', { at: 0 });
  return {
    camera: { stage, fov: 35, lens: { bloom: 0, shutter: 'shut' }, plays: [] },
    planes: [stampGateFootagePlane(stage), shotPlace(offsetCopies(figure, { count: 2, dx: STEP, dy: 0, fade: FADE }), { id: 'echo', depth: 1 })],
  };
}

/** The frames offset copies are checked by, RGB bytes: the copies' own, and the figure placed as a figure (shot/figure-image). */
export type StampGateOffsetCopiesFrames = { readonly copies: ArrayLike<number>; readonly placed: ArrayLike<number> };

/** The figure placed alone, as the copies' frame is compared with it. */
export const stampGateOffsetCopiesPlacedShot = () => stampGateFigureImageShot('figure');

/** RGB bytes of `rgb`'s columns x0..x1, row by row. */
function columns(rgb: ArrayLike<number>, x0: number, x1: number) {
  const height = rgb.length / 3 / width, out: number[] = [];
  for (let y = 0; y < height; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) out.push(rgb[(y * width + x) * 3 + c]);
  return out;
}

/** Where each of the figure and its copies is read, clear of the white it reserves: its right part, rows 30..90. */
const strip = (k: number): StampGateCardShadowsBox => ({ x0: FIGURE.x0 + 56 + k * STEP, y0: 30, x1: FIGURE.x0 + 64 + k * STEP, y1: 90 });

/** Levels the farthest copy must stand from the footage: shown, not faded out. */
const SHOWN = 12;

const f = (value: number) => value.toFixed(1);

/**
 * shot/offset-copies: the figure, read in no plane, renders where no copy lies as the figure placed alone; each copy
 * stands less far from the footage than the one before; and the farthest still shows, past the figure's own reach.
 */
export function checkStampGateOffsetCopies({ copies, placed }: StampGateOffsetCopiesFrames) {
  const left = stampGateFrameDifference(columns(copies, 0, FIGURE.x0 + STEP - FIGURE.reach), columns(placed, 0, FIGURE.x0 + STEP - FIGURE.reach));
  const footage = stampGateBoxLuma(copies, width, { x0: 0, y0: 0, x1: width, y1: 3 });
  const stands = [0, 1, 2].map((k) => Math.abs(stampGateBoxLuma(copies, width, strip(k)) - footage));
  const farthest = strip(2);
  return [
    {
      id: 'shot/offset-copies: an input in no plane renders', passed: stampGateFramePasses(left),
      detail: `left of the first copy, the figure read in no plane lies ${stampGateFrameDifferenceText(left)} from it placed alone (${STAMP_GATE_FRAME_TOLERANCE.max} levels allowed)`,
    },
    {
      id: 'shot/offset-copies: each copy fainter', passed: stands[0] > stands[1] && stands[1] > stands[2],
      detail: `the figure and its copies stand ${stands.map(f).join(', ')} levels of luma from the footage (each less than the one before wanted)`,
    },
    {
      id: 'shot/offset-copies: grown past its input', passed: stands[2] >= SHOWN,
      detail: `the farthest copy, at x ${farthest.x0}..${farthest.x1} past the figure's reach to ${FIGURE.x1 + FIGURE.reach}, stands ${f(stands[2])} levels from the footage (${SHOWN} or more wanted)`,
    },
  ];
}
