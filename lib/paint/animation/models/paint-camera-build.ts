// paint-camera-build.ts: a camera's planes, projection, lens and plays checked, from plane depths and extents alone;
// a painting is one source (buildPaintingCamera, its nearer planes' extents from paint-motion-reach.ts).
//
// Over the whole shot: no plane or focus comes to or behind the camera (an instanced plane by its near depth); the
// stage holds the frame's preimage on every picture plane where its extent holds anything, grown by the widest
// defocus's reach and a pixel; the back's painting holds it grown by its blur.
//
// Eases never overshoot a key, so between keys pan and the span (d − dolly)/(zoom·d) move monotonically; a roll is
// bounded by its corners' circle; a shutter's poses lie in spans. Frame state outside `motion` is the scene's.

import { LENS_SIGMA_STEP, lensGaussianReach, lensSigmaStepped } from '#lib/picture/lens/models/lens-focus.ts';
import { stampPlaneDepthProblems, stampScenePlanes, type StampLaidPlanes, type StampPlane, type StampPlaneExtent } from '#lib/paint/painting/models/stamp-plane.ts';
import { stampStageExtent, type StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampBox } from '#lib/paint/painting/models/stamp-region.ts';
import { PAINT_ANIMATION_FPS } from '#lib/paint/painting/models/stamp-group-motion.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import {
  PAINT_CAMERA_NEAREST, PAINT_CAMERA_REST, paintCameraClipProblem, paintCameraFocusAt, paintCameraPlaneFarthest, paintCameraPlaneNearest, paintCameraPoseAt, paintPlaneDefocus,
  paintStageCentre,
  type PaintCamera, type PaintCameraFocusClip, type PaintCameraInstancedPlane, type PaintCameraLens, type PaintCameraMoveClip, type PaintCameraPaintedBox, type PaintCameraPlane,
  type PaintCameraPlaneOptions, type PaintCameraPlay, type PaintCameraPose,
} from './paint-camera.ts';
import { paintChannelConflicts, type PaintChannelWriter } from './paint-channels.ts';
import { clipSeconds, compilePaintPlayClock, paintLaneByStart, paintPlayClockProblem, paintPlayInterval, type CompiledPaintPlay } from './paint-clock.ts';
import { paintPxRounded, paintRatioRounded } from './paint-deform.ts';
import type { PaintMotion } from './paint-motion-compile.ts';
import { paintGroupLaidReach } from './paint-motion-reach.ts';
import { paintSimilarityBox, paintSimilarityInverse, paintSimilarityScale } from './paint-similarity.ts';

/**
 * A camera as written: the `stage` its pictures are painted on, its projection (`fov`, vertical degrees over the
 * frame at rest), its `planes` (in any order), its `lens` and its plays (none: it stands at rest, every plane sharp).
 */
