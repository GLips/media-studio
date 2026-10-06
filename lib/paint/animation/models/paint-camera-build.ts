// paint-camera-build.ts: a camera's planes, projection, lens and plays checked, from plane depths and extents alone;
// a painting is one source (buildPaintingCamera, its nearer planes' extents from paint-motion-reach.ts).
//
// The build samples the camera, and any depth in time, at every moment its span draws (paint-span-moments.ts): each
// play's value is checked there, no plane or focus comes to or behind the camera, and the stage holds the frame's
// preimage, grown by the widest defocus's reach, on every picture plane where its extent holds anything.
//
// A frame's poses (its own and its shutter's ends) bound a box with no slack: a reference exposure lies between them
// unless a move turns inside the shutter, unchecked (a read past the stage takes its edge texel).

import { LENS_SIGMA_STEP, lensGaussianReach, lensSigmaStepped } from '#lib/picture/lens/models/lens-focus.ts';
import { stampPlaneDepthProblems, stampScenePlanes, type StampLaidPlanes, type StampPlane, type StampPlaneExtent } from '#lib/paint/painting/models/stamp-plane.ts';
import { stampStageExtent, type StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
import {
  PAINT_CAMERA_NEAREST, PAINT_CAMERA_REST, paintCameraFocusAt, paintCameraFocusProblem, paintCameraMovePoseProblem, paintCameraPoseAt,
  paintCameraPoseProblem, paintFilmShutter, paintPlaneDefocus, paintStageCentre,
  type PaintCamera, type PaintCameraClip, type PaintCameraFocusClip, type PaintCameraFrameSample, type PaintCameraInstancedPlane, type PaintCameraLens, type PaintCameraLensOptions,
  type PaintCameraMoveClip, type PaintCameraPicturePlane, type PaintCameraPlane, type PaintCameraPlaneOptions, type PaintCameraPlay, type PaintCameraPose, type PaintCameraPoseSpan,
  type PaintCameraShotSamples, type PaintCameraShutter,
} from './paint-camera.ts';
import { paintChannelConflicts, type PaintChannelWriter } from './paint-channels.ts';
import { clipSeconds, compilePaintPlayClock, paintLaneByStart, paintLaneClipAt, paintPlayClipMomentAt, paintPlayClockProblem, paintPlayInterval, type CompiledPaintPlay } from './paint-clock.ts';
import { paintClipMoment } from './paint-motion-clips.ts';
import type { PaintMotion } from './paint-motion-compile.ts';
import { paintGroupLaidReach, paintMotionValueProblems } from './paint-motion-reach.ts';
import type { PaintMotionWarning } from './paint-motion-warnings.ts';
import { paintingCameraMotionWarnings } from './paint-painting-motion-warnings.ts';
import { paintSecondsText, paintSpanFrames, paintSpanMoments, paintSpanProblem, type PaintSpanFrame } from './paint-span-moments.ts';
import { presentationValueAt, presentationValueLength, type PresentationValue } from './paint-value.ts';

/**
 * A camera as written: the `stage` its pictures are painted on, its projection (`fov`, vertical degrees over the
 * frame at rest), its `planes` (in any order), its `lens`, its plays (none: it stands at rest, every plane sharp) and
 * the `span` of scene seconds its shot shows, where it's sampled.
 */
export type PaintCameraOptions = {
  readonly stage: StampStage;
  readonly fov: number;
  readonly planes: readonly PaintCameraPlaneOptions[];
  readonly lens: PaintCameraLensOptions;
  readonly plays?: readonly PaintCameraPlay[];
  readonly animationFps?: number;
  readonly span: SceneShownSpan;
};

/**
 * A shot's lens: a camera's (PaintCameraLensOptions), its `shutter` left out to take the film's, open half the frame
 * the shot is played at (paintFilmShutter: 1/60 s at 30 fps).
 */
export type PaintShotLens = Omit<PaintCameraLensOptions, 'shutter'> & { readonly shutter?: PaintCameraShutter };

/** A shot's camera as written (PaintedShotProps' `camera`): a camera's options over no planes and no span (the shot has one), its lens a shot's. */
export type PaintShotCamera = Omit<PaintCameraOptions, 'planes' | 'lens' | 'span'> & { readonly lens: PaintShotLens };

/**
 * `camera` as the options of a camera over `planes`, the shot showing scene seconds `span`: its shutter, if a lens
 * leaves it out, is the film's at the span's fps, which a render holds to the composition's.
 */
export function paintShotCameraOptions(camera: PaintShotCamera, span: SceneShownSpan, planes: readonly PaintCameraPlaneOptions[]): PaintCameraOptions {
  const { bloom, shutter = paintFilmShutter(span.fps) } = camera.lens;
  return { ...camera, lens: { bloom, shutter }, planes, span };
}

/** `lens` as a camera holds it: its shutter in seconds, 0 when shut. */
export const paintCameraLensBuilt = ({ bloom, shutter }: PaintCameraLensOptions): PaintCameraLens => ({ bloom, shutter: shutter === 'shut' ? 0 : shutter });

/**
 * A camera built, with the most each plane is magnified anywhere in the shot (frame px per plane px; its picture is
 * painted a texel a plane px, so past 1 it's upsampled), or the problems that keep it from being.
 */
export type PaintCameraBuild =
  | { readonly ok: true; readonly camera: PaintCamera; readonly magnification: ReadonlyMap<string, number> }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * A camera over a scene as written: its planes as the scene's, and the `motion` laying its painting's groups (null for
 * none).
 */
export type PaintingCameraOptions = Omit<PaintCameraOptions, 'planes'> & { readonly planes: readonly StampPlane[]; readonly motion: PaintMotion | null };

/**
 * What a StampPainting shows through, as buildPaintingCamera made it: the camera, its planes laid for the renderer
 * (the same planes in the same order, each painted plane with the painting's groups it shows), and its motion's
 * warnings, which every render prints.
 */
export type StampPaintingCamera = { readonly camera: PaintCamera; readonly planes: StampLaidPlanes; readonly warnings: readonly PaintMotionWarning[] };

export type PaintingCameraBuild =
  | { readonly ok: true; readonly camera: StampPaintingCamera; readonly magnification: ReadonlyMap<string, number> }
  | { readonly ok: false; readonly problems: readonly string[] };

const MOVE_LANE = 'the camera\'s move', FOCUS_LANE = 'the camera\'s focus';

/** Plane px per frame px for a plane at `depth`: the inverse of the camera's scale there. */
const planePxPerFramePx = ({ dolly, zoom }: PaintCameraPose, depth: number) => (depth - dolly) / (zoom * depth);

const posesEqual = (a: PaintCameraPose, b: PaintCameraPose) => a.pan.x === b.pan.x && a.pan.y === b.pan.y && a.dolly === b.dolly && a.zoom === b.zoom && a.roll === b.roll;

const range = (values: readonly number[]) => ({ low: Math.min(...values), high: Math.max(...values) });

/** A pose and the depth a plane lies at then: how the camera shows it at one moment. */
type DepthView = { readonly pose: PaintCameraPose; readonly depth: number };

/** The views some frames of a shot show of a plane, and `when` they are. */
type DepthViewSpan = { readonly views: readonly DepthView[]; readonly when: string };

const viewsEqual = (a: readonly DepthView[], b: readonly DepthView[]) => a.length === b.length && a.every((view, i) => view.depth === b[i].depth && posesEqual(view.pose, b[i].pose));

const spanWhen = (from: number, to: number) => (from === to ? `at ${paintSecondsText(from)}` : `from ${paintSecondsText(from)} to ${paintSecondsText(to)}`);

/**
 * The views `camera` shows of a plane at `depth` over its shot, runs of frames showing the same ones as one span: its
 * pose spans for a still depth; for a depth in time, each frame's poses at the depths read at their moments.
 */
function depthViewSpans({ samples }: PaintCamera, depth: PresentationValue<number>): DepthViewSpan[] {
  if (typeof depth === 'number') return samples.spans.map(({ poses, when }) => ({ views: poses.map((pose) => ({ pose, depth })), when }));
  const spans: DepthViewSpan[] = [];
  let run: { views: DepthView[]; from: number; to: number } | null = null;
  for (const { t, moments, poses } of samples.frames) {
    const views: DepthView[] = [];
    for (const [i, moment] of moments.entries()) {
      const view = { pose: poses[i], depth: depth(moment) };
      if (!views.some((each) => viewsEqual([each], [view]))) views.push(view);
    }
    if (run && viewsEqual(run.views, views)) run.to = t;
    else {
      if (run) spans.push({ views: run.views, when: spanWhen(run.from, run.to) });
      run = { views, from: t, to: t };
    }
  }
  if (run) spans.push({ views: run.views, when: spanWhen(run.from, run.to) });
  return spans;
}

/** The plane points the frame shows of a plane at any of `views`, as a box (frame origin, px). */
function framePreimageBox(stage: StampStage, views: readonly DepthView[]): StampBox {
  const centre = paintStageCentre(stage), { width, height } = stage.frame;
  const k = range(views.map(({ pose, depth }) => planePxPerFramePx(pose, depth)));
  const corners = [{ x: -centre.x, y: -centre.y }, { x: width - centre.x, y: -centre.y }, { x: -centre.x, y: height - centre.y }, { x: width - centre.x, y: height - centre.y }];
  const panX = range(views.map(({ pose, depth }) => pose.pan.x / depth)), panY = range(views.map(({ pose, depth }) => pose.pan.y / depth));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const roll = views[0].pose.roll;
  if (views.every(({ pose }) => pose.roll === roll)) {
    // p = c + R(roll)·(q − c)·k + pan/d, k and pan/d each within their views' values.
    const cos = Math.cos(roll), sin = Math.sin(roll);
    for (const q of corners) {
      const rx = cos * q.x - sin * q.y, ry = sin * q.x + cos * q.y;
      for (const scale of [k.low, k.high]) {
        x0 = Math.min(x0, rx * scale); x1 = Math.max(x1, rx * scale);
        y0 = Math.min(y0, ry * scale); y1 = Math.max(y1, ry * scale);
      }
    }
  } else {
    // A roll that changes is bounded by its corners' circle.
    const reach = Math.hypot(centre.x, centre.y) * k.high;
    x0 = -reach; x1 = reach; y0 = -reach; y1 = reach;
  }
  return { x0: centre.x + x0 + panX.low, x1: centre.x + x1 + panX.high, y0: centre.y + y0 + panY.low, y1: centre.y + y1 + panY.high };
}

/** The widest defocus any frame of `camera`'s shot gives a plane at `depth` (read at each frame's moment), frame px of sigma. */
function widestDefocus({ samples }: PaintCamera, depth: PresentationValue<number>): number {
  return samples.frames.reduce((most, { focus, moments, poses }) => (focus ? Math.max(most, paintPlaneDefocus(focus, poses[0].dolly, presentationValueAt(depth, moments[0]))) : most), 0);
}

const boxText = ({ x0, x1, y0, y1 }: StampBox) => `${x0.toFixed(0)}..${x1.toFixed(0)} × ${y0.toFixed(0)}..${y1.toFixed(0)}`;
const within = (inner: StampBox, outer: StampBox) => inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;
const grownBox = ({ x0, x1, y0, y1 }: StampBox, by: number): StampBox => ({ x0: x0 - by, x1: x1 + by, y0: y0 - by, y1: y1 + by });
const unionBox = (a: StampBox, b: StampBox): StampBox => ({ x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) });
const meet = (a: StampBox, b: StampBox): StampBox | null => {
  const box = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) };
  return box.x0 < box.x1 && box.y0 < box.y1 ? box : null;
};

