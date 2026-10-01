// paint-camera.ts: the multiplane camera (plan 2's "The camera") as data on plays' clocks, and the camera step,
// which comes after a group's own and its ancestors' bends and placements (plan 1's step 5): its similarity folds
// into the group's lay, its warp kept a warp, and its focus gives the group a defocus blur.
//
// A plane is painted the size it looks through the camera at rest, so at rest the step is the identity. A canvas
// group, or one with no anchor, never sees the camera.
//
// Unless a play holds it, the camera is on ones: each render frame gets a new pose and each plane a new lay, which
// the renderer's per-group layer cache makes cheap.

import type { StampGroupFrameState, StampGroupLay, StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintLanePlayAt, paintPlayClipTimeAt, sceneSeconds, type PaintLane, type PaintPlayClock } from './paint-clock.ts';
import { paintPxRounded, paintRatioRounded } from './paint-deform.ts';
import { paintKeySpanAt, type PaintEase } from './paint-motion-clips.ts';
import {
  paintPlacementOfSimilarity, paintSimilarityAfter, paintSimilarityOf, paintSimilarityScale, type PaintSimilarity,
} from './paint-similarity.ts';

/**
 * The painting's stage: the frame, `width` by `height` px from (0, 0), and `margin` px the renderer paints past each
 * side of it (the same margin the scene gives the renderer), so a camera can bring in what lies just off the frame.
 */
export type PaintStage = { readonly width: number; readonly height: number; readonly margin: number };

export const paintStageCentre = ({ width, height }: PaintStage): StampPoint => ({ x: width / 2, y: height / 2 });

/**
 * What a group's rest coordinates are relative to. `canvas`: the stage itself, untouched by the camera (a title card).
 * `{ plane }`: a plane that many depth units from the camera's rest position (above 0; pan is measured at 1), its
 * space as it looks through the camera at rest. Plan 3 adds a surface.
 */
export type PaintAnchor = 'canvas' | { readonly plane: number };

/**
 * Where the camera is. `pan`: px, as a plane at depth 1 sees it move; `dolly`: depth units toward the planes; `zoom`:
 * the lens, 1 at rest; `roll`: radians, y-down like every angle in the painting, so the picture turns by −roll.
 */
export type PaintCameraPose = { readonly pan: StampPoint; readonly dolly: number; readonly zoom: number; readonly roll: number };

export const PAINT_CAMERA_REST: PaintCameraPose = { pan: { x: 0, y: 0 }, dolly: 0, zoom: 1, roll: 0 };

/**
 * The lens's focus: `focus` is the depth held sharp (a depth like a plane's, so a dolly keeps the same plane sharp);
 * `aperture` is the blur, stage px of gaussian sigma, a plane gets at the far limit (paintPlaneDefocus).
 */
export type PaintCameraFocus = { readonly focus: number; readonly aperture: number };

/** A pose `at` s into the clip, reached from the key before by `ease`; a field left out is at rest there. */
export type PaintCameraMoveKey = { readonly at: number; readonly pan?: StampPoint; readonly dolly?: number; readonly zoom?: number; readonly roll?: number; readonly ease?: PaintEase };
/** A focus `at` s into the clip, reached from the key before by `ease`. */
export type PaintCameraFocusKey = PaintCameraFocus & { readonly at: number; readonly ease?: PaintEase };

/** The camera's pose keyed, keys in increasing order. */
export type PaintCameraMoveClip = { readonly kind: 'move'; readonly keys: readonly PaintCameraMoveKey[] };
/** The camera's focus keyed (a focus pull), keys in increasing order. */
export type PaintCameraFocusClip = { readonly kind: 'focus'; readonly keys: readonly PaintCameraFocusKey[] };
export type PaintCameraClip = PaintCameraMoveClip | PaintCameraFocusClip;

/** A clip played on the camera through its own clock (no node's holds reach it); `origin` names it in errors. */
export type PaintCameraPlay = { readonly clip: PaintCameraClip; readonly clock: PaintPlayClock; readonly origin: string };

export const paintCameraPlay = (clip: PaintCameraClip, timing: { readonly clock: PaintPlayClock; readonly origin: string }): PaintCameraPlay => ({ clip, ...timing });

