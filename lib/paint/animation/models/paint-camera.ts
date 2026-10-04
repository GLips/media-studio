// paint-camera.ts: the multiplane camera, one description that painted planes and three.js sources both read: its
// pose and focus as plays on clocks, its projection (a vertical field of view) and its lens (a bloom and a shutter), each in the
// units its type names. It places each plane's picture by a similarity and blurs it by its depth; it never edits a
// group's lay, which stays inside its plane's picture.
//
// Planes stay parallel to the image: the camera pans, dollies, zooms and rolls. A plane is painted the size it looks
// at rest, so at rest every plane's similarity is the identity. Unless a play holds it, the camera is on ones.

import { LENS_DEFOCUS_LEAST, lensApertureSlide, lensDefocusSigned } from '#lib/picture/lens/models/lens-focus.ts';
import type { LensExposure } from '#lib/picture/lens/models/lens-exposures.ts';
import { shutterOpensAt } from '#lib/picture/lens/models/lens-shutter.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { StampLensFrame, StampPlaneExtent, StampPlaneLook } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { paintLaneClipAt, type PaintLane, type PaintPlayClock } from './paint-clock.ts';
import { paintPxRounded, paintRatioRounded } from './paint-deform.ts';
import { paintKeySpanAt, type PaintEase } from './paint-motion-clips.ts';
import type { PaintSimilarity } from './paint-similarity.ts';

/** The frame's centre on `stage` (the renderer's: the frame and the margin it paints past it), what planes scale about. */
export const paintStageCentre = ({ frame }: StampStage): StampPoint => ({ x: frame.width / 2, y: frame.height / 2 });

/**
 * Where the camera is. `pan`: px, as a plane at depth 1 sees it move; `dolly`: depth units toward the planes; `zoom`:
 * the lens, 1 at rest; `roll`: radians, y-down like every angle in the painting, so the picture turns by −roll.
 */
export type PaintCameraPose = { readonly pan: StampPoint; readonly dolly: number; readonly zoom: number; readonly roll: number };

export const PAINT_CAMERA_REST: PaintCameraPose = { pan: { x: 0, y: 0 }, dolly: 0, zoom: 1, roll: 0 };

/**
 * The lens's focus: `focus` is the depth held sharp (a depth like a plane's, so a dolly keeps the same plane sharp);
 * `aperture` is the defocus, frame px of gaussian sigma, a plane at infinity gets (paintPlaneDefocus).
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
 * The lens past its focus: `bloom`, the sigma in frame px of the gaussian spreading the frame's emission; `shutter`,
 * seconds open about each frame's time (lens-shutter.ts; REEL_SHUTTER is the reel's).
 */
export type PaintCameraLens = { readonly bloom: number; readonly shutter: number };

/**
 * The opaque back's painting: `box`, the document px its paint fills wherever its node moves it, and `lay`, document
 * px to plane px. Past the box lies bare paper, so the frame, and all its blur reads, stay inside it.
 */
export type PaintCameraPaintedBox = { readonly box: StampBox; readonly lay: PaintSimilarity };

/**
 * A picture plane, `depth` units from the camera at rest: a picture on the stage, held as far as its `extent`; the
 * opaque back's also `painted` over a box (PaintCameraPaintedBox) where its lay is known as the camera builds.
 */
export type PaintCameraPicturePlane = {
  readonly id: string; readonly depth: number; readonly kind: 'picture'; readonly extent: StampPlaneExtent; readonly painted?: PaintCameraPaintedBox;
};

/**
 * A three plane, `depth` units from the camera at rest: a three.js render, drawn each frame through the camera's
 * perspective. `margin`: the px its render reaches past the frame on every side, so its defocus blurs in what lies
 * beyond the edge; the build sets it.
 */
export type PaintCameraThreePlane = { readonly id: string; readonly depth: number; readonly kind: 'three'; readonly margin: number };