/** Where a nearer plane's groups' paint can lie at `moments`: everywhere when one can't be bounded. */
function nearerPaintReach(painting: CompiledStampPaint, groups: readonly number[], motion: PaintMotion | null, moments: readonly PaintMoment[]): StampPlaneExtent {
  let reach: StampBox | null = null;
  for (const index of groups) {
    const laid = paintGroupLaidReach(painting.groups[index], motion, moments);
    if (laid.kind === 'unbounded') return { kind: 'everywhere' };
    if (laid.box) reach = reach ? unionBox(reach, laid.box) : laid.box;
  }
  return reach ? { kind: 'box', box: reach } : { kind: 'empty' };
}

/** Why instanced `plane`'s depths can't hold items, or null: finite, `near` no farther than `far` (each above 0 is checked as a plane's depth). */
function instancedDepthsProblem({ id, depths: { near, far } }: PaintCameraInstancedPlane): string | null {
  return Number.isFinite(far) && far >= near ? null : `plane ${id}'s items lie between depths ${near} and ${far}; near comes first, no farther than a finite far`;
}

/** Why `extent` isn't one, or null: a box's bounds finite and ordered. */
function extentBoxProblem(id: string, extent: StampPlaneExtent): string | null {
  if (extent.kind !== 'box') return null;
  const { x0, x1, y0, y1 } = extent.box;
  return [x0, x1, y0, y1].every(Number.isFinite) && x0 <= x1 && y0 <= y1
    ? null
    : `plane ${id}'s extent is ${x0}..${x1} × ${y0}..${y1}; a box's bounds are finite, x0 ≤ x1 and y0 ≤ y1`;
}

