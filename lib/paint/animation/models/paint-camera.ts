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
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
import { paintLaneClipAt, paintPlayClipMomentAt, type CompiledPaintPlay, type PaintLane, type PaintPlayClock } from './paint-clock.ts';
import { paintPxRounded, paintRatioRounded } from './paint-deform.ts';
import { paintClipMoment, paintLaneSnapsBetween } from './paint-motion-clips.ts';
import { paintSimilaritiesEqual, type PaintSimilarity } from './paint-similarity.ts';
import { presentationValueAt, type PresentationValue } from './paint-value.ts';

/** The frame's centre on `stage` (the renderer's: the frame and the margin it paints past it), what planes scale about. */
export const paintStageCentre = ({ frame }: StampStage): StampPoint => ({ x: frame.width / 2, y: frame.height / 2 });

/**
 * Where the camera is. `pan`: px the camera moves, as a plane at depth 1 sees it, so a positive x slides the picture
 * left (paintPlaneSimilarity); `dolly`: depth units toward the planes; `zoom`: the lens, 1 at rest; `roll`: radians,
 * y-down like every angle in the painting, so the picture turns by −roll.
 */
export type PaintCameraPose = { readonly pan: StampPoint; readonly dolly: number; readonly zoom: number; readonly roll: number };

export const PAINT_CAMERA_REST: PaintCameraPose = { pan: { x: 0, y: 0 }, dolly: 0, zoom: 1, roll: 0 };

/**
 * The lens's focus: `focus` is the depth held sharp (a depth like a plane's, so a dolly keeps the same plane sharp);
 * `aperture` is the defocus, frame px of gaussian sigma, a plane at infinity gets (paintPlaneDefocus).
 */
export type PaintCameraFocus = { readonly focus: number; readonly aperture: number };

/** What a move sets: the parts of a pose it names, the rest at rest (or, for a move that adds, adding nothing). */
export type PaintCameraMovePose = { readonly pan?: StampPoint; readonly dolly?: number; readonly zoom?: number; readonly roll?: number };

/** The camera's pose, a value of the clip's moment (paint-value.ts; paintKeyed keys one). */
export type PaintCameraMoveClip = { readonly kind: 'move'; readonly value: PresentationValue<PaintCameraMovePose> };
/** The camera's focus, a value of the clip's moment (a focus pull, keyed). */
export type PaintCameraFocusClip = { readonly kind: 'focus'; readonly value: PresentationValue<PaintCameraFocus> };
export type PaintCameraClip = PaintCameraMoveClip | PaintCameraFocusClip;

/**
 * A clip played on the camera through its own clock (no node's holds reach it); `origin` names it in errors. A move
 * with `blend: 'add'` adds its parts to the pose under it (the move playing then, else rest), a part left out adding
 * 0. Any number of moves may add at once; two that don't, overlapping, are refused.
 */
export type PaintCameraPlay = { readonly clip: PaintCameraClip; readonly clock: PaintPlayClock; readonly origin: string; readonly blend?: 'add' };

export const paintCameraPlay = (clip: PaintCameraClip, timing: { readonly clock: PaintPlayClock; readonly origin: string; readonly blend?: 'add' }): PaintCameraPlay => ({ clip, ...timing });

/** How near the camera a plane or its focus may come, depth units: nearer, its scale runs off toward infinity. */
export const PAINT_CAMERA_NEAREST = 1e-3;

/**
 * How long the shutter stays open about each frame's time (lens-shutter.ts): seconds, more than 0; or `'shut'`, every
 * frame drawn sharp on purpose.
 */
export type PaintCameraShutter = number | 'shut';

/**
 * The lens past its focus, as a camera is built with it: `bloom`, the sigma in frame px of the gaussian spreading the
 * frame's emission; its `shutter`.
 */
export type PaintCameraLensOptions = { readonly bloom: number; readonly shutter: PaintCameraShutter };

/** The lens built: `bloom` as written; `shutter`, seconds open about each frame's time, 0 when shut. */
export type PaintCameraLens = { readonly bloom: number; readonly shutter: number };

