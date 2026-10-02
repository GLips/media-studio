// stamp-gate-motion.ts: the gate's motion-blur case, the fast path held to the reference (lens-mode.ts). A painted
// plane drawn once through a moving lens, its motion gathered, is compared with the same frame averaged over the
// reference's exposures across the shutter: once for a group's own travel within its plane, once for the camera's
// pan. Still strokes beside and under the moving one put occlusion edges in the frame.

import { lensExposures } from '#lib/picture/lens/models/lens-exposures.ts';
import { LENS_REFERENCE_EXPOSURES } from '#lib/picture/lens/models/lens-mode.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { STAMP_SINGLE_PLANE_ID, type StampLensFrame, type StampPlaneView } from '#lib/paint/painting/models/stamp-plane.ts';
import { STAMP_GATE_IMAGES, STAMP_GATE_WHITE, stampGateBrush, type StampGatePainting } from './stamp-gate-paintings.ts';
import { stampGateFrameDifference } from './stamp-gate-frames.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { STAMP_GATE_REST_LOOK } from './stamp-gate-lens.ts';

/** The frame's time, s, and its shutter, centred on it. */
export const STAMP_GATE_MOTION_T = 1;
export const STAMP_GATE_MOTION_SHUTTER = 1 / 60;
/** How far the moving stroke travels, and the camera pans, over the shutter, px. */
const TRAVEL = 14;
/** Where the moving stroke lies at the frame's time, px right of where it's painted: off its rest, so it's laid through a lattice. */
const LAID_AT = 6;

/** The case's two motions: a group's own travel within a still camera, or every group still under a panning camera. */
export type StampGateMotionKind = 'own' | 'pan';

/**
 * Still strokes on white paper, a blue one across and a green one down, and a red one down between them, laid after,
 * which the frame state moves right: its smear runs along the blue and up to and over the green's edge.
 */
export function stampGateMotionPainting(): StampGatePainting {
  const brush = stampGateBrush('Motion', { flow: 0.9 });
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: STAMP_GATE_WHITE, mixing: { kind: 'flat' } }, (p) => {
    p.group('still', { composite: 'opaque' }, (g) => g.passage('p', {}, (pass) => {
      pass.stroke('blue', { brush, size: 10, well: { paint: { kind: 'color', color: '#203a8a' } }, path: [{ x: 30, y: 50 }, { x: 130, y: 52 }] });
      pass.stroke('green', { brush, size: 8, well: { paint: { kind: 'color', color: '#2a7a3a' } }, path: [{ x: 101, y: 16 }, { x: 99, y: 86 }] });
    }));
    p.group('moving', { composite: 'opaque' }, (g) => g.passage('p', {}, (pass) => {
      pass.stroke('red', { brush, size: 12, well: { paint: { kind: 'color', color: '#c0302a' } }, path: [{ x: 74, y: 20 }, { x: 78, y: 82 }] });
    }));
  }));
  return { painting, width: 160, height: 100, t: STAMP_GATE_MOTION_T, images: STAMP_GATE_IMAGES };
}

/** `kind`'s frame state at scene second `at`: the red stroke drifting right on ones for `own`, every group still for `pan`. */
export function stampGateMotionState(kind: StampGateMotionKind, at: number): StampPaintFrameState {
  if (kind === 'pan') return new Map();
  const x = LAID_AT + (TRAVEL * (at - STAMP_GATE_MOTION_T)) / STAMP_GATE_MOTION_SHUTTER;
  return new Map([['moving', { lay: { placement: { x, y: 0, rotation: 0, scale: 1 }, pivot: { x: 0, y: 0 } } }]]);
}

/** The view panned `x` px right. */
const panned = (x: number): StampPlaneView => ({ ...STAMP_GATE_REST_LOOK.view, kx: x });

