// paint-camera-depths.ts: things at one depth related to another through the multiplane camera. Planes stay parallel
// to the image, so the camera shows each depth by a similarity (paintPlaneSimilarity), and points on two depths meet
// where it shows both on one frame px: a point found on another depth, a mask reading its drawable where the camera
// shows it. And a depth's pads: all the camera reads of it.
//
// Negative space: exact only between image-parallel planes. A three.js source's receding ground isn't a plane at one
// depth, so a point on it has no plane px to be found from.

import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampBoxGrown, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
import { buildPaintCamera, paintCameraShotReads, paintShotCameraOptions, type PaintShotCamera } from './paint-camera-build.ts';
import { paintPlaneViewAt, type PaintCamera } from './paint-camera.ts';
import { PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, paintSimilarityApply, paintSimilarityInverse, type PaintSimilarity } from './paint-similarity.ts';

/**
 * Plane px under view `from` to plane px under view `to` (each plane px to frame px), meeting where the two show them
 * on one frame px. Exactly the identity where they're one view, as two planes at one depth are in every frame.
 */
export function paintViewAcross(from: PaintSimilarity, to: PaintSimilarity): PaintSimilarity {
  const one = from.ma === to.ma && from.mb === to.mb && from.kx === to.kx && from.ky === to.ky;
  return one ? PAINT_SIMILARITY_IDENTITY : paintSimilarityAfter(paintSimilarityInverse(to), from);
}

/** `camera` built over no planes (a view needs only a depth), the shot showing `span`, in a film of `filmFps`; throws what its build refuses. */
function paintShotCameraBuilt(camera: PaintShotCamera, span: SceneShownSpan, filmFps: number): PaintCamera {
  const build = buildPaintCamera(paintShotCameraOptions(camera, span, filmFps, []));
  if (!build.ok) throw new Error(`paint camera: ${build.problems.join('; ')}`);
  return build.camera;
}

const paintShotViewCamerasBuilt = new WeakMap<PaintShotCamera, Map<string, PaintCamera>>();

/**
 * `camera` built for its views over `span`, once per camera object and span. A view is the same at every shutter, so
 * it's built shut and needs no film.
 */
function paintShotViewCamera(camera: PaintShotCamera, span: SceneShownSpan): PaintCamera {
  const spans = paintShotViewCamerasBuilt.get(camera) ?? new Map<string, PaintCamera>(), spanKey = `${span.from}..${span.to}@${span.fps}`;
  paintShotViewCamerasBuilt.set(camera, spans);
  const known = spans.get(spanKey);
  if (known) return known;
  const built = paintShotCameraBuilt({ ...camera, lens: { bloom: camera.lens.bloom, shutter: 'shut' } }, span, 1);
  spans.set(spanKey, built);
  return built;
}

/** How the shot's `camera`, over `span`, shows a plane at `depth` at moment `m`, plane px to frame px, its plays read on their clocks. */
export const paintShotViewAt = (camera: PaintShotCamera, span: SceneShownSpan, depth: number, m: PaintMoment): PaintSimilarity => paintPlaneViewAt(paintShotViewCamera(camera, span), depth, m);

/** A point on a plane at `depth`, plane px. */
export type PaintDepthPoint = { readonly depth: number; readonly point: StampPoint };

/**
 * Where `from`'s point lies on a plane at depth `to` at moment `m`, plane px: the point the shot's `camera`, over `span`, shows on
 * the same frame px then, its plays read on their clocks. Plane px, not document px: a plane's lay is the caller's.
 */
export function paintPointAcrossDepths(camera: PaintShotCamera, span: SceneShownSpan, { depth, point }: PaintDepthPoint, to: number, m: PaintMoment): StampPoint {
  return paintSimilarityApply(paintViewAcross(paintShotViewAt(camera, span, depth, m), paintShotViewAt(camera, span, to, m)), point);
}

/** How far past the frame the camera reads a plane, whole px on each side; 0 on a side it never reads past. */
export type PaintCameraReach = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/** Below this many px past a whole px, a reach is the float arithmetic's: it isn't rounded up past it. */
const REACH_SLACK = 1e-6;

/**
 * How far past the frame the shot's `camera` reads a plane at `depth` over its `span`, plane px rounded up: its
 * moves, focus and shutter (a lens leaving its own out takes the film's at `filmFps`). A plane painted this far past
 * the frame on each side holds it all.
 */
export function paintCameraReachAt(camera: PaintShotCamera, span: SceneShownSpan, depth: number, filmFps: number): PaintCameraReach {
  const { width, height } = camera.stage.frame;
  const reads = paintCameraShotReads(paintShotCameraBuilt(camera, span, filmFps), depth).map(({ seen, reach }) => stampBoxGrown(seen, reach));
  const past = (each: (box: (typeof reads)[number]) => number) => Math.max(0, Math.ceil(Math.max(...reads.map(each)) - REACH_SLACK));
  return { left: past((box) => -box.x0), top: past((box) => -box.y0), right: past((box) => box.x1 - width), bottom: past((box) => box.y1 - height) };
}