/** Why `shutter` can't be a lens's, or null: seconds more than 0, or 'shut', which is how a shutter open 0 s is said. */
function shutterProblem(shutter: PaintCameraShutter): string | null {
  if (shutter === 'shut') return null;
  if (shutter === 0) return "the lens's shutter is open 0 s: say shutter: 'shut' to draw every frame sharp on purpose";
  return shutter > 0 && Number.isFinite(shutter) ? null : `the lens's shutter is open ${shutter} s; a shutter is open more than 0 s, or 'shut'`;
}

/** How far a defocus of `sigma` px spreads: its reach, the sigma stepped up at most a step, a bilinear read's pixel and one for rounding. */
const defocusGrowth = (sigma: number) => lensGaussianReach(lensSigmaStepped(sigma) * LENS_SIGMA_STEP) + 2;

/**
 * What the frame reads of a plane over one stretch of the shot, `when` naming it: `seen`, the plane px it shows
 * (frame origin); `reach`, how far past them its blur reads, plane px, 0 while sharp.
 */
export type PaintCameraPlaneRead = { readonly when: string; readonly seen: StampBox; readonly reach: number };

/**
 * What the frame shows of a plane at `views`, defocused by `sigma` frame px: the plane px it shows, and how many plane
 * px its defocus spreads past them (defocusGrowth's, so at least 2 px even sharp).
 */