/** The fast frame's lens: moving, the plane's view as the shutter opens and closes (panning across TRAVEL for `pan`). */
export function stampGateMotionFastLens(kind: StampGateMotionKind): StampLensFrame {
  const reach = kind === 'pan' ? TRAVEL / 2 : 0;
  const look = { ...STAMP_GATE_REST_LOOK, shutter: { open: panned(-reach), close: panned(reach) } };
  return { planes: new Map([[STAMP_SINGLE_PLANE_ID, look]]), bloom: 0, focus: null, moving: true };
}

/** The reference's exposures: each one's moment and the lens it sees, the camera where the pan has it then. */
export function stampGateMotionExposures(kind: StampGateMotionKind): { index: number; count: number; at: number; lens: StampLensFrame }[] {
  return lensExposures(LENS_REFERENCE_EXPOSURES).map(({ index, count, shutter }) => {
    const look = { ...STAMP_GATE_REST_LOOK, view: panned(kind === 'pan' ? TRAVEL * (shutter - 0.5) : 0) };
    const lens: StampLensFrame = { planes: new Map([[STAMP_SINGLE_PLANE_ID, look]]), bloom: 0, focus: null, moving: false };
    return { index, count, at: STAMP_GATE_MOTION_T + STAMP_GATE_MOTION_SHUTTER * (shutter - 0.5), lens };
  });
}

/**
 * Where the moving stroke's smear meets the green, px: an occlusion edge. The gather smears what lies level behind a
 * moving pixel along with it, where the reference shows the still stroke sharp beside it.
 */
const CROSSING = { x0: 86, x1: 114, y0: 10, y1: 92 };

/**
 * How far the fast frame may sit from the reference's, levels: `mean` over the frame, `most` away from the crossing
 * and `crossing` within it. Away, it's the gather's 15 jittered taps a pixel against 24 exposures (measured 16 and
 * 23). At the edge, what's revealed behind the moving stroke is guessed from still paint near it (measured 63).
 */
export const STAMP_GATE_MOTION_TOLERANCE = { mean: 0.75, most: 32, crossing: 80 };

/** The most `a` and `b` differ, RGB levels, within the crossing and away from it. */
function mostApart(a: ArrayLike<number>, b: ArrayLike<number>, width: number) {
  let away = 0, within = 0;
  for (let p = 0; p < a.length / 4; p++) {
    const x = p % width, y = Math.floor(p / width), d = Math.max(...[0, 1, 2].map((c) => Math.abs(a[p * 4 + c] - b[p * 4 + c])));
    if (x >= CROSSING.x0 && x < CROSSING.x1 && y >= CROSSING.y0 && y < CROSSING.y1) within = Math.max(within, d);
    else away = Math.max(away, d);
  }
  return { away, within };
}

/** Whether each kind's fast frame is the reference's within tolerance, and blurred: not the sharp frame. */
export function checkStampGateMotion(frames: Record<StampGateMotionKind, Record<'fast' | 'reference' | 'sharp', ArrayLike<number>>>, width: number): StampGateWashCheck {
  const kinds = (['own', 'pan'] as const).map((kind) => {
    const { fast, reference, sharp } = frames[kind];
    return { kind, apart: mostApart(fast, reference, width), mean: stampGateFrameDifference(fast, reference).mean, shown: stampGateFrameDifference(sharp, fast).max };
  });
  const tolerance = STAMP_GATE_MOTION_TOLERANCE;
  return {
    id: 'lens/motion: a painted plane\'s motion, a group\'s own or the camera\'s, gathered as the reference\'s exposures average it',
    passed: kinds.every(({ apart, mean, shown }) => mean <= tolerance.mean && apart.away <= tolerance.most && apart.within <= tolerance.crossing && shown > 40),
    detail: kinds.map(({ kind, apart, mean, shown }) => `${kind}: fast against reference mean ${mean.toFixed(3)} (past ${tolerance.mean} fails), `
      + `max ${apart.away} away from the crossing (past ${tolerance.most} fails), ${apart.within} at it (past ${tolerance.crossing} fails); against sharp max ${shown} (40 or under fails)`).join('; '),
  };
}