export type PaintCameraOptions = {
  readonly stage: StampStage;
  readonly fov: number;
  readonly planes: readonly PaintCameraPlaneOptions[];
  readonly lens: PaintCameraLens;
  readonly plays?: readonly PaintCameraPlay[];
  readonly animationFps?: number;
};

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
 * What a StampPainting shows through, as buildPaintingCamera made it: the camera, and its planes laid for the renderer
 * (the same planes in the same order, each painted plane with the painting's groups it shows).
 */
export type StampPaintingCamera = { readonly camera: PaintCamera; readonly planes: StampLaidPlanes };

export type PaintingCameraBuild =
  | { readonly ok: true; readonly camera: StampPaintingCamera; readonly magnification: ReadonlyMap<string, number> }
  | { readonly ok: false; readonly problems: readonly string[] };

const MOVE_LANE = 'the camera\'s move', FOCUS_LANE = 'the camera\'s focus';

/** A stretch of the shot between two poses, every pose within it eased between them; `name` says where it is. */
type PoseSpan = { readonly a: PaintCameraPose; readonly b: PaintCameraPose; readonly name: string };

/** Every pose the move lane can show, as spans between consecutive keys (a key alone where a clip holds it). */
function poseSpans(move: readonly CompiledPaintPlay<PaintCameraMoveClip>[]): PoseSpan[] {
  if (!move.length) return [{ a: PAINT_CAMERA_REST, b: PAINT_CAMERA_REST, name: 'at rest' }];
  return move.flatMap(({ clip, origin }) => {
    // A key as evaluation rounds it.
    const poses = clip.keys.map(({ pan = { x: 0, y: 0 }, dolly = 0, zoom = 1, roll = 0 }): PaintCameraPose => ({
      pan: { x: paintPxRounded(pan.x), y: paintPxRounded(pan.y) }, dolly: paintRatioRounded(dolly), zoom: paintRatioRounded(zoom), roll: paintRatioRounded(roll),
    }));
    return poses.map((a, i) => ({ a, b: poses[Math.min(i + 1, poses.length - 1)], name: i + 1 < poses.length ? `${origin} from key ${i} to ${i + 1}` : `${origin} at key ${i}` }));
  });
}

/** Plane px per frame px for a plane at `depth`: the inverse of the camera's scale there. */
const planePxPerFramePx = ({ dolly, zoom }: PaintCameraPose, depth: number) => (depth - dolly) / (zoom * depth);

const range = (values: readonly number[]) => ({ low: Math.min(...values), high: Math.max(...values) });

/** The plane points the frame shows of a plane at `depth` anywhere in `span`, as a box (frame origin, px). */
function framePreimageBox(stage: StampStage, { a, b }: PoseSpan, depth: number): StampBox {
  const centre = paintStageCentre(stage), { width, height } = stage.frame;
  const k = range([planePxPerFramePx(a, depth), planePxPerFramePx(b, depth)]);
  const corners = [{ x: -centre.x, y: -centre.y }, { x: width - centre.x, y: -centre.y }, { x: -centre.x, y: height - centre.y }, { x: width - centre.x, y: height - centre.y }];
  const panX = range([a.pan.x / depth, b.pan.x / depth]), panY = range([a.pan.y / depth, b.pan.y / depth]);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  if (a.roll === b.roll) {
    // p = c + R(roll)·(q − c)·k + pan/d, k between its keys' values.
    const cos = Math.cos(a.roll), sin = Math.sin(a.roll);
    for (const q of corners) {
      const rx = cos * q.x - sin * q.y, ry = sin * q.x + cos * q.y;
      for (const scale of [k.low, k.high]) {
        x0 = Math.min(x0, rx * scale); x1 = Math.max(x1, rx * scale);
        y0 = Math.min(y0, ry * scale); y1 = Math.max(y1, ry * scale);
      }
    }
  } else {
    const reach = Math.hypot(centre.x, centre.y) * k.high;
    x0 = -reach; x1 = reach; y0 = -reach; y1 = reach;
  }
  return { x0: centre.x + x0 + panX.low, x1: centre.x + x1 + panX.high, y0: centre.y + y0 + panY.low, y1: centre.y + y1 + panY.high };
}

/** The widest defocus anywhere in the shot of a plane at `depth`, frame px of sigma, from the keys' extremes. */
function widestDefocus(focus: readonly CompiledPaintPlay<PaintCameraFocusClip>[], dolly: { low: number; high: number }, depth: number): number {
  const keys = focus.flatMap(({ clip }) => clip.keys);
  if (!keys.length) return 0;
  const aperture = Math.max(...keys.map((key) => key.aperture)), focused = range(keys.map((key) => key.focus));
  // |1 − F/D| is monotone in F and in D (D above 0), so its extremes are at the corners of their ranges.
  let most = 0;
  for (const f of [focused.low - dolly.high, focused.high - dolly.low]) for (const d of [depth - dolly.high, depth - dolly.low]) most = Math.max(most, Math.abs(1 - f / d));
  return aperture * most;
}

const boxText = ({ x0, x1, y0, y1 }: StampBox) => `${x0.toFixed(0)}..${x1.toFixed(0)} × ${y0.toFixed(0)}..${y1.toFixed(0)}`;
const within = (inner: StampBox, outer: StampBox) => inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;
const grownBox = ({ x0, x1, y0, y1 }: StampBox, by: number): StampBox => ({ x0: x0 - by, x1: x1 + by, y0: y0 - by, y1: y1 + by });
const unionBox = (a: StampBox, b: StampBox): StampBox => ({ x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) });
const meet = (a: StampBox, b: StampBox): StampBox | null => {
  const box = { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) };
  return box.x0 < box.x1 && box.y0 < box.y1 ? box : null;
};

