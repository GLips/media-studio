// shot-motion-warnings.ts: a compiled shot's motion judged frame by frame over its span for what tends to read badly:
// warnings beside a shot that draws, which `studio paint check` and the render print, never refusals. Each drawable (a
// plane, and an occurrence with a node or a visibility of its own) is followed as a similarity, document px to frame
// px: the camera's view after its lay after its nodes' placements. docs/painting-authoring.md says what each means.
//
// Negative space: bends (pins, sway, flutter, boil) and rigs' poses move paint within a drawable and aren't followed;
// nor are instanced planes' items, three planes, or a plane pinned to HTML, laid only as each frame measures it.

import { paintCameraPoseAt, paintCameraShutterShut, paintPlaneSimilarity, paintStageCentre, type PaintCameraPose } from '#lib/paint/animation/models/paint-camera.ts';
import { paintLevelPlacementAt } from '#lib/paint/animation/models/paint-motion-frame.ts';
import {
  PAINT_SIMILARITY_IDENTITY, paintSimilarityAfter, paintSimilarityApply, paintSimilarityInverse, paintSimilarityOf, type PaintSimilarity,
} from '#lib/paint/animation/models/paint-similarity.ts';
import { paintSecondsText, type PaintSpanFrame } from '#lib/paint/animation/models/paint-span-moments.ts';
import { presentationValueAt, type PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import { paintingNodeBox } from '#lib/paint/document/models/painting-footprint.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { stampStageExtent } from '#lib/paint/painting/models/stamp-stage.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane, CompiledShotPlane } from './shot-compile.ts';
import { shotPlaneLayAt, shotPlaneMomentAt } from './shot-frame-plan.ts';

/** Where a frame's speed is read: a quarter frame either side, the frame's own drawing held (its `frame`). */
const SPEED_STEP = 0.25;

/**
 * A speed jump: speed changing across two frames by at least this many px a frame more than the acceleration either
 * side of them accounts for, and by at least JUMP_SHARE of the faster speed, so a slow drift's rounding never counts.
 */
const JUMP_PX = 2;
const JUMP_SHARE = 0.5;

/**
 * With the shutter shut, the most of the frame's width a drawable moves a second: the seven-second rule's pace (a pan
 * crossing the frame in under 7 s judders even with a half-open shutter's blur to bridge its frames). Crisper motion
 * than that reads as staccato, a painted look; past it, it strobes.
 */
const SHUT_WIDTHS_A_SECOND = 1 / 7;

/**
 * A pop: visibility changing by at least this much between two frames while in frame, unless it's a swap: a drawable on
 * the same plane, where it shows, stepping as far the other way then (a cel or a view switched by visibility).
 */
const POP_STEP = 0.9;

/**
 * A drawable followed: its name and plane, its box (document px), how it lies at a moment, and how visible it is then;
 * `moves` false for an occurrence moved only as its plane is, whose motion its plane's warnings say.
 */
type ShotFollowed = {
  readonly name: string;
  readonly plane: string;
  readonly moves: boolean;
  readonly box: StampBox;
  readonly placeAt: (moment: PaintMoment, sample: number) => PaintSimilarity;
  readonly visibilityAt: (moment: PaintMoment) => number;
};

const cross = (o: StampPoint, a: StampPoint, b: StampPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** `polygon` clipped to the convex `within` (Sutherland–Hodgman), either winding. */
function clippedPolygon(polygon: readonly StampPoint[], within: readonly StampPoint[]): StampPoint[] {
  const winding = Math.sign(within.reduce((area, p, i) => area + cross({ x: 0, y: 0 }, p, within[(i + 1) % within.length]), 0));
  let out = [...polygon];
  for (let i = 0; i < within.length && out.length; i++) {
    const a = within[i], b = within[(i + 1) % within.length], inside = (p: StampPoint) => cross(a, b, p) * winding >= 0;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      if (inside(p)) out.push(p);
      if (inside(p) !== inside(q)) {
        const dp = cross(a, b, p), dq = cross(a, b, q), k = dp / (dp - dq);
        out.push({ x: p.x + k * (q.x - p.x), y: p.y + k * (q.y - p.y) });
      }
    }
  }
  return out;
}

const corners = ({ x0, y0, x1, y1 }: StampBox): StampPoint[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

/** The part of `box` (document px) `place` shows in a frame `width` × `height`: none where it lays it at scale 0. */
function shownPart(box: StampBox, place: PaintSimilarity, width: number, height: number): StampPoint[] {
  if (place.ma === 0 && place.mb === 0) return [];
  const back = paintSimilarityInverse(place);
  return clippedPolygon(corners(box), corners({ x0: 0, y0: 0, x1: width, y1: height }).map((p) => paintSimilarityApply(back, p)));
}

const distance = (a: StampPoint, b: StampPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const px = (n: number) => Number(n.toFixed(1));

/** The occurrence `key` of `plane`'s box: its node's in the first end showing it. */
function occurrenceBox(plane: CompiledShotPaintedPlane, node: string): StampBox | undefined {
  for (const { selection } of plane.ends) {
    const place = selection.painting.tree.byKey.get(node);
    if (place) return paintingNodeBox(place.node);
  }
  return undefined;
}

/** Each drawable of `shot` followed (see the file's head), `cameraAt` the camera's pose at a sample, kept. */
function followedDrawables(shot: CompiledPaintedShot, cameraAt: (sample: number) => PaintCameraPose): ShotFollowed[] {
  const { camera, motion } = shot, centre = paintStageCentre(camera.stage), fps = motion.animationFps;
  const placements = new Map<string, PaintSimilarity[]>();
  const nodePlaceAt = (id: string, moment: PaintMoment, sample: number) => {
    const memo = placements.get(id) ?? [];
    placements.set(id, memo);
    memo[sample] ??= (() => {
      const place = paintLevelPlacementAt(motion.nodes.get(id)!, moment, fps);
      return place ? paintSimilarityOf(place.placement, place.pivot) : PAINT_SIMILARITY_IDENTITY;
    })();
    return memo[sample];
  };
  const visibilityOf = (plane: string, key: string) => {
    const value: PresentationValue<number> | undefined = shot.visibility.get(key);
    return (moment: PaintMoment) => (value === undefined ? 1 : presentationValueAt(value, shotPlaneMomentAt(motion, plane, moment)));
  };
  const followed: ShotFollowed[] = [];
  for (const plane of shot.planes) {
    const followable = plane.kind === 'picture' || (plane.kind === 'painted' && plane.lay.kind !== 'screen');
    if (!followable) continue;
    const box = planeBox(shot, plane);
    if (!box) continue;
    // Plane px to frame px, then the plane's lay and node.
    const planeAt = (moment: PaintMoment, sample: number): PaintSimilarity => {
      const view = paintPlaneSimilarity(cameraAt(sample), plane.depth, centre);
      const lay = plane.kind === 'painted' ? shotPlaneLayAt(plane, motion, moment) : PAINT_SIMILARITY_IDENTITY;
      return paintSimilarityAfter(paintSimilarityAfter(view, lay), motion.nodes.has(plane.id) ? nodePlaceAt(plane.id, moment, sample) : PAINT_SIMILARITY_IDENTITY);
    };
    followed.push({ name: plane.id, plane: plane.id, moves: true, box, placeAt: planeAt, visibilityAt: visibilityOf(plane.id, plane.id) });
    if (plane.kind !== 'painted') continue;
    for (const occurrence of plane.occurrences) {
      if (!motion.nodes.has(occurrence.key) && !shot.visibility.has(occurrence.key)) continue;
      const occurrenceBoxFound = occurrenceBox(plane, occurrence.node);
      if (!occurrenceBoxFound) continue;
      // Its nodes, nearest first, up to (not including) its plane's.
      const line: string[] = [];
      for (let id = motion.nearest.get(occurrence.key); id !== undefined && id !== plane.id; id = motion.nodes.get(id)!.parent ?? undefined) line.push(id);
      followed.push({
        name: occurrence.key, plane: plane.id, moves: line.length > 0, box: occurrenceBoxFound, visibilityAt: visibilityOf(plane.id, occurrence.key),
        placeAt: (moment, sample) => line.reduceRight((outer, id) => paintSimilarityAfter(outer, nodePlaceAt(id, moment, sample)), planeAt(moment, sample)),
      });
    }
  }
  return followed;
}

/** A plane's box, plane px: a painted plane's document, a picture's extent (the stage for one everywhere); none for one empty. */
function planeBox(shot: CompiledPaintedShot, plane: CompiledShotPlane): StampBox | undefined {
  if (plane.kind === 'painted') return { x0: 0, y0: 0, x1: plane.paints.widthPx, y1: plane.paints.heightPx };
  if (plane.kind !== 'picture') return undefined;
  const { extent } = plane.source;
  if (extent.kind === 'box') return extent.box;
  return extent.kind === 'everywhere' ? stampStageExtent(shot.camera.stage) : undefined;
}

/** Runs of consecutive flagged indices, each its first and last. */
function runsOf(flagged: readonly number[]): { first: number; last: number }[] {
  const runs: { first: number; last: number }[] = [];
  for (const k of flagged) {
    const run = runs.at(-1);
    if (run && run.last === k - 1) run.last = k;
    else runs.push({ first: k, last: k });
  }
  return runs;
}

/** A drawable judged over a shot's frames: where it lies at each sample, what of it each frame shows, how visible it is. */
type ShotJudged = {
  readonly drawable: ShotFollowed;
  readonly at: (sample: number) => PaintSimilarity;
  readonly shown: readonly (readonly StampPoint[])[];
  readonly visibility: readonly number[];
};

/** How far `judged`'s visibility steps from frame k to frame k + 1. */
const visibilityStep = ({ visibility }: ShotJudged, k: number) => visibility[k + 1] - visibility[k];

/** Where `judged` shows across frames k and k + 1, frame px, or null where it shows in neither. */
function shownAcross({ at, shown }: ShotJudged, k: number): StampBox | null {
  const points = [...shown[k].map((p) => paintSimilarityApply(at(3 * k + 1), p)), ...shown[k + 1].map((p) => paintSimilarityApply(at(3 * k + 4), p))];
  if (!points.length) return null;
  return { x0: Math.min(...points.map(({ x }) => x)), y0: Math.min(...points.map(({ y }) => y)), x1: Math.max(...points.map(({ x }) => x)), y1: Math.max(...points.map(({ y }) => y)) };
}

/** Whether `one`'s step at frame k is a swap (POP_STEP): another of `all` on its plane steps as far the other way where it shows. */
function swappedAt(all: readonly ShotJudged[], one: ShotJudged, k: number): boolean {
  const here = shownAcross(one, k);
  return !!here && all.some((other) => {
    if (other === one || other.drawable.plane !== one.drawable.plane) return false;
    if (!(visibilityStep(other, k) * visibilityStep(one, k) < 0) || Math.abs(visibilityStep(other, k)) < POP_STEP) return false;
    const there = shownAcross(other, k);
    return !!there && here.x0 < there.x1 && there.x0 < here.x1 && here.y0 < there.y1 && there.y0 < here.y1;
  });
}

/** The accelerations a speed change may be carried by, given those of the frames either side: each, and their mean. */
function accelerationsCarried(around: readonly StampPoint[]): readonly StampPoint[] {
  if (around.length === 2) return [...around, { x: (around[0].x + around[1].x) / 2, y: (around[0].y + around[1].y) / 2 }];
  return around.length ? around : [{ x: 0, y: 0 }];
}

/** The run of frames from `first` to `last` (indices into `frames`) as a diagnostic names when it happens. */
function runText(frames: readonly PaintSpanFrame[], first: number, last: number): string {
  return first === last ? `at ${paintSecondsText(frames[first].t)}` : `from ${paintSecondsText(frames[first].t)} to ${paintSecondsText(frames[last].t)}`;
}

/**
 * `shot`'s motion over `frames` judged (see the file's head): for each drawable, a speed jump at a key, a move faster
 * than the shut shutter carries, a visibility popping within a frame; each run of frames once, as warnings.
 */
export function shotMotionWarnings(shot: CompiledPaintedShot, frames: readonly PaintSpanFrame[]): PaintingProblem[] {
  const { camera, span } = shot, { width, height } = camera.stage.frame, step = SPEED_STEP / span.fps;
  // Three samples a frame: before, at and after it, each reading the frame's drawing. One outside the span reads
  // nothing the shot shows: a move under way at its cut isn't a jump.
  const samples = frames.flatMap(({ t }) => [paintMoment(t - step, t), paintMoment(t), paintMoment(t + step, t)]);
  const hasBefore = frames.map(({ t }) => t - step >= span.from - 1e-9), hasAfter = frames.map(({ t }) => t + step < span.to - 1e-9);
  const poses: PaintCameraPose[] = [];
  const cameraAt = (sample: number) => (poses[sample] ??= paintCameraPoseAt(camera, samples[sample]));
  const warnings: PaintingProblem[] = [], warn = (name: string, message: string) => warnings.push(paintingProblem('warning', name, 'motion', message));
  const shut = paintCameraShutterShut(camera.lens), limit = (width * SHUT_WIDTHS_A_SECOND) / span.fps;
  const judged: ShotJudged[] = followedDrawables(shot, cameraAt).map((drawable) => {
    const placed: PaintSimilarity[] = [], at = (sample: number) => (placed[sample] ??= drawable.placeAt(samples[sample], sample));
    const shown = frames.map((_, k) => shownPart(drawable.box, at(3 * k + 1), width, height));
    return { drawable, at, shown, visibility: frames.map((_, k) => drawable.visibilityAt(samples[3 * k + 1])) };
  });
  for (const one of judged) {
    const { drawable, at, shown, visibility } = one;
    // Document point p about frame k: its velocity just before and just after (px a frame), and its acceleration
    // (px a frame²), each null where its sample lies outside the span.
    const motionAt = (k: number, p: StampPoint) => {
      const [a, b, c] = [at(3 * k), at(3 * k + 1), at(3 * k + 2)].map((place) => paintSimilarityApply(place, p));
      return {
        before: hasBefore[k] ? { x: (b.x - a.x) / SPEED_STEP, y: (b.y - a.y) / SPEED_STEP } : null,
        after: hasAfter[k] ? { x: (c.x - b.x) / SPEED_STEP, y: (c.y - b.y) / SPEED_STEP } : null,
        acceleration: hasBefore[k] && hasAfter[k] ? { x: (c.x - 2 * b.x + a.x) / SPEED_STEP ** 2, y: (c.y - 2 * b.y + a.y) / SPEED_STEP ** 2 } : null,
      };
    };
    // Across frames k and k + 1, how far p's speed changes past what acceleration carries it over those 1 + SPEED_STEP
    // frames: the frames' either side, whose windows a key between these two can't reach; the least left by either or
    // their mean, since a key of their own (or an ease turning) moves one.
    const jumpAt = (k: number, p: StampPoint) => {
      const from = motionAt(k, p).before, to = motionAt(k + 1, p).after;
      if (!from || !to) return null;
      const around = [k - 1, k + 2].flatMap((j) => (j >= 0 && j < frames.length ? [motionAt(j, p).acceleration] : [])).filter((each) => each !== null);
      const carried = accelerationsCarried(around);
      const residual = Math.min(...carried.map((a) => Math.hypot(to.x - from.x - a.x * (1 + SPEED_STEP), to.y - from.y - a.y * (1 + SPEED_STEP))));
      return { residual, from: Math.hypot(from.x, from.y), to: Math.hypot(to.x, to.y) };
    };
    const jumps: number[] = [], fast: number[] = [], pops: number[] = [], movedBy: number[] = [];
    let jumpPoint: StampPoint | null = null;
    for (let k = 0; k + 1 < frames.length; k++) {
      const points = drawable.moves && visibility[k] > 0 ? shown[k] : [];
      let worst = 0, worstPoint: StampPoint | null = null, moved = 0;
      for (const p of points) {
        const jump = jumpAt(k, p);
        if (jump && jump.residual >= JUMP_PX && jump.residual >= JUMP_SHARE * Math.max(jump.from, jump.to) && jump.residual > worst) [worst, worstPoint] = [jump.residual, p];
        moved = Math.max(moved, distance(paintSimilarityApply(at(3 * k + 4), p), paintSimilarityApply(at(3 * k + 1), p)));
      }
      if (worstPoint) {
        jumps.push(k);
        jumpPoint ??= worstPoint;
      }
      movedBy[k] = moved;
      if (shut && moved > limit) fast.push(k);
      const inFrame = shown[k].length > 0 || shown[k + 1].length > 0;
      if (inFrame && Math.abs(visibilityStep(one, k)) >= POP_STEP && !swappedAt(judged, one, k)) pops.push(k);
    }
    // A jump on a frame shows in the pairs either side of it; between two frames, in theirs alone.
    for (const { first, last } of runsOf(jumps)) {
      const p = jumpPoint!, from = jumpAt(first, p)!.from, to = jumpAt(last, p)!.to;
      const when = last === first + 1 ? `at ${paintSecondsText(frames[last].t)}` : `between ${paintSecondsText(frames[first].t)} and ${paintSecondsText(frames[last + 1].t)}`;
      warn(drawable.name, `its speed jumps ${when}, from ${px(from)} to ${px(to)} px a frame: meet the key at the speed it leaves at (a curve easing into it, or between: 'smooth')`);
    }
    for (const { first, last } of runsOf(fast)) {
      const fastest = Math.max(...movedBy.slice(first, last + 1));
      warn(drawable.name, `moves up to ${px(fastest)} px a frame with the shutter shut, ${runText(frames, first, last + 1)}; past ${px(limit)} px a frame it strobes: slow it, or open the shutter`);
    }
    if (pops.length) {
      const k = pops[0], more = pops.length > 1 ? ` (and ${pops.length - 1} more time${pops.length > 2 ? 's' : ''})` : '';
      warn(drawable.name, `its visibility steps from ${px(visibility[k])} to ${px(visibility[k + 1])} within a frame at ${paintSecondsText(frames[k + 1].t)}${more}: it pops in or out`);
    }
  }
  return warnings;
}