function spanSight(stage: StampStage, views: readonly DepthView[], sigma: number) {
  const k = Math.max(...views.map(({ pose, depth }) => planePxPerFramePx(pose, depth)));
  return { seen: framePreimageBox(stage, views), grow: defocusGrowth(sigma * k) };
}

/**
 * Why picture plane `plane` can't hold what the camera shows of it in some span, defocused by `sigma`, or null. Its
 * extent: where its picture holds anything, beyond which it needs nothing held.
 */
function pictureProblem(stage: StampStage, { id, extent }: PaintCameraPicturePlane, spans: readonly DepthViewSpan[], sigma: number): string | null {
  if (extent.kind === 'empty' || extent.kind === 'unchecked') return null;
  const stageBox = stampStageExtent(stage);
  for (const span of spans) {
    const { seen, grow } = spanSight(stage, span.views, sigma), needed = grownBox(seen, grow);
    // The picture's own defocus spreads it `grow` past its extent, and that spread must be on the stage too.
    const held = extent.kind === 'everywhere' ? needed : meet(needed, grownBox(extent.box, grow));
    if (held && !within(held, stageBox)) {
      return `plane ${id}'s picture must hold what the camera shows of it, ${boxText(held)} ${span.when}, but the stage holds ${boxText(stageBox)}; widen the stage's margin`;
    }
  }
  return null;
}