/** The film's shutter at `filmFps` frames a second: open half a frame (a 180° shutter), seconds. */
export const paintFilmShutter = (filmFps: number) => 1 / (2 * filmFps);

/** Whether `lens`'s shutter is shut: each frame one instant, nothing smeared along its motion. */
export const paintCameraShutterShut = (lens: PaintCameraLens) => lens.shutter === 0;

/**
 * A picture plane: a picture on the stage, held as far as its `extent`, `depth` units from the camera at rest. A depth
 * in time is read at the frame's moments, a shot's plane's clock already in it: the plane approaches or recedes.
 */
export type PaintCameraPicturePlane = { readonly id: string; readonly depth: PresentationValue<number>; readonly kind: 'picture'; readonly extent: StampPlaneExtent };

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

/** The poses some frames of a shot show (each frame's own and its shutter's ends), and `when` they are. */
export type PaintCameraPoseSpan = { readonly poses: readonly PaintCameraPose[]; readonly when: string };

/**
 * One frame the build sampled: its scene second `t`, the moments drawing it reads (its own first, then its shutter's
 * ends), the camera's pose at each, and its focus (null with no focus play).
 */
export type PaintCameraFrameSample = { readonly t: number; readonly moments: readonly PaintMoment[]; readonly poses: readonly PaintCameraPose[]; readonly focus: PaintCameraFocus | null };

/**
 * What the build sampled of the camera over its shot (paint-camera-build.ts): its poses, frame by frame, runs of
 * frames showing the same poses as one span; and each frame, for what's read at depths that move.
 */
export type PaintCameraShotSamples = { readonly spans: readonly PaintCameraPoseSpan[]; readonly frames: readonly PaintCameraFrameSample[] };

/**
 * A camera checked (paint-camera-build.ts): its `stage`, its projection (`fov`, vertical degrees at rest: how deep a
 * three.js world looks, never where a plane lands), its planes farthest first, its lens, its plays (`move` the lane
 * of moves that set the pose, `moveAdds` those adding to it) and the span of scene seconds its shot shows, sampled.
 */
export type PaintCamera = {
  readonly stage: StampStage;
  readonly fov: number;
  readonly planes: readonly PaintCameraPlane[];
  readonly lens: PaintCameraLens;
  readonly animationFps: number;
  readonly move: PaintLane<PaintCameraMoveClip>;
  readonly moveAdds: readonly CompiledPaintPlay<PaintCameraMoveClip>[];
  readonly focus: PaintLane<PaintCameraFocusClip>;
  readonly span: SceneShownSpan;
  readonly samples: PaintCameraShotSamples;
};

/** Why `pose`, a move's (`adds` for one that adds), can't be drawn, or null: a part not finite. */
export function paintCameraMovePoseProblem({ pan = { x: 0, y: 0 }, dolly = 0, zoom = 1, roll = 0 }: PaintCameraMovePose): string | null {
  return [pan.x, pan.y, dolly, zoom, roll].every(Number.isFinite) ? null : `its pose ${JSON.stringify({ pan, dolly, zoom, roll })} isn't finite`;
}

/** Why `pose` can't be shown, as evaluation rounds it, or null: a zoom at or below 0. */
export const paintCameraPoseProblem = ({ zoom }: PaintCameraPose): string | null =>
  (zoom > 0 ? null : `it zooms to ${zoom}; a zoom must be above 0 (1 at rest) as rounded to a millionth`);

/** Why `focus` can't be focused, or null: a focus depth at or below 0, a negative aperture, or either not finite. */
export const paintCameraFocusProblem = ({ focus, aperture }: PaintCameraFocus): string | null =>
  (focus > 0 && Number.isFinite(focus) && aperture >= 0 && Number.isFinite(aperture) ? null : `it needs a focus depth above 0 and an aperture of 0 or more, not ${focus} and ${aperture}`);

/** The move a play sets at clip moment `moment`, its parts as written. */
const moveValueAt = (clip: PaintCameraMoveClip, moment: PaintMoment): PaintCameraMovePose => presentationValueAt(clip.value, paintClipMoment(moment));

