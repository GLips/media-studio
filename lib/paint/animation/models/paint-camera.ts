// paint-camera.ts: the multiplane camera (plan 2's "The camera") as data on plays' clocks, and the camera step,
// which comes after a group's own and its ancestors' bends and placements (plan 1's step 5): its similarity folds
// into the group's lay, its warp kept a warp, and its focus gives the group a defocus blur.
//
// A plane is painted the size it looks through the camera at rest, so at rest the step is the identity. A canvas
// group, or one with no anchor, never sees the camera.
//
// Unless a play holds it, the camera is on ones: each render frame gets a new pose and each plane a new lay, which
// the renderer's group films make cheap.

import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { StampGroupFrameState, StampGroupGlow, StampGroupLay, StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintLanePlayAt, paintPlayClipTimeAt, sceneSeconds, type PaintLane, type PaintPlayClock } from './paint-clock.ts';
import { paintPxRounded, paintRatioRounded, paintSigmaRounded } from './paint-deform.ts';
import { paintKeySpanAt, type PaintEase } from './paint-motion-clips.ts';
import {
  paintPlacementOfSimilarity, paintSimilarityAfter, paintSimilarityOf, paintSimilarityScale, type PaintSimilarity,
} from './paint-similarity.ts';

/** The frame's centre on `stage` (the renderer's: the frame and the margin it paints past it), what planes scale about. */
export const paintStageCentre = ({ frame }: StampStage): StampPoint => ({ x: frame.width / 2, y: frame.height / 2 });

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
 * `aperture` is the defocus, stage px of gaussian sigma, a plane at infinity gets (paintPlaneDefocus).
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

/** How near the camera a plane or its focus may come, depth units: nearer, its scale runs off toward infinity. */
export const PAINT_CAMERA_NEAREST = 1e-3;

/**
 * A camera checked (paint-camera-build.ts): its stage, each plane-anchored group's depth by id, each outside layer's
 * (a 3D layer's) depth by its id, and its plays in a lane per thing they write.
 */
export type PaintCamera = {
  readonly stage: StampStage;
  readonly animationFps: number;
  readonly planes: ReadonlyMap<string, number>;
  readonly outsidePlanes: ReadonlyMap<string, number>;
  readonly move: PaintLane<PaintCameraMoveClip>;
  readonly focus: PaintLane<PaintCameraFocusClip>;
};

function moveKeyProblem({ pan = { x: 0, y: 0 }, dolly = 0, zoom = 1, roll = 0 }: PaintCameraMoveKey): string | null {
  if (![pan.x, pan.y, dolly, zoom, roll].every(Number.isFinite)) return 'needs finite pan, dolly, zoom and roll';
  // Rounded as evaluation rounds it; eased values never pass a key's, so positive keys keep every frame's positive.
  return paintRatioRounded(zoom) > 0 ? null : `zooms to ${zoom}; a zoom must be above 0 (1 at rest) as rounded to a millionth`;
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

/** Where the camera is at scene time `t`: before the first move starts, that move's first key's pose; at rest with no move. */
export function paintCameraPoseAt(camera: PaintCamera, t: number): PaintCameraPose {
  const play = paintLanePlayAt(camera.move, sceneSeconds(t));
  return play ? paintCameraMoveAt(play.clip, paintPlayClipTimeAt(play.clock, sceneSeconds(t), camera.animationFps)) : PAINT_CAMERA_REST;
}

/** The camera's focus at scene time `t`: before the first focus play starts, its first key's; null, every plane sharp, with none. */
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

/** `glow` (its sigma in anchor px) as laid at `scale`: its sigma grown, never rounded to 0. */
export const paintGlowScaled = (glow: StampGroupGlow, scale: number): StampGroupGlow => ({ ...glow, sigma: paintSigmaRounded(glow.sigma * scale) });

/** The camera at one scene time `t`: its pose, its focus (null for none), and the frame's centre planes scale about. */
export type PaintCameraView = { readonly t: number; readonly pose: PaintCameraPose; readonly lens: PaintCameraFocus | null; readonly centre: StampPoint };

export const paintCameraViewAt = (camera: PaintCamera, t: number): PaintCameraView =>
  ({ t, pose: paintCameraPoseAt(camera, t), lens: paintCameraFocusAt(camera, t), centre: paintStageCentre(camera.stage) });

/** How the camera shows a thing at a depth: the similarity laying it, and its defocus and glow as the frame draws them. */
export type PaintCameraDepthLook = { readonly view: PaintSimilarity; readonly defocus: number; readonly glow: StampGroupGlow | undefined };

/**
 * What `view` does to `name` at `depth` (a plane, or a 3D layer there), its own defocus and glow in anchor px: its
 * similarity, its defocus scaled with the lens's added (by variance), its glow's sigma scaled. Throws on it or the
 * focus at or behind the camera: a build can't hold every curve between its checked times.
 */
export function paintCameraDepthLook({ t, pose, lens, centre }: PaintCameraView, name: string, depth: number, own: Pick<StampGroupFrameState, 'defocus' | 'glow'>): PaintCameraDepthLook {
  if (depth - pose.dolly <= PAINT_CAMERA_NEAREST) throw new Error(`paint camera: at ${t}s the camera, dollied ${pose.dolly}, is at or past ${name}'s plane at depth ${depth}`);
  if (lens && lens.focus - pose.dolly <= PAINT_CAMERA_NEAREST) throw new Error(`paint camera: at ${t}s the camera focuses at depth ${lens.focus}, at or behind itself (dollied ${pose.dolly})`);
  const view = paintPlaneSimilarity(pose, depth, centre), scale = paintSimilarityScale(view);
  const defocus = paintPxRounded(Math.hypot((own.defocus ?? 0) * scale, lens ? paintPlaneDefocus(lens, pose.dolly, depth) : 0));
  return { view, defocus, glow: own.glow && paintGlowScaled(own.glow, scale) };
}

/** `lay` (about its pivot) with `view` after it; a group without one is laid by `view` alone, about `centre`. */
function viewedLay(view: PaintSimilarity, lay: StampGroupLay | undefined, centre: StampPoint): StampGroupLay {
  if (!lay) return { placement: paintPlacementOfSimilarity(view, centre), pivot: centre };
  return { placement: paintPlacementOfSimilarity(paintSimilarityAfter(view, paintSimilarityOf(lay.placement, lay.pivot)), lay.pivot), pivot: lay.pivot };
}

/**
 * `state` as the camera shows it at scene time `t`: each group on a plane laid by the camera after its own lay (its
 * warp kept), its defocus and glow as paintCameraDepthLook gives them. A plane with no state gains one; every other
 * group is handed on as it was.
 */
export function paintCameraFrameStateAt(camera: PaintCamera, state: StampPaintFrameState, t: number): StampPaintFrameState {
  const seen = paintCameraViewAt(camera, t), moved = !paintCameraPoseIsRest(seen.pose);
  if (!moved && !seen.lens) return state;
  const viewed = new Map(state);
  for (const [id, depth] of camera.planes) {
    const { lay, defocus: own, glow: ownGlow, ...rest } = state.get(id) ?? {};
    const { view, defocus, glow } = paintCameraDepthLook(seen, id, depth, { defocus: own, glow: ownGlow });
    const laid: StampGroupFrameState = {
      ...rest,
      ...(moved ? { lay: viewedLay(view, lay, seen.centre) } : lay && { lay }),
      ...(defocus > 0 && { defocus }),
      ...(glow && { glow }),
    };
    viewed.set(id, laid);
  }
  return viewed;
}