/**
 * Why `camera` can't show picture plane `plane` anywhere in its shot, or null: the build's check, for a plane whose
 * extent is known only once the camera is (a lay worked back through its view, an element measured).
 */
export function paintCameraPictureProblem(camera: PaintCamera, plane: PaintCameraPicturePlane): string | null {
  return pictureProblem(camera.stage, plane, depthViewSpans(camera, plane.depth), widestDefocus(camera, plane.depth));
}

/**
 * What `camera` reads of a plane at `depth` (read at each moment) anywhere in its shot: a read a span of its samples,
 * defocused by the widest defocus the plane gets. A sharp plane reads only what the frame shows, so a frame-sized one
 * at rest holds it.
 */
export function paintCameraShotReads(camera: PaintCamera, depth: PresentationValue<number>): PaintCameraPlaneRead[] {
  const sigma = widestDefocus(camera, depth);
  return depthViewSpans(camera, depth).map(({ views, when }) => {
    const { seen, grow } = spanSight(camera.stage, views, sigma);
    return { when, seen, reach: sigma > 0 ? grow : 0 };
  });
}

/**
 * What `camera` reads of a plane at `depth` at each of `moments` (a frame's own, its shutter's ends), each as the
 * camera stands and the depth lies then, defocused as the frame at `at` is, the lens taking one defocus a frame.
 */
export function paintCameraFrameReads(camera: PaintCamera, depth: PresentationValue<number>, at: PaintMoment, moments: readonly PaintMoment[]): PaintCameraPlaneRead[] {
  const pose = paintCameraPoseAt(camera, at), focus = paintCameraFocusAt(camera, at), sigma = focus ? paintPlaneDefocus(focus, pose.dolly, presentationValueAt(depth, at)) : 0;
  return moments.map((moment) => {
    const { seen, grow } = spanSight(camera.stage, [{ pose: paintCameraPoseAt(camera, moment), depth: presentationValueAt(depth, moment) }], sigma);
    return { when: `at ${paintSecondsText(moment.at)}`, seen, reach: sigma > 0 ? grow : 0 };
  });
}

/**
 * What `camera` (built but for its samples) does over `frames`, and the first problem each play's value has at
 * any of their moments (a function's; a constant's is checked as written), and the pose's own.
 */