/** Where a nearer plane's groups' paint can lie in the shot: everywhere when one can't be bounded. */
function nearerPaintReach(painting: CompiledStampPaint, groups: readonly number[], motion: PaintMotion | null): StampPlaneExtent {
  let reach: StampBox | null = null;
  for (const index of groups) {
    const laid = paintGroupLaidReach(painting.groups[index], motion);
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

/** How far a defocus of `sigma` px spreads: its reach, the sigma stepped up at most a step, a bilinear read's pixel and one for rounding. */
const defocusGrowth = (sigma: number) => lensGaussianReach(lensSigmaStepped(sigma) * LENS_SIGMA_STEP) + 2;

/**
 * Why a plane at `depth` can't hold what the camera shows of it in some span, or null. `extent`: where its picture
 * holds anything, beyond which it needs nothing held.
 */
function extentProblem(stage: StampStage, { id, depth }: { id: string; depth: number }, extent: StampPlaneExtent, spans: readonly PoseSpan[], sigma: number): string | null {
  if (extent.kind === 'empty' || extent.kind === 'unchecked') return null;
  const stageBox = stampStageExtent(stage);
  for (const span of spans) {
    const k = Math.max(planePxPerFramePx(span.a, depth), planePxPerFramePx(span.b, depth));
    // The blur's reach in picture px, its sigma stepped up at most a step, the bilinear read's pixel, and one for rounding.
    const grow = defocusGrowth(sigma * k);
    const seen = framePreimageBox(stage, span, depth), needed = grownBox(seen, grow);
    // The picture's own defocus spreads it `grow` past its extent, and that spread must be on the stage too.
    const held = extent.kind === 'everywhere' ? needed : meet(needed, grownBox(extent.box, grow));
    if (held && !within(held, stageBox)) {
      return `plane ${id}'s picture must hold what the camera shows of it, ${boxText(held)} ${span.name}, but the stage holds ${boxText(stageBox)}; widen the stage's margin`;
    }
  }
  return null;
}

/**
 * Why `camera` can't show plane `plane` held as far as `extent` anywhere in its shot, or null: the build's check, for
 * a plane whose extent is known only once the camera is (a lay worked back through its view, an element measured).
 */
export function paintCameraExtentProblem(camera: PaintCamera, plane: { readonly id: string; readonly depth: number }, extent: StampPlaneExtent): string | null {
  const spans = poseSpans(camera.move), dolly = range(spans.flatMap(({ a, b }) => [a.dolly, b.dolly]));
  return extentProblem(camera.stage, plane, extent, spans, widestDefocus(camera.focus, dolly, plane.depth));
}

/**
 * How the opaque back's painting falls short of what the camera reads of it in one span, document px: `past`, its
 * reach past the frame (below 0: inside); `blur`, the blur's reach past the frame; `short`, how much larger to paint
 * it each side; `scale`, how much larger to lay it about its centre (Infinity: no lay can).
 */
type PaintedShortfall = { readonly past: number; readonly blur: number; readonly short: number; readonly scale: number };

/** Below this many document px short, a shortfall is the float arithmetic's, not the painting's. */
const PAINTED_SLACK = 1e-6;
/** `value` rounded up, its float arithmetic's slack let go: a back grown by the amount suggested then passes. */
const ceilPainted = (value: number) => Math.ceil(value - PAINTED_SLACK);

/**
 * How `painted` falls short of what the camera reads of a plane at `depth` over `span`, defocused by `sigma` frame px,
 * or null where it holds it all. A sharp plane reads only what the frame shows: a frame-sized back at rest holds it.
 */
function paintedShortfall(stage: StampStage, span: PoseSpan, depth: number, sigma: number, { box, lay }: PaintCameraPaintedBox): PaintedShortfall | null {
  const k = Math.max(planePxPerFramePx(span.a, depth), planePxPerFramePx(span.b, depth)), grow = sigma > 0 ? defocusGrowth(sigma * k) : 0;
  const toDocument = paintSimilarityInverse(lay), framed = framePreimageBox(stage, span, depth);
  const seen = paintSimilarityBox(toDocument, framed), read = paintSimilarityBox(toDocument, grownBox(framed, grow));
  const short = Math.max(box.x0 - read.x0, read.x1 - box.x1, box.y0 - read.y0, read.y1 - box.y1);
  if (short <= PAINTED_SLACK) return null;
  const past = Math.min(seen.x0 - box.x0, box.x1 - seen.x1, seen.y0 - box.y0, box.y1 - seen.y1);
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2, hw = (box.x1 - box.x0) / 2, hh = (box.y1 - box.y0) / 2;
  const scale = hw > 0 && hh > 0 ? Math.max((cx - read.x0) / hw, (read.x1 - cx) / hw, (cy - read.y0) / hh, (read.y1 - cy) / hh) : Infinity;
  return { past, blur: grow / paintSimilarityScale(lay), short, scale };
}

/** Why the back's shortfall `when` (a span's name, a moment) is one, in a painter's words: refused, never clamped. */
function paintedProblemText(id: string, when: string, { past, blur, short, scale }: PaintedShortfall): string {
  const reaches = past >= 0 ? `${Math.floor(past)} px past the frame` : `to ${Math.ceil(-past)} px inside the frame`;
  const blurred = blur > 0 ? `, and its blur reads ${Math.ceil(blur)} px past the frame` : '';
  const larger = Number.isFinite(scale) ? `lay it ${(ceilPainted((scale - 1) * 1000) / 10).toFixed(1)}% larger about its centre` : 'lay it larger';
  return `plane ${id}, the back, is painted ${reaches} (${when})${blurred}, and past its painting lies bare paper: paint it ${ceilPainted(short)} px larger on every side, or ${larger}`;
}

/** Why the back `plane`, painted over `painted`, can't be shown in `spans` defocused by `sigma`, or null: its worst span's shortfall. */
function paintedProblem(stage: StampStage, { id, depth }: { id: string; depth: number }, painted: PaintCameraPaintedBox, spans: readonly PoseSpan[], sigma: number): string | null {
  let worst: { span: PoseSpan; shortfall: PaintedShortfall } | null = null;
  for (const span of spans) {
    const shortfall = paintedShortfall(stage, span, depth, sigma, painted);
    if (shortfall && (!worst || shortfall.short > worst.shortfall.short)) worst = { span, shortfall };
  }
  return worst && paintedProblemText(id, worst.span.name, worst.shortfall);
}

/**
 * Why `camera` can't show the opaque back `plane` painted over `painted` anywhere in its shot, or null: the build's
 * check, for a back laid only once the camera is (a cover worked back through its view, a pin measured).
 */
export function paintCameraPaintedProblem(camera: PaintCamera, plane: { readonly id: string; readonly depth: number }, painted: PaintCameraPaintedBox): string | null {
  const spans = poseSpans(camera.move), dolly = range(spans.flatMap(({ a, b }) => [a.dolly, b.dolly]));
  return paintedProblem(camera.stage, plane, painted, spans, widestDefocus(camera.focus, dolly, plane.depth));
}

/**
 * Why `camera` can't show the opaque back `plane` as one frame lays it, `laid` giving its painting at each moment the
 * frame reads (its own, its shutter's ends), or null: the build's check at each moment's pose and defocus, for a lay
 * read only as the frame is drawn.
 */
export function paintCameraPaintedProblemAt(
  camera: PaintCamera, plane: { readonly id: string; readonly depth: number }, laid: readonly { readonly moment: PaintMoment; readonly painted: PaintCameraPaintedBox }[],
): string | null {
  for (const { moment, painted } of laid) {
    const pose = paintCameraPoseAt(camera, moment), focus = paintCameraFocusAt(camera, moment);
    const problem = paintedProblem(camera.stage, plane, painted, [{ a: pose, b: pose, name: `at ${moment.at} s` }], focus ? paintPlaneDefocus(focus, pose.dolly, plane.depth) : 0);
    if (problem) return problem;
  }
  return null;
}

/** A camera over `o.planes`, checked (see the file's head), with each plane's greatest magnification. */
export function buildPaintCamera(o: PaintCameraOptions): PaintCameraBuild {
  const problems: string[] = [], fps = o.animationFps ?? PAINT_ANIMATION_FPS;
  stampPlaneDepthProblems(o.planes.map((plane) => ({ id: plane.id, depth: paintCameraPlaneNearest(plane) })), problems);
  for (const plane of o.planes) {
    const problem = plane.kind === 'picture' ? extentBoxProblem(plane.id, plane.extent) : plane.kind === 'instanced' && instancedDepthsProblem(plane);
    if (problem) problems.push(problem);
  }
  if (!(o.fov > 0 && o.fov < 180)) problems.push(`a field of view is between 0 and 180 degrees, not ${o.fov}`);
  if (!(o.lens.bloom >= 0 && Number.isFinite(o.lens.bloom))) problems.push(`the lens blooms by a sigma of 0 px or more, not ${o.lens.bloom}`);
  if (!(o.lens.shutter >= 0 && Number.isFinite(o.lens.shutter))) problems.push(`the lens's shutter is open 0 s or more, not ${o.lens.shutter}`);
  const move: CompiledPaintPlay<PaintCameraMoveClip>[] = [], focus: CompiledPaintPlay<PaintCameraFocusClip>[] = [], writers: PaintChannelWriter[] = [];
  for (const play of o.plays ?? []) {
    const problem = paintCameraClipProblem(play.clip) ?? paintPlayClockProblem(play.clock);
    if (problem) { problems.push(`${play.origin}: ${problem}`); continue; }
    const clock = compilePaintPlayClock(play.clock, []), interval = paintPlayInterval(clock, clipSeconds(play.clip.keys.at(-1)!.at));
    if (play.clip.kind === 'move') move.push({ clip: play.clip, clock, interval, origin: play.origin });
    else focus.push({ clip: play.clip, clock, interval, origin: play.origin });
    writers.push({ channel: 'camera', target: play.clip.kind === 'move' ? MOVE_LANE : FOCUS_LANE, ...interval, origin: play.origin });
  }
  problems.push(...paintChannelConflicts(writers));
  if (problems.length) return { ok: false, problems };
  // Ties keep their written order, as stampScenePlanes keeps them.
  const written = o.planes.toSorted((a, b) => paintCameraPlaneFarthest(b) - paintCameraPlaneFarthest(a));
  const spans = poseSpans(move), dolly = range(spans.flatMap(({ a, b }) => [a.dolly, b.dolly]));
  for (const plane of written) {
    const depth = paintCameraPlaneNearest(plane);
    if (depth - dolly.high <= PAINT_CAMERA_NEAREST) problems.push(`the camera dollies ${dolly.high}, at or past plane ${plane.id} at depth ${depth}; a plane stays in front of the camera`);
  }
  const focused = focus.flatMap(({ clip }) => clip.keys.map((key) => key.focus));
  if (focused.length && Math.min(...focused) - dolly.high <= PAINT_CAMERA_NEAREST) {
    problems.push(`the camera may focus at depth ${Math.min(...focused)} while dollied ${dolly.high}, at or behind itself`);
  }
  if (problems.length) return { ok: false, problems };
  for (const plane of written) {
    if (plane.kind !== 'picture') continue;
    const sigma = widestDefocus(focus, dolly, plane.depth);
    const found = [extentProblem(o.stage, plane, plane.extent, spans, sigma), plane.painted ? paintedProblem(o.stage, plane, plane.painted, spans, sigma) : null];
    problems.push(...found.filter((problem) => problem !== null));
  }
  if (problems.length) return { ok: false, problems };
  // A three plane is rendered through the camera, a frame px a px, so its margin is its defocus's growth alone.
  const planes = written.map((plane): PaintCameraPlane => {
    if (plane.kind !== 'three') return plane;
    const sigma = widestDefocus(focus, dolly, plane.depth);
    return { id: plane.id, depth: plane.depth, kind: 'three', margin: sigma > 0 ? Math.ceil(defocusGrowth(sigma)) : 0 };
  });
  const camera: PaintCamera = { stage: o.stage, fov: o.fov, planes, lens: o.lens, animationFps: fps, move: paintLaneByStart(move), focus: paintLaneByStart(focus) };
  const zoom = range(spans.flatMap(({ a, b }) => [a.zoom, b.zoom]));
  // zoom·d/(d − dolly) at its largest zoom and dolly: at least what any pose in the shot shows.
  const magnification = new Map(planes.map((plane) => {
    const depth = paintCameraPlaneNearest(plane);
    return [plane.id, (zoom.high * depth) / (depth - dolly.high)];
  }));
  return { ok: true, camera, magnification };
}

/**
 * A camera over a scene's planes, checked over `painting` first (stampScenePlanes; null for a scene that paints
 * nothing): a painted back holds paint everywhere, a nearer painted plane wherever `motion` can lay its groups, and a
 * picture plane as far as its source's extent.
 */
export function buildPaintingCamera(painting: CompiledStampPaint | null, { planes: written, motion, ...o }: PaintingCameraOptions): PaintingCameraBuild {
  const problems: string[] = [];
  const scene = stampScenePlanes(painting, written, problems);
  if (problems.length || !scene) return { ok: false, problems };
  const { back, nearer } = scene;
  const built = buildPaintCamera({
    ...o,
    planes: [back, ...nearer].map((plane): PaintCameraPlaneOptions => {
      const { id, depth } = plane;
      switch (plane.kind) {
        case 'three': return { id, depth, kind: 'three' };
        case 'picture': return { id, depth, kind: 'picture', extent: plane.extent };
        // stampScenePlanes refuses a painted plane without a painting.
        case 'painted': return { id, depth, kind: 'picture', extent: plane === back ? { kind: 'everywhere' } : nearerPaintReach(painting!, plane.groups, motion) };
        default: return plane satisfies never;
      }
    }),
  });
  return built.ok ? { ok: true, camera: { camera: built.camera, planes: scene }, magnification: built.magnification } : built;
}
