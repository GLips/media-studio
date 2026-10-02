// paint-camera.ts: the multiplane camera, one description that painted planes and three.js sources both read: its
// pose and focus as plays on clocks, its projection (a vertical field of view) and its lens (a bloom), each in the
// units its type names. It places each plane's picture by a similarity and blurs it by its depth; it never edits a
// group's lay, which stays inside its plane's picture.
//
// Planes stay parallel to the image: the camera pans, dollies, zooms and rolls. A plane is painted the size it looks
// at rest, so at rest every plane's similarity is the identity. Unless a play holds it, the camera is on ones.

import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { StampLensFrame, StampPlaneLook } from '#lib/paint/painting/models/stamp-plane.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintLanePlayAt, paintPlayClipTimeAt, sceneSeconds, type PaintLane, type PaintPlayClock } from './paint-clock.ts';
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

/** The lens past its focus: `bloom`, the sigma in frame px of the gaussian spreading the frame's emission. */
export type PaintCameraLens = { readonly bloom: number };

/**
 * Where a picture plane can hold anything, which the camera keeps on the stage wherever it shows it: within `box`
 * (stage px), everywhere (it can't be bounded), or nowhere (empty). `unchecked`: the camera isn't told, and holds
 * nothing of it; `why` says who holds it instead.
 */
export type PaintCameraExtent =
  | { readonly kind: 'box'; readonly box: StampBox }
  | { readonly kind: 'everywhere' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unchecked'; readonly why: string };

/**
 * A plane the camera shows, `depth` units from it at rest. `three`: a three.js render, drawn each frame through the
 * camera's perspective. `picture`: a picture on the stage, held as far as its `extent`.
 */
export type PaintCameraPlane =
  | { readonly id: string; readonly depth: number; readonly kind: 'picture'; readonly extent: PaintCameraExtent }
  | { readonly id: string; readonly depth: number; readonly kind: 'three' };

/**
 * A camera checked (paint-camera-build.ts): its `stage`, its projection (`fov`, vertical degrees at rest: how deep a
 * three.js world looks, never where a plane lands), its planes farthest first (the renderer's one list), its lens and
 * its plays. `threeMargin`: by three plane, the px its render reaches past the frame, so its defocus blurs in what
 * lies beyond the edge.
 */
export type PaintCamera = {
  readonly stage: StampStage;
  readonly fov: number;
  readonly planes: readonly PaintCameraPlane[];
  readonly threeMargin: ReadonlyMap<string, number>;
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

/** A defocus below this sigma, frame px, is drawn sharp: no blur pass for a change nobody sees. */
export const PAINT_DEFOCUS_LEAST = 0.1;

/**
 * A plane's defocus, frame px of gaussian sigma: a thin lens's circle of confusion, aperture·|1 − f/s|, f the focus's
 * distance (focus − dolly), s the plane's (depth − dolly). The lens's own factor f/(f − focal length), near 1, is
 * left in the aperture. A gaussian of sigma σ spreads as a disc 4σ across, so a/4 stands for an a px disc.
 */
export function paintPlaneDefocus({ focus, aperture }: PaintCameraFocus, dolly: number, depth: number): number {
  const sigma = paintPxRounded(aperture * Math.abs(1 - (focus - dolly) / (depth - dolly)));
  return sigma < PAINT_DEFOCUS_LEAST ? 0 : sigma;
}

/**
 * What the camera does at scene time `t`: each plane's look (its similarity, and its defocus with a focus play) and
 * the lens's bloom. Throws on a plane or the focus at or behind the camera: a build can't hold every curve between its
 * checked times.
 */
export function paintCameraLensAt(camera: PaintCamera, t: number): StampLensFrame {
  const pose = paintCameraPoseAt(camera, t), lens = paintCameraFocusAt(camera, t), centre = paintStageCentre(camera.stage);
  if (lens && lens.focus - pose.dolly <= PAINT_CAMERA_NEAREST) throw new Error(`paint camera: at ${t}s the camera focuses at depth ${lens.focus}, at or behind itself (dollied ${pose.dolly})`);
  const planes = new Map<string, StampPlaneLook>();
  for (const { id, depth } of camera.planes) {
    if (depth - pose.dolly <= PAINT_CAMERA_NEAREST) throw new Error(`paint camera: at ${t}s the camera, dollied ${pose.dolly}, is at or past plane ${id} at depth ${depth}`);
    planes.set(id, { view: paintPlaneSimilarity(pose, depth, centre), defocus: lens ? paintPlaneDefocus(lens, pose.dolly, depth) : 0 });
  }
  return { planes, bloom: camera.lens.bloom };
}