function sampleCamera(camera: PaintCamera, frames: readonly PaintSpanFrame[], problems: string[]): PaintCameraShotSamples {
  const fps = camera.animationFps, said = new Set<string>();
  const report = (origin: string, t: number, problem: string | null) => {
    if (!problem || said.has(origin)) return;
    said.add(origin);
    problems.push(`${origin}: at ${paintSecondsText(t)} ${problem}`);
  };
  const spans: PaintCameraPoseSpan[] = [], sampled: PaintCameraFrameSample[] = [];
  let run: { poses: PaintCameraPose[]; from: number; to: number } | null = null;
  const close = () => {
    if (run) spans.push({ poses: run.poses, when: spanWhen(run.from, run.to) });
  };
  for (const { t, moments } of frames) {
    const poses: PaintCameraPose[] = [], aligned: PaintCameraPose[] = [];
    for (const moment of moments) {
      const playing = paintLaneClipAt(camera.move, moment, fps);
      if (playing && typeof playing.play.clip.value === 'function') report(playing.play.origin, moment.at, paintCameraMovePoseProblem(presentationValueAt(playing.play.clip.value, paintClipMoment(playing.moment))));
      for (const add of camera.moveAdds) {
        if (typeof add.clip.value === 'function') report(add.origin, moment.at, paintCameraMovePoseProblem(presentationValueAt(add.clip.value, paintClipMoment(paintPlayClipMomentAt(add.clock, moment, fps)))));
      }
      const pose = paintCameraPoseAt(camera, moment);
      report('the camera\'s move', moment.at, paintCameraPoseProblem(pose));
      aligned.push(pose);
      if (!poses.some((each) => posesEqual(each, pose))) poses.push(pose);
    }
    const focusing = paintLaneClipAt(camera.focus, moments[0], fps);
    if (focusing && typeof focusing.play.clip.value === 'function') report(focusing.play.origin, t, paintCameraFocusProblem(presentationValueAt(focusing.play.clip.value, paintClipMoment(focusing.moment))));
    sampled.push({ t, moments, poses: aligned, focus: paintCameraFocusAt(camera, moments[0]) });
    if (run && run.poses.length === poses.length && run.poses.every((pose, i) => posesEqual(pose, poses[i]))) run.to = t;
    else {
      close();
      run = { poses, from: t, to: t };
    }
  }
  close();
  // One run is the whole shot: named for that, and for rest when that's where the camera stays.
  if (spans.length === 1) return { spans: [{ ...spans[0], when: spans[0].poses.every((pose) => posesEqual(pose, PAINT_CAMERA_REST)) ? 'at rest' : 'throughout the shot' }], frames: sampled };
  return { spans, frames: sampled };
}

/** The depths anything of `plane` lies at over `frames`: an instanced plane's items' bounds, a depth in time's samples. */
function planeDepthRange(plane: PaintCameraPlaneOptions, frames: readonly PaintSpanFrame[]): { readonly near: number; readonly far: number } {
  if (plane.kind === 'instanced') return plane.depths;
  const { depth } = plane;
  if (typeof depth === 'number') return { near: depth, far: depth };
  const depths = frames.flatMap(({ moments }) => moments.map(depth));
  return { near: Math.min(...depths), far: Math.max(...depths) };
}

/** The first moment of `frames` at which `plane`'s depth in time isn't above 0, worded; null when every one is. */
function movingDepthProblem({ id }: PaintCameraPicturePlane, depth: (moment: PaintMoment) => number, frames: readonly PaintSpanFrame[]): string | null {
  for (const moment of frames.flatMap(({ moments }) => moments)) {
    const at = depth(moment);
    if (!(at > 0 && Number.isFinite(at))) return `plane ${id} is at depth ${at} at ${paintSecondsText(moment.at)}; a plane's depth is above 0`;
  }
  return null;
}

/**
 * Why the camera comes to or past `plane`, its depth in time, in some frame, or null: the frame's nearest depth
 * against its farthest dolly, as a frame's look checks it.
 */
function movingNearestProblem({ id }: PaintCameraPicturePlane, depth: (moment: PaintMoment) => number, frames: readonly PaintCameraFrameSample[]): string | null {
  for (const { t, moments, poses } of frames) {
    const least = Math.min(...moments.map(depth)), dolly = Math.max(...poses.map((pose) => pose.dolly));
    if (least - dolly <= PAINT_CAMERA_NEAREST) return `at ${paintSecondsText(t)} the camera dollies ${dolly}, at or past plane ${id} at depth ${least}; a plane stays in front of the camera`;
  }
  return null;
}

/** Why `clip`'s value, a constant, can't be shown, or null; a function's values are checked where they're sampled. */
function constantClipProblem(clip: PaintCameraClip): string | null {
  if (clip.kind === 'move') return typeof clip.value === 'function' ? null : paintCameraMovePoseProblem(clip.value);
  return typeof clip.value === 'function' ? null : paintCameraFocusProblem(clip.value);
}

/** The one depth `plane` is checked at as it's built (an instanced plane's nearest), or null for a depth in time, checked where it's sampled. */
function planeStillDepth(plane: PaintCameraPlaneOptions): number | null {
  if (plane.kind === 'instanced') return plane.depths.near;
  return typeof plane.depth === 'number' ? plane.depth : null;
}

