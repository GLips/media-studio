// paint-camera-build.ts: a camera's plays and its planes checked over the painting it shows. buildPaintCamera stands
// alone, so a scene can put a camera over frame state some other motion wrote (paintCameraFrameStateAt);
// buildPaintMotion builds the same camera from its nodes' anchors, so there is one camera step.
//
// Checked: the stage, each plane's group and depth, the clips and clocks, one writer per lane at once, a plane at or
// behind the camera, a focus behind it, and a backdrop the camera shows past.
//
// Negative space: a backdrop is checked through the camera alone. Its own placement or warp isn't inverted, as
// backdrops hold still; one that moves is checked as if it didn't.

import { stampStageExtent, type StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import {
  paintCameraClipProblem, paintCameraFocusAt, paintCameraPoseAt, paintPlaneSimilarity, paintStageCentre,
  type PaintAnchor, type PaintCamera, type PaintCameraFocusClip, type PaintCameraMoveClip, type PaintCameraPlay,
} from './paint-camera.ts';
import { paintChannelConflicts, type PaintChannelWriter } from './paint-channels.ts';
import {
  clipSeconds, compilePaintPlayClock, paintLaneByStart, paintPlayClockProblem, paintPlayInterval, sceneSeconds,
  type CompiledPaintPlay, type CompiledPaintPlayClock, type SceneSeconds,
} from './paint-clock.ts';
import { paintGroupPaintedBox } from './paint-motion-compile.ts';
import { paintSimilarityApply, paintSimilarityInverse } from './paint-similarity.ts';

/** How near the camera a plane or its focus may come, depth units: nearer, its scale runs off toward infinity. */
export const PAINT_CAMERA_NEAREST = 1e-3;

/**
 * A camera as written: the `stage` it shows, the groups on planes (`anchors`, by group id; a group left out is on the
 * canvas), the groups that must fill the frame (`backdrops`) and its plays. `check`: scene seconds to check
 * backdrops and focus over besides its plays' own span.
 */
export type PaintCameraOptions = {
  readonly stage: StampStage;
  readonly anchors: ReadonlyMap<string, PaintAnchor>;
  readonly backdrops?: readonly string[];
  readonly plays: readonly PaintCameraPlay[];
  readonly animationFps?: number;
  readonly check?: { readonly from: number; readonly to: number };
};

/** A camera built: usable, or the problems that keep it from being. */
export type PaintCameraBuild = { readonly ok: true; readonly camera: PaintCamera } | { readonly ok: false; readonly problems: readonly string[] };

const MOVE_LANE = 'the camera\'s move', FOCUS_LANE = 'the camera\'s focus';

function stageProblem({ frame: { width, height } }: StampStage): string | null {
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? null : `the stage's frame needs a positive width and height, not ${width}×${height}`;
}

/** One loop of `clock`, scene seconds: 0 for one that doesn't loop. */
const loopCycle = (clock: CompiledPaintPlayClock) =>
  clock.clip.reduce((length, step) => (step.kind === 'loop' ? step.period : length), 0) / clock.clip.reduce((rate, step) => (step.kind === 'rate' ? step.rate : rate), 1);

/** The scene seconds a lane's plays change over: each from its start to its end, or one cycle of an endless loop. */
function laneSpans(lane: readonly CompiledPaintPlay<unknown>[]): { from: number; to: number }[] {
  return lane.map(({ clock, interval }) => ({ from: interval.start, to: Number.isFinite(interval.end) ? interval.end : interval.start + loopCycle(clock) }));
}

/** Every animation frame inside `spans`, and each span's ends: where a camera's extremes are looked for. */
function checkTimes(spans: readonly { from: number; to: number }[], fps: number): SceneSeconds[] {
  const times = new Set<number>();
  for (const { from, to } of spans) {
    times.add(from).add(to);
    for (let frame = Math.ceil(from * fps - 1e-6); frame / fps <= to; frame++) times.add(frame / fps);
  }
  return [...times].toSorted((a, b) => a - b).map(sceneSeconds);
}

const inBox = (p: StampPoint, box: StampBox) => p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
const pointText = (p: StampPoint) => `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`;

/** The first time the camera shows `id`'s plane past the stage or past its paint, named; null if it never does. */
function backdropProblem(camera: PaintCamera, id: string, painted: StampBox | null, times: readonly SceneSeconds[]): string | null {
  const { frame: { width, height }, margin } = camera.stage, depth = camera.planes.get(id);
  const stage = stampStageExtent(camera.stage);
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }];
  for (const t of depth === undefined ? [sceneSeconds(0)] : times) {
    const back = depth === undefined ? (p: StampPoint) => p : (p: StampPoint) => paintSimilarityApply(paintSimilarityInverse(paintPlaneSimilarity(paintCameraPoseAt(camera, t), depth, paintStageCentre(camera.stage))), p);
    for (const corner of corners.map(back)) {
      if (!inBox(corner, stage)) return `${id} must fill the frame, but at ${t.toFixed(3)}s the frame's corner shows ${pointText(corner)} of its plane, past the stage's ${margin} px margin`;
      if (painted && !inBox(corner, painted)) return `${id} must fill the frame, but at ${t.toFixed(3)}s the frame's corner shows ${pointText(corner)} of its plane, past its paint (${painted.x0.toFixed(0)}..${painted.x1.toFixed(0)} × ${painted.y0.toFixed(0)}..${painted.y1.toFixed(0)})`;
    }
  }
  return null;
}