/** The pose under the camera's moves at `t`: the playing move's, rest filling what it leaves out; rest with none. */
function basePoseAt(camera: PaintCamera, t: PaintMoment): PaintCameraPose {
  const playing = paintLaneClipAt(camera.move, t, camera.animationFps);
  return playing ? { ...PAINT_CAMERA_REST, ...moveValueAt(playing.play.clip, playing.moment) } : PAINT_CAMERA_REST;
}

/**
 * Where the camera is at moment `t` (paintMoment), rounded to the steps evaluation holds: the move playing then (before
 * the first starts, its value at its start; at rest with none), plus every move adding then.
 */
export function paintCameraPoseAt(camera: PaintCamera, t: PaintMoment): PaintCameraPose {
  let { pan, dolly, zoom, roll } = basePoseAt(camera, t);
  for (const add of camera.moveAdds) {
    const value = moveValueAt(add.clip, paintPlayClipMomentAt(add.clock, t, camera.animationFps));
    pan = { x: pan.x + (value.pan?.x ?? 0), y: pan.y + (value.pan?.y ?? 0) };
    dolly += value.dolly ?? 0; zoom += value.zoom ?? 0; roll += value.roll ?? 0;
  }
  return { pan: { x: paintPxRounded(pan.x), y: paintPxRounded(pan.y) }, dolly: paintRatioRounded(dolly), zoom: paintRatioRounded(zoom), roll: paintRatioRounded(roll) };
}

/**
 * The camera's moves whose pose changes between moments `a` and `b` (the playing move's and each adding one), by
 * origin, and whether one of them means a jump there: a keyed move with a key that snaps.
 */
export function paintCameraMovesBetween(camera: PaintCamera, a: PaintMoment, b: PaintMoment): { readonly origins: readonly string[]; readonly snapped: boolean } {
  const origins = new Set<string>(), fps = camera.animationFps;
  let snapped = false;
  for (const lane of [camera.move, ...camera.moveAdds.map((add) => [add])]) {
    const from = paintLaneClipAt(lane, a, fps), to = paintLaneClipAt(lane, b, fps);
    if (!from || !to) continue;
    const posed = (playing: typeof from) => ({ ...PAINT_CAMERA_REST, ...moveValueAt(playing.play.clip, playing.moment) });
    if (from.play === to.play && paintCameraPosesEqual(posed(from), posed(to))) continue;
    origins.add(from.play.origin).add(to.play.origin);
    snapped ||= paintLaneSnapsBetween(lane, a, b, fps);
  }
  return { origins: [...origins], snapped };
}