/** A camera over `o.planes`, checked (see the file's head), with each plane's greatest magnification. */
export function buildPaintCamera(o: PaintCameraOptions): PaintCameraBuild {
  const problems: string[] = [], fps = o.animationFps ?? PAINT_ANIMATION_FPS;
  stampPlaneDepthProblems(o.planes.map((plane) => ({ id: plane.id, depth: planeStillDepth(plane) })), problems);
  for (const plane of o.planes) {
    const problem = plane.kind === 'picture' ? extentBoxProblem(plane.id, plane.extent) : plane.kind === 'instanced' && instancedDepthsProblem(plane);
    if (problem) problems.push(problem);
  }
  if (!(o.fov > 0 && o.fov < 180)) problems.push(`a field of view is between 0 and 180 degrees, not ${o.fov}`);
  if (!(o.lens.bloom >= 0 && Number.isFinite(o.lens.bloom))) problems.push(`the lens blooms by a sigma of 0 px or more, not ${o.lens.bloom}`);
  const shutter = shutterProblem(o.lens.shutter);
  if (shutter) problems.push(shutter);
  const spanProblem = paintSpanProblem(o.span);
  if (spanProblem) problems.push(`the camera: ${spanProblem}`);
  const move: CompiledPaintPlay<PaintCameraMoveClip>[] = [], moveAdds: CompiledPaintPlay<PaintCameraMoveClip>[] = [], focus: CompiledPaintPlay<PaintCameraFocusClip>[] = [];
  const writers: PaintChannelWriter[] = [];
  for (const play of o.plays ?? []) {
    const { clip } = play;
    const problem = (clip.kind === 'focus' && play.blend === 'add' ? 'a focus can\'t add; only a move adds to the one under it' : null) ?? constantClipProblem(clip) ?? paintPlayClockProblem(play.clock);
    if (problem) { problems.push(`${play.origin}: ${problem}`); continue; }
    const clock = compilePaintPlayClock(play.clock, []), interval = paintPlayInterval(clock, clipSeconds(presentationValueLength(clip.value)));
    if (clip.kind === 'focus') focus.push({ clip, clock, interval, origin: play.origin });
    else (play.blend === 'add' ? moveAdds : move).push({ clip, clock, interval, origin: play.origin });
    if (play.blend !== 'add') writers.push({ channel: 'camera', target: clip.kind === 'move' ? MOVE_LANE : FOCUS_LANE, ...interval, origin: play.origin });
  }
  problems.push(...paintChannelConflicts(writers));
  if (problems.length) return { ok: false, problems };
  const lens = paintCameraLensBuilt(o.lens), frames = paintSpanFrames(o.span, lens);
  for (const plane of o.planes) {
    const problem = plane.kind === 'picture' && typeof plane.depth === 'function' && movingDepthProblem(plane, plane.depth, frames);
    if (problem) problems.push(problem);
  }
  if (problems.length) return { ok: false, problems };
  // Ties keep their written order, as stampScenePlanes keeps them.
  const far = new Map(o.planes.map((plane) => [plane.id, planeDepthRange(plane, frames).far]));
  const written = o.planes.toSorted((a, b) => far.get(b.id)! - far.get(a.id)!);
  const unsampled: PaintCamera = {
    stage: o.stage, fov: o.fov, planes: [], lens, animationFps: fps, move: paintLaneByStart(move), moveAdds, focus: paintLaneByStart(focus), span: o.span,
    samples: { spans: [], frames: [] },
  };
  const samples = sampleCamera(unsampled, frames, problems);
  if (problems.length) return { ok: false, problems };
  const poses = samples.spans.flatMap((span) => span.poses), nearest = poses.reduce((most, pose) => (pose.dolly > most.dolly ? pose : most));
  for (const plane of written) {
    if (plane.kind === 'picture' && typeof plane.depth === 'function') {
      const problem = movingNearestProblem(plane, plane.depth, samples.frames);
      if (problem) problems.push(problem);
      continue;
    }
    const { near } = planeDepthRange(plane, frames);
    if (near - nearest.dolly <= PAINT_CAMERA_NEAREST) problems.push(`the camera dollies ${nearest.dolly}, at or past plane ${plane.id} at depth ${near}; a plane stays in front of the camera`);
  }
  const unfocused = samples.frames.find(({ focus: focused, poses: [{ dolly }] }) => focused && focused.focus - dolly <= PAINT_CAMERA_NEAREST);
  if (unfocused) problems.push(`at ${paintSecondsText(unfocused.t)} the camera focuses at depth ${unfocused.focus!.focus} while dollied ${unfocused.poses[0].dolly}, at or behind itself`);
  if (problems.length) return { ok: false, problems };
  const sampled: PaintCamera = { ...unsampled, samples };
  for (const plane of written) {
    const problem = plane.kind === 'picture' && paintCameraPictureProblem(sampled, plane);
    if (problem) problems.push(problem);
  }
  if (problems.length) return { ok: false, problems };
  // A three plane is rendered through the camera, a frame px a px, so its margin is its defocus's growth alone.
  const planes = written.map((plane): PaintCameraPlane => {
    if (plane.kind !== 'three') return plane;
    const sigma = widestDefocus(sampled, plane.depth);
    return { id: plane.id, depth: plane.depth, kind: 'three', margin: sigma > 0 ? Math.ceil(defocusGrowth(sigma)) : 0 };
  });
  // zoom·d/(d − dolly), the most any view drawn shows; an instanced plane's at its nearest items.
  const magnification = new Map(planes.map((plane) => {
    const views = depthViewSpans(sampled, plane.kind === 'instanced' ? plane.depths.near : plane.depth).flatMap((span) => span.views);
    return [plane.id, Math.max(...views.map(({ pose: { zoom, dolly }, depth }) => (zoom * depth) / (depth - dolly)))];
  }));
  return { ok: true, camera: { ...sampled, planes }, magnification };
}