/** `o` checked and compiled over `painting` into `problems` (see the file's head for what's checked). */
export function compilePaintCamera(painting: CompiledStampPaint, o: PaintCameraOptions, problems: string[]): PaintCamera {
  const fps = o.animationFps ?? PAINT_ANIMATION_FPS, groups = new Map(painting.groups.map((group) => [group.id, group])), before = problems.length;
  const stage = stageProblem(o.stage);
  if (stage) problems.push(stage);
  const planes = new Map<string, number>();
  for (const [id, anchor] of o.anchors) {
    if (!groups.has(id)) problems.push(`${id} is anchored, but isn't a group of the painting`);
    else if (anchor === 'canvas') continue;
    else if (!(anchor.plane > 0 && Number.isFinite(anchor.plane))) problems.push(`${id} is on a plane at depth ${anchor.plane}; a plane's depth is above 0`);
    // The recipe's motion writes the group's lay too, and frame state takes one writer per field.
    else if (groups.get(id)!.motion) problems.push(`${id} is on a plane, but moves by its recipe's motion; move it with a place play, which the camera composes after`);
    else planes.set(id, anchor.plane);
  }
  const move: CompiledPaintPlay<PaintCameraMoveClip>[] = [], focus: CompiledPaintPlay<PaintCameraFocusClip>[] = [], writers: PaintChannelWriter[] = [];
  for (const play of o.plays) {
    const problem = paintCameraClipProblem(play.clip) ?? paintPlayClockProblem(play.clock);
    if (problem) { problems.push(`${play.origin}: ${problem}`); continue; }
    const clock = compilePaintPlayClock(play.clock, []), interval = paintPlayInterval(clock, clipSeconds(play.clip.keys.at(-1)!.at));
    if (play.clip.kind === 'move') move.push({ clip: play.clip, clock, interval, origin: play.origin });
    else focus.push({ clip: play.clip, clock, interval, origin: play.origin });
    writers.push({ channel: 'camera', target: play.clip.kind === 'move' ? MOVE_LANE : FOCUS_LANE, ...interval, origin: play.origin });
  }
  problems.push(...paintChannelConflicts(writers));
  const camera: PaintCamera = { stage: o.stage, animationFps: fps, planes, move: paintLaneByStart(move), focus: paintLaneByStart(focus) };

  // Easing never overshoots a key, so the camera comes nearest each plane at a key.
  for (const { clip, origin } of move) {
    for (const [i, { dolly = 0 }] of clip.keys.entries()) {
      for (const [id, depth] of planes) if (depth - dolly <= PAINT_CAMERA_NEAREST) problems.push(`${origin} dollies the camera ${dolly} at key ${i}, at or past ${id}'s plane at depth ${depth}; a plane stays in front of the camera`);
    }
  }
  if (problems.length > before) return camera;
  const times = checkTimes([{ from: 0, to: 0 }, ...laneSpans(move), ...laneSpans(focus), ...(o.check ? [o.check] : [])], fps);
  for (const t of focus.length ? times : []) {
    const lens = paintCameraFocusAt(camera, t), { dolly } = paintCameraPoseAt(camera, t);
    if (lens && lens.focus - dolly <= PAINT_CAMERA_NEAREST) { problems.push(`at ${t.toFixed(3)}s the camera focuses at depth ${lens.focus}, at or behind itself (dollied ${dolly})`); break; }
  }
  for (const id of o.backdrops ?? []) {
    const group = groups.get(id);
    if (!group) { problems.push(`${id} is a backdrop, but isn't a group of the painting`); continue; }
    const problem = backdropProblem(camera, id, paintGroupPaintedBox(group), times);
    if (problem) problems.push(problem);
  }
  return camera;
}

/** A camera over `painting`, checked (see the file's head), ready for paintCameraFrameStateAt. */
export function buildPaintCamera(painting: CompiledStampPaint, o: PaintCameraOptions): PaintCameraBuild {
  const problems: string[] = [], camera = compilePaintCamera(painting, o, problems);
  return problems.length ? { ok: false, problems } : { ok: true, camera };
}