/**
 * A camera checked (paint-camera-build.ts): its stage, each plane-anchored group's depth by id, and its plays in a
 * lane per thing they write.
 */
export type PaintCamera = {
  readonly stage: PaintStage;
  readonly animationFps: number;
  readonly planes: ReadonlyMap<string, number>;
  readonly move: PaintLane<PaintCameraMoveClip>;
  readonly focus: PaintLane<PaintCameraFocusClip>;
};

function moveKeyProblem({ pan = { x: 0, y: 0 }, dolly = 0, zoom = 1, roll = 0 }: PaintCameraMoveKey): string | null {
  if (![pan.x, pan.y, dolly, zoom, roll].every(Number.isFinite)) return 'needs finite pan, dolly, zoom and roll';
  return zoom > 0 ? null : `zooms to ${zoom}; a zoom must be above 0 (1 at rest)`;
}

const focusKeyProblem = ({ focus, aperture }: PaintCameraFocusKey) =>
  focus > 0 && Number.isFinite(focus) && aperture >= 0 && Number.isFinite(aperture) ? null : `needs a focus depth above 0 and an aperture of 0 or more, not ${focus} and ${aperture}`;

/** Why `clip` can't be played, or null: no keys, times not increasing, numbers not finite, a zoom or focus not above 0. */
export function paintCameraClipProblem(clip: PaintCameraClip): string | null {
  if (!clip.keys.length) return 'it has no keys';
  const keyProblems = clip.kind === 'move' ? clip.keys.map(moveKeyProblem) : clip.keys.map(focusKeyProblem);
  for (const [i, key] of clip.keys.entries()) {
    if (!Number.isFinite(key.at)) return `key ${i} is at ${key.at}s, not a finite time`;
    if (i && !(key.at > clip.keys[i - 1].at)) return `its keys need increasing times; key ${i} is at ${key.at}s after ${clip.keys[i - 1].at}s`;
    if (keyProblems[i]) return `key ${i} ${keyProblems[i]}`;
  }
  return null;
}

const between = (a: number, b: number, share: number) => a + (b - a) * share;

/** The camera's pose time s into a move clip, rounded to the steps keys hold. */
export function paintCameraMoveAt(clip: PaintCameraMoveClip, time: number): PaintCameraPose {
  const { from, to, share } = paintKeySpanAt(clip.keys, Math.max(0, time));
  const a = { ...PAINT_CAMERA_REST, ...clip.keys[from] }, b = { ...PAINT_CAMERA_REST, ...clip.keys[to] };
  return {
    pan: { x: paintPxRounded(between(a.pan.x, b.pan.x, share)), y: paintPxRounded(between(a.pan.y, b.pan.y, share)) },
    dolly: paintRatioRounded(between(a.dolly, b.dolly, share)),
    zoom: paintRatioRounded(between(a.zoom, b.zoom, share)),
    roll: paintRatioRounded(between(a.roll, b.roll, share)),
  };
}

/** The camera's focus time s into a focus clip, rounded to the steps keys hold. */
export function paintCameraFocusClipAt(clip: PaintCameraFocusClip, time: number): PaintCameraFocus {
  const { from, to, share } = paintKeySpanAt(clip.keys, Math.max(0, time));
  const a = clip.keys[from], b = clip.keys[to];
  return { focus: paintRatioRounded(between(a.focus, b.focus, share)), aperture: paintPxRounded(between(a.aperture, b.aperture, share)) };
}

/** Where the camera is at scene time `t`: at rest before any move is played. */
export function paintCameraPoseAt(camera: PaintCamera, t: number): PaintCameraPose {
  const play = paintLanePlayAt(camera.move, sceneSeconds(t));
  return play ? paintCameraMoveAt(play.clip, paintPlayClipTimeAt(play.clock, sceneSeconds(t), camera.animationFps)) : PAINT_CAMERA_REST;
}

/** The camera's focus at scene time `t`; null, every plane sharp, when no focus is played. */
export function paintCameraFocusAt(camera: PaintCamera, t: number): PaintCameraFocus | null {
  const play = paintLanePlayAt(camera.focus, sceneSeconds(t));
  return play ? paintCameraFocusClipAt(play.clip, paintPlayClipTimeAt(play.clock, sceneSeconds(t), camera.animationFps)) : null;
}