/**
 * A camera over a scene's planes, checked over `painting` first (stampScenePlanes; null for a scene that paints
 * nothing): a painted back holds paint everywhere, a nearer painted plane wherever `motion` lays its groups at the
 * span's moments (its values checked there too), and a picture plane as far as its source's extent.
 */
export function buildPaintingCamera(painting: CompiledStampPaint | null, { planes: written, motion, ...o }: PaintingCameraOptions): PaintingCameraBuild {
  const problems: string[] = [];
  const scene = stampScenePlanes(painting, written, problems);
  const spanProblem = paintSpanProblem(o.span);
  if (spanProblem) problems.push(`the camera: ${spanProblem}`);
  if (problems.length || !scene) return { ok: false, problems };
  const { back, nearer } = scene, frames = paintSpanFrames(o.span, paintCameraLensBuilt(o.lens)), moments = paintSpanMoments(frames);
  problems.push(...(motion ? paintMotionValueProblems(motion, moments) : []));
  if (problems.length) return { ok: false, problems };
  const built = buildPaintCamera({
    ...o,
    planes: [back, ...nearer].map((plane): PaintCameraPlaneOptions => {
      const { id, depth } = plane;
      switch (plane.kind) {
        case 'three': return { id, depth, kind: 'three' };
        case 'picture': return { id, depth, kind: 'picture', extent: plane.extent };
        // stampScenePlanes refuses a painted plane without a painting.
        case 'painted': return { id, depth, kind: 'picture', extent: plane === back ? { kind: 'everywhere' } : nearerPaintReach(painting!, plane.groups, motion, moments) };
        default: return plane satisfies never;
      }
    }),
  });
  if (!built.ok) return built;
  const warnings = paintingCameraMotionWarnings(built.camera, scene, painting, motion, frames);
  return { ok: true, camera: { camera: built.camera, planes: scene, warnings }, magnification: built.magnification };
}