/**
 * An instanced plane: items laid through the lens each at its own depth within `depths`, `near` no farther than `far`.
 * The stage holds no picture of it, so it has no extent: the build checks only that the camera stays short of `near`.
 */
export type PaintCameraInstancedPlane = { readonly id: string; readonly kind: 'instanced'; readonly depths: { readonly near: number; readonly far: number } };

/** A plane the camera shows, as built. */
export type PaintCameraPlane = PaintCameraPicturePlane | PaintCameraThreePlane | PaintCameraInstancedPlane;

/** A plane as written to the build. */
export type PaintCameraPlaneOptions = PaintCameraPicturePlane | Omit<PaintCameraThreePlane, 'margin'> | PaintCameraInstancedPlane;

/** The nearest depth anything of `plane` lies at. */
export const paintCameraPlaneNearest = (plane: PaintCameraPlaneOptions): number => (plane.kind === 'instanced' ? plane.depths.near : plane.depth);
/** The farthest depth anything of `plane` lies at. */
export const paintCameraPlaneFarthest = (plane: PaintCameraPlaneOptions): number => (plane.kind === 'instanced' ? plane.depths.far : plane.depth);

/**
 * A camera checked (paint-camera-build.ts): its `stage`, its projection (`fov`, vertical degrees at rest: how deep a
 * three.js world looks, never where a plane lands), its planes farthest first, its lens and its plays.
 */