export const paintCameraPoseIsRest = ({ pan, dolly, zoom, roll }: PaintCameraPose) => pan.x === 0 && pan.y === 0 && dolly === 0 && zoom === 1 && roll === 0;

/**
 * How the camera shows a plane at `depth`, anchor px to stage px: scaled zoom·d/(d − dolly) about the frame's
 * `centre`, shifted by −pan·zoom/(d − dolly), then turned by −roll about the centre. A pinhole camera at the pan,
 * dollied and rolled, projects exactly so (paint-camera-world.ts builds that camera for three.js).
 */
export function paintPlaneSimilarity({ pan, dolly, zoom, roll }: PaintCameraPose, depth: number, centre: StampPoint): PaintSimilarity {
  const distance = depth - dolly, s = (zoom * depth) / distance, ca = Math.cos(-roll), sa = Math.sin(-roll);
  const shiftX = (-pan.x * zoom) / distance, shiftY = (-pan.y * zoom) / distance;
  // p ↦ c + R(−roll)·(s·(p − c) + shift): m = s·R, k = c − m·c + R·shift.
  const ma = s * ca, mb = s * sa;
  return { ma, mb, kx: centre.x - (ma * centre.x - mb * centre.y) + (ca * shiftX - sa * shiftY), ky: centre.y - (mb * centre.x + ma * centre.y) + (sa * shiftX + ca * shiftY) };
}

/** A defocus below this sigma, stage px, is drawn sharp: no blur pass for a change nobody sees. */
export const PAINT_DEFOCUS_LEAST = 0.1;

/**
 * A plane's defocus, stage px of gaussian sigma: a thin lens's circle of confusion, aperture·|1 − f/s|, f the focus's
 * distance (focus − dolly), s the plane's (depth − dolly). The lens's own factor f/(f − focal length), near 1, is
 * left in the aperture. A gaussian of sigma σ spreads as a disc 4σ across, so a/4 stands for an a px disc.
 */
export function paintPlaneDefocus({ focus, aperture }: PaintCameraFocus, dolly: number, depth: number): number {
  const sigma = paintPxRounded(aperture * Math.abs(1 - (focus - dolly) / (depth - dolly)));
  return sigma < PAINT_DEFOCUS_LEAST ? 0 : sigma;
}

/** `lay` (about its pivot) with `view` after it; a group without one is laid by `view` alone, about `centre`. */
function viewedLay(view: PaintSimilarity, lay: StampGroupLay | undefined, centre: StampPoint): StampGroupLay {
  if (!lay) return { placement: paintPlacementOfSimilarity(view, centre), pivot: centre };
  return { placement: paintPlacementOfSimilarity(paintSimilarityAfter(view, paintSimilarityOf(lay.placement, lay.pivot)), lay.pivot), pivot: lay.pivot };
}

/**
 * `state` as the camera shows it at scene time `t`: each group on a plane laid by the camera after its own lay (its
 * warp kept), its blur and glow radius grown with the camera's scale, its defocus added (gaussians add by variance).
 * A plane with no state gains one; every other group is handed on as it was.
 */
export function paintCameraFrameStateAt(camera: PaintCamera, state: StampPaintFrameState, t: number): StampPaintFrameState {
  const pose = paintCameraPoseAt(camera, t), lens = paintCameraFocusAt(camera, t), moved = !paintCameraPoseIsRest(pose);
  if (!moved && !lens) return state;
  const centre = paintStageCentre(camera.stage), viewed = new Map(state);
  for (const [id, depth] of camera.planes) {
    const { lay, blur: given = 0, glow, ...rest } = state.get(id) ?? {};
    const view = paintPlaneSimilarity(pose, depth, centre), scale = paintSimilarityScale(view);
    const blur = paintPxRounded(Math.hypot(given * scale, lens ? paintPlaneDefocus(lens, pose.dolly, depth) : 0));
    const laid: StampGroupFrameState = {
      ...rest,
      ...(moved ? { lay: viewedLay(view, lay, centre) } : lay && { lay }),
      ...(blur > 0 && { blur }),
      ...(glow && { glow: { ...glow, radius: paintPxRounded(glow.radius * scale) } }),
    };
    viewed.set(id, laid);
  }
  return viewed;
}