/** The camera's focus at moment `t`, rounded: the focus play then (before the first starts, its start's); null, every plane sharp, with none. */
export function paintCameraFocusAt(camera: PaintCamera, t: PaintMoment): PaintCameraFocus | null {
  const playing = paintLaneClipAt(camera.focus, t, camera.animationFps);
  if (!playing) return null;
  const { focus, aperture } = presentationValueAt(playing.play.clip.value, paintClipMoment(playing.moment));
  return { focus: paintRatioRounded(focus), aperture: paintPxRounded(aperture) };
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

/** How `camera` shows a plane at `depth` (read at `t`) at moment `t`, plane px to frame px: paintPlaneSimilarity at its pose then. */
export const paintPlaneViewAt = (camera: PaintCamera, depth: PresentationValue<number>, t: PaintMoment): PaintSimilarity =>
  paintPlaneSimilarity(paintCameraPoseAt(camera, t), presentationValueAt(depth, t), paintStageCentre(camera.stage));

/**
 * A plane's defocus, frame px of gaussian sigma: the lens's (lens-focus.ts) at the plane's distance from the camera,
 * depth − dolly, its focus focus − dolly away.
 */
export function paintPlaneDefocus({ focus, aperture }: PaintCameraFocus, dolly: number, depth: number): number {
  const sigma = paintPxRounded(Math.abs(lensDefocusSigned({ focus: focus - dolly, aperture }, depth - dolly)));
  return sigma < LENS_DEFOCUS_LEAST ? 0 : sigma;
}

/** How the camera shows anything at a depth in one frame, and the lens's bloom and focus. */
export type PaintCameraDepthLooks = {
  /**
   * The look at `depth`: its similarity, its defocus with a focus play, its views at the shutter's ends when the
   * camera moves over a fast frame's shutter. Throws on a depth at or behind the camera, which `name` names.
   */
  readonly lookAt: (depth: number, name: string) => StampPlaneLook;
  /** lookAt for a depth in time, read at the frame's moment and at each shutter's end, so it blurs along its approach. */
  readonly lookOf: (depth: PresentationValue<number>, name: string) => StampPlaneLook;
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
  const { shutter } = camera.lens, opens = shutterOpensAt(t, shutter), opening = !aperture && !paintCameraShutterShut(camera.lens);
  const openMoment = paintMoment(opens, t), closeMoment = paintMoment(opens + shutter, t);
  const openPose = opening ? paintCameraPoseAt(camera, openMoment) : pose, closePose = opening ? paintCameraPoseAt(camera, closeMoment) : pose;
  const moving = !paintCameraPosesEqual(openPose, closePose), nearest = Math.max(pose.dolly, openPose.dolly, closePose.dolly);
  /** The look at `depth` this moment, the shutter's ends seen at `ends` (null: at `depth` too). */
  const lookAcross = (depth: number, ends: { readonly open: number; readonly close: number } | null, name: string): StampPlaneLook => {
    const least = Math.min(depth, ends?.open ?? depth, ends?.close ?? depth);
    if (least - nearest <= PAINT_CAMERA_NEAREST) throw new Error(`paint camera: at ${t}s the camera, dollied ${nearest}, is at or past ${name} at depth ${least}`);
    const view = paintPlaneSimilarity(pose, depth, centre), distance = depth - pose.dolly;
    if (!aperture) {
      const open = paintPlaneSimilarity(openPose, ends?.open ?? depth, centre), close = paintPlaneSimilarity(closePose, ends?.close ?? depth, centre);
      // At rest a depth moves nothing on the frame: only views that differ blur.
      const seen = moving || !paintSimilaritiesEqual(open, close) ? { open, close } : null;
      return { view, defocus: lens ? paintPlaneDefocus(lens, pose.dolly, depth) : 0, distance, shutter: seen };
    }
    const slide = lens ? lensApertureSlide({ focus: lens.focus - pose.dolly, aperture: lens.aperture }, distance, aperture) : { x: 0, y: 0 };
    return { view: { ...view, kx: view.kx + slide.x, ky: view.ky + slide.y }, defocus: 0, distance, shutter: null };
  };
  const lookAt = (depth: number, name: string) => lookAcross(depth, null, name);
  const lookOf = (depth: PresentationValue<number>, name: string) => (typeof depth === 'number' || !opening
    ? lookAt(presentationValueAt(depth, seenAt), name)
    : lookAcross(depth(seenAt), { open: depth(openMoment), close: depth(closeMoment) }, name));
  const focus = lens && !aperture ? { focus: lens.focus - pose.dolly, aperture: lens.aperture } : null;
  return { lookAt, lookOf, bloom: camera.lens.bloom, focus };
}

/** `looks` as the frame's lens: each of the camera's planes' looks at its depth then, an instanced plane's items looked at one by one. */
export function paintCameraLensFrame(camera: PaintCamera, looks: PaintCameraDepthLooks): StampLensFrame {
  const planes = new Map(camera.planes.flatMap((plane) => (plane.kind === 'instanced' ? [] : [[plane.id, looks.lookOf(plane.depth, `plane ${plane.id}`)] as const])));
  return { planes, bloom: looks.bloom, focus: looks.focus };
}

/** What the camera does in the frame at `t` (paintCameraDepthLooks), as each of its planes is looked at. */
export const paintCameraLensAt = (camera: PaintCamera, t: number, exposure: { at: number; aperture: LensExposure['aperture'] } | null = null): StampLensFrame =>
  paintCameraLensFrame(camera, paintCameraDepthLooks(camera, t, exposure));

const paintCameraPosesEqual = (a: PaintCameraPose, b: PaintCameraPose) =>
  a.pan.x === b.pan.x && a.pan.y === b.pan.y && a.dolly === b.dolly && a.zoom === b.zoom && a.roll === b.roll;
