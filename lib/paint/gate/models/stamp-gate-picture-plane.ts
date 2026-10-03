// stamp-gate-picture-plane.ts: the gate's picture/source case. The three-plane case's card (stamp-gate-three-plane.ts)
// as a picture plane instead: its content cut to a box inside the stage, handed in at a moment (StampPictureAt) and
// uploaded by loadStampPictureSources. Held to: laying, sharp and defocused, as the three card with the same content,
// which reads a stage-sized texture from its corner; and, in a scene of pictures alone, its colours showing as
// themselves over a picture ground.

import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import { stampScenePlanes, type StampLaidPlanes, type StampLensFrame, type StampPictureRgba, type StampPlane } from '#lib/paint/painting/models/stamp-plane.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampGateFrameDifference, stampGateFramePasses } from './stamp-gate-frames.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { STAMP_GATE_DEFOCUS_TOLERANCE, STAMP_GATE_REST_LOOK } from './stamp-gate-lens.ts';
import {
  checkStampGateCardColours, STAMP_GATE_CARD, STAMP_GATE_THREE_DEFOCUS, STAMP_GATE_THREE_DEFOCUS_LENS, STAMP_GATE_THREE_SIZE, stampGateThreeContent,
} from './stamp-gate-three-plane.ts';

export const STAMP_GATE_PICTURE_ID = 'picture/source';
/** The card's picture's box, frame px: every patch of content a inside it, its corner off the frame's. */
const BOX: StampBox = { x0: 14, y0: 12, x1: 214, y1: 150 };
/** The ground of the scene of pictures alone: one opaque linear colour. */
const GROUND = [0.18, 0.27, 0.4] as const;

/** Content a cut to the card's box, as a picture on a stage with no margin (its texels the frame's px). */
export function stampGatePictureCard(): StampPictureRgba {
  const { width } = STAMP_GATE_THREE_SIZE, content = stampGateThreeContent('a'), w = BOX.x1 - BOX.x0, h = BOX.y1 - BOX.y0;
  const rgba = new Float32Array(w * h * 4);
  for (let j = 0; j < h; j++) rgba.set(content.subarray(((BOX.y0 + j) * width + BOX.x0) * 4, ((BOX.y0 + j) * width + BOX.x1) * 4), j * w * 4);
  return { box: { x: BOX.x0, y: BOX.y0, w, h }, rgba };
}

/** The ground as a picture over the whole frame. */
export function stampGatePictureGround(): StampPictureRgba {
  const { width: w, height: h } = STAMP_GATE_THREE_SIZE, rgba = new Float32Array(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([...GROUND, 1], i);
  return { box: { x: 0, y: 0, w, h }, rgba };
}

/**
 * The three-plane defocus case's lens, the card's look defocused as much as its focus blurs the three card's texels:
 * a picture plane defocuses by its look, a three plane by its texels' distances.
 */
export const STAMP_GATE_PICTURE_DEFOCUS_LENS: StampLensFrame = {
  ...STAMP_GATE_THREE_DEFOCUS_LENS, planes: new Map([[STAMP_GATE_CARD, { ...STAMP_GATE_REST_LOOK, defocus: STAMP_GATE_THREE_DEFOCUS }]]),
};

const card = (): StampPlane => ({ id: STAMP_GATE_CARD, depth: 1, source: { kind: 'picture', extent: { kind: 'box', box: BOX } } });

/** The three-plane case's planes with the card a picture: the ground painted at the back, the front's box before it. */
export function stampGatePicturePlanes(painting: CompiledStampPaint): StampLaidPlanes {
  const problems: string[] = [];
  const compiled = stampScenePlanes(painting, [
    { id: 'ground', depth: 2, source: { kind: 'painted', groups: ['ground'] } }, card(), { id: 'front', depth: 0.8, source: { kind: 'painted', groups: ['front'] } },
  ], problems);
  if (!compiled || problems.length) throw new Error(`stamp gate: the picture case's planes: ${problems.join('; ')}`);
  return compiled;
}

/** The scene of pictures alone: the ground a picture at the back, the card before it. */
export function stampGatePictureOnlyPlanes(): StampLaidPlanes {
  const problems: string[] = [];
  const compiled = stampScenePlanes(null, [{ id: 'ground', depth: 2, source: { kind: 'picture', extent: { kind: 'everywhere' } } }, card()], problems);
  if (!compiled || problems.length) throw new Error(`stamp gate: the pictures-alone planes: ${problems.join('; ')}`);
  return compiled;
}

type Rgba = ArrayLike<number>;

/**
 * The case's checks, from its frames: the card as a picture and as a three plane of content a, each `sharp` and
 * `blurred` (defocused through the lens); and the scene of pictures alone, with the card (`alone`) and without
 * (`aloneClear`, its picture at that moment none).
 */
export function checkStampGatePicture(
  { picture, three, alone, aloneClear }: { picture: Record<'sharp' | 'blurred', Rgba>; three: Record<'sharp' | 'blurred', Rgba>; alone: Rgba; aloneClear: Rgba },
): StampGateWashCheck[] {
  const sharp = stampGateFrameDifference(picture.sharp, three.sharp), blurred = stampGateFrameDifference(picture.blurred, three.blurred);
  return [{
    id: `${STAMP_GATE_PICTURE_ID}: a picture plane lays as a three plane of the same content, sharp and defocused`,
    passed: stampGateFramePasses(sharp) && blurred.max <= STAMP_GATE_DEFOCUS_TOLERANCE,
    detail: `sharp: max ${sharp.max}, mean ${sharp.mean.toFixed(4)}; defocused (a gaussian against the three's per-texel defocus): max ${blurred.max} (past ${STAMP_GATE_DEFOCUS_TOLERANCE} fails), mean ${blurred.mean.toFixed(4)}`,
  }, { ...checkStampGateCardColours(alone, aloneClear), id: `${STAMP_GATE_PICTURE_ID}: in a scene of pictures alone, the card's colours show as themselves` }];
}
