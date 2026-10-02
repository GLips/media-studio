// stamp-gate-three-still.ts: the gate's three/still-front case. A still three card's patch stands in front of a red
// stroke moving on the painted plane behind, while the card's plane distance lies past the painting's, as a three
// plane's does when its geometry comes nearer than its plane. The gather must take the card's depth from its texels:
// the stroke passes under the patch, which stays sharp, as the reference's exposures show it.

import { lensExposures } from '#lib/picture/lens/models/lens-exposures.ts';
import { LENS_REFERENCE_EXPOSURES } from '#lib/picture/lens/models/lens-mode.ts';
import { compileStampPaintRecipe, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampScenePlanes, type StampLaidPlanes, type StampLensFrame, type StampPlane } from '#lib/paint/painting/models/stamp-plane.ts';
import { STAMP_GATE_IMAGES, STAMP_GATE_WHITE, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import { stampGateFrameDifference } from './stamp-gate-frames.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { STAMP_GATE_REST_LOOK } from './stamp-gate-lens.ts';
import { STAMP_GATE_CARD, STAMP_GATE_THREE_SIZE } from './stamp-gate-three-plane.ts';

export const STAMP_GATE_THREE_STILL_ID = 'three/still-front';
export const STAMP_GATE_THREE_STILL_T = 1;
export const STAMP_GATE_THREE_STILL_SHUTTER = 1 / 60;
/** How far the stroke travels right over the shutter, px. */
const TRAVEL = 16;
/** The card's opaque patch, right of the stroke, so the stroke's smear runs under it. */
const PATCH = { x0: 110, x1: 160, y0: 30, y1: 130 };
/** The planes' distances: the painting's, and the card's plane past it (its texels are nearer, stampGateThreeMotion's 1). */
const PAINTED_DISTANCE = 2;
const CARD_PLANE_DISTANCE = 4;

/** Grey ground, and a red stroke down it that the frame state moves right. */
export function stampGateThreeStillPainting(): StampGatePainting {
  const brush = stampGateBrush('Motion', { flow: 0.9 });
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: STAMP_GATE_WHITE, mixing: { kind: 'flat' } }, (p) => {
    p.group('ground', { composite: 'opaque' }, (g) => g.passage('flat', {}, (pass) => pass.fill('ground', {
      brush, size: 30, application: { kind: 'flood' }, region: stampGatePolygon(-20, -20, 260, -20, 260, 180, -20, 180), well: { paint: { kind: 'color', color: '#8a94a0' } },
    })));
    p.group('moving', { composite: 'opaque' }, (g) => g.passage('p', {}, (pass) => {
      pass.stroke('red', { brush, size: 12, well: { paint: { kind: 'color', color: '#c0302a' } }, path: [{ x: 96, y: 20 }, { x: 98, y: 140 }] });
    }));
  }));
  return { painting, ...STAMP_GATE_THREE_SIZE, t: STAMP_GATE_THREE_STILL_T, images: STAMP_GATE_IMAGES };
}

/** The painting's one plane behind the card. */
export function stampGateThreeStillPlanes(painting: CompiledStampPaint): StampLaidPlanes {
  const problems: string[] = [];
  const planes: StampPlane[] = [
    { id: 'painted', depth: 2, source: { kind: 'painted', groups: ['ground', 'moving'] } },
    { id: STAMP_GATE_CARD, depth: 1, source: { kind: 'three' } },
  ];
  const compiled = stampScenePlanes(painting, planes, problems);
  if (!compiled || problems.length) throw new Error(`stamp gate: the still-front case's planes: ${problems.join('; ')}`);
  return compiled;
}

/** The card's content: the opaque patch, linear premultiplied rgba, nothing round it. */
export function stampGateThreeStillContent(): Float32Array {
  const { width, height } = STAMP_GATE_THREE_SIZE, rgba = new Float32Array(width * height * 4);
  for (let y = PATCH.y0; y < PATCH.y1; y++) for (let x = PATCH.x0; x < PATCH.x1; x++) rgba.set([0.05, 0.4, 0.2, 1], (y * width + x) * 4);
  return rgba;
}

/** The frame state at scene second `at`: the stroke `TRAVEL` px right over the shutter, centred on the frame. */
export function stampGateThreeStillState(at: number): StampPaintFrameState {
  const x = TRAVEL * (at - STAMP_GATE_THREE_STILL_T) / STAMP_GATE_THREE_STILL_SHUTTER;
  return new Map([['moving', { lay: { placement: { x, y: 0, rotation: 0, scale: 1 }, pivot: { x: 0, y: 0 } } }]]);
}

/** Both planes at rest, at their distances. */
export const STAMP_GATE_THREE_STILL_LENS: StampLensFrame = {
  planes: new Map([['painted', { ...STAMP_GATE_REST_LOOK, distance: PAINTED_DISTANCE }], [STAMP_GATE_CARD, { ...STAMP_GATE_REST_LOOK, distance: CARD_PLANE_DISTANCE }]]),
  bloom: 0,
  focus: null,
};

/** The reference's exposures over the shutter. */
export const stampGateThreeStillExposures = () => lensExposures(LENS_REFERENCE_EXPOSURES).map(({ index, count, shutter, aperture }) =>
  ({ index, count, aperture, at: STAMP_GATE_THREE_STILL_T + STAMP_GATE_THREE_STILL_SHUTTER * (shutter - 0.5) }));

/** How far the fast frame may sit from the reference over the patch, levels: its dither, either way. */
const PATCH_TOLERANCE = 2;

/** Whether the patch is the reference's in the fast frame, and the stroke blurred: the fast frame isn't the sharp one. */
export function checkStampGateThreeStill({ fast, reference, sharp }: Record<'fast' | 'reference' | 'sharp', ArrayLike<number>>): StampGateWashCheck {
  const { width } = STAMP_GATE_THREE_SIZE;
  let patch = 0;
  for (let y = PATCH.y0; y < PATCH.y1; y++) for (let x = PATCH.x0; x < PATCH.x1; x++) {
    for (let c = 0; c < 3; c++) patch = Math.max(patch, Math.abs(fast[(y * width + x) * 4 + c] - reference[(y * width + x) * 4 + c]));
  }
  const blurred = stampGateFrameDifference(sharp, fast).max, apart = stampGateFrameDifference(fast, reference).mean;
  return {
    id: `${STAMP_GATE_THREE_STILL_ID}: a still three patch in front of a moving stroke stays sharp, its depth its texels'`,
    passed: patch <= PATCH_TOLERANCE && blurred > 40 && apart <= 0.75,
    detail: `over the patch, fast against reference max ${patch} (past ${PATCH_TOLERANCE} fails); mean ${apart.toFixed(3)} (past 0.75 fails); against sharp max ${blurred} (40 or under fails)`,
  };
}