export type PaintCamera = {
  readonly stage: StampStage;
  readonly fov: number;
  readonly planes: readonly PaintCameraPlane[];
  readonly lens: PaintCameraLens;
  readonly animationFps: number;
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

/** Where the camera is at moment `t` (paintMoment): before the first move starts, that move's first key's pose; at rest with no move. */
export function paintCameraPoseAt(camera: PaintCamera, t: PaintMoment): PaintCameraPose {
  const playing = paintLaneClipAt(camera.move, t, camera.animationFps);
  return playing ? paintCameraMoveAt(playing.play.clip, playing.time) : PAINT_CAMERA_REST;
}

/** The camera's focus at moment `t`: before the first focus play starts, its first key's; null, every plane sharp, with none. */
export function paintCameraFocusAt(camera: PaintCamera, t: PaintMoment): PaintCameraFocus | null {
  const playing = paintLaneClipAt(camera.focus, t, camera.animationFps);
  return playing ? paintCameraFocusClipAt(playing.play.clip, playing.time) : null;
}

/**
 * How the camera shows a plane at `depth`, plane px to frame px: scaled zoom·d/(d − dolly) about the frame's
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

/** How `camera` shows a plane at `depth` at moment `t`, plane px to frame px: paintPlaneSimilarity at its pose then. */
export const paintPlaneViewAt = (camera: PaintCamera, depth: number, t: PaintMoment): PaintSimilarity =>
  paintPlaneSimilarity(paintCameraPoseAt(camera, t), depth, paintStageCentre(camera.stage));

/**
 * A plane's defocus, frame px of gaussian sigma: the lens's (lens-focus.ts) at the plane's distance from the camera,
 * depth − dolly, its focus focus − dolly away.
 */
export function paintPlaneDefocus({ focus, aperture }: PaintCameraFocus, dolly: number, depth: number): number {
  const sigma = paintPxRounded(Math.abs(lensDefocusSigned({ focus: focus - dolly, aperture }, depth - dolly)));
  return sigma < LENS_DEFOCUS_LEAST ? 0 : sigma;
}

/**
 * How the camera shows anything at a depth in one frame: `lookAt(depth, name)` gives its look there (its
 * similarity, its defocus with a focus play, its views at the shutter's ends when the camera moves over a fast frame's
 * shutter), throwing on a depth at or behind the camera, which `name` names; and the lens's bloom and focus.
 */
export type PaintCameraDepthLooks = {
  readonly lookAt: (depth: number, name: string) => StampPlaneLook;
  readonly bloom: number;
  readonly focus: StampLensFrame['focus'];
};

/**
 * The camera's looks at `t` (PaintCameraDepthLooks); for a reference `exposure`, as at its moment from its aperture
 * point, slid and sharp. Throws on the focus at or behind the camera: a build can't hold every curve between its checks.
 */
export function paintCameraDepthLooks(camera: PaintCamera, t: number, exposure: { at: number; aperture: LensExposure['aperture'] } | null = null): PaintCameraDepthLooks {
  const aperture = exposure?.aperture, seenAt = paintMoment(exposure?.at ?? t, t);
  const pose = paintCameraPoseAt(camera, seenAt), lens = paintCameraFocusAt(camera, seenAt), centre = paintStageCentre(camera.stage);
  if (lens && lens.focus - pose.dolly <= PAINT_CAMERA_NEAREST) throw new Error(`paint camera: at ${seenAt.at}s the camera focuses at depth ${lens.focus}, at or behind itself (dollied ${pose.dolly})`);
  // A fast frame is gathered along the camera's motion over the shutter, if it moves; an exposure is its own moment.
  const { shutter } = camera.lens, opens = shutterOpensAt(t, shutter), opening = !aperture && shutter > 0;
  const openPose = opening ? paintCameraPoseAt(camera, paintMoment(opens, t)) : pose, closePose = opening ? paintCameraPoseAt(camera, paintMoment(opens + shutter, t)) : pose;
  const moving = !paintCameraPosesEqual(openPose, closePose), nearest = Math.max(pose.dolly, openPose.dolly, closePose.dolly);
  const lookAt = (depth: number, name: string): StampPlaneLook => {
    if (depth - nearest <= PAINT_CAMERA_NEAREST) throw new Error(`paint camera: at ${t}s the camera, dollied ${nearest}, is at or past ${name} at depth ${depth}`);
    const view = paintPlaneSimilarity(pose, depth, centre), distance = depth - pose.dolly;
    if (!aperture) {
      const seen = moving ? { open: paintPlaneSimilarity(openPose, depth, centre), close: paintPlaneSimilarity(closePose, depth, centre) } : null;
      return { view, defocus: lens ? paintPlaneDefocus(lens, pose.dolly, depth) : 0, distance, shutter: seen };
    }
    const slide = lens ? lensApertureSlide({ focus: lens.focus - pose.dolly, aperture: lens.aperture }, distance, aperture) : { x: 0, y: 0 };
    return { view: { ...view, kx: view.kx + slide.x, ky: view.ky + slide.y }, defocus: 0, distance, shutter: null };
  };
  const focus = lens && !aperture ? { focus: lens.focus - pose.dolly, aperture: lens.aperture } : null;
  return { lookAt, bloom: camera.lens.bloom, focus };
}

/** `looks` as the frame's lens: each of the camera's planes' looks at its depth, an instanced plane's items looked at one by one. */
export function paintCameraLensFrame(camera: PaintCamera, looks: PaintCameraDepthLooks): StampLensFrame {
  const planes = new Map(camera.planes.flatMap((plane) => (plane.kind === 'instanced' ? [] : [[plane.id, looks.lookAt(plane.depth, `plane ${plane.id}`)] as const])));
  return { planes, bloom: looks.bloom, focus: looks.focus };
}

/** What the camera does in the frame at `t` (paintCameraDepthLooks), as each of its planes is looked at. */
export const paintCameraLensAt = (camera: PaintCamera, t: number, exposure: { at: number; aperture: LensExposure['aperture'] } | null = null): StampLensFrame =>
  paintCameraLensFrame(camera, paintCameraDepthLooks(camera, t, exposure));

const paintCameraPosesEqual = (a: PaintCameraPose, b: PaintCameraPose) =>
  a.pan.x === b.pan.x && a.pan.y === b.pan.y && a.dolly === b.dolly && a.zoom === b.zoom && a.roll === b.roll;
