// paint-motion-warnings.ts: motion judged frame by frame over a camera's span for what tends to read badly, warnings
// beside a picture that draws, never refusals. Each warning is its owner's. The camera's own move is judged once, as
// it carries its nearest plane; each drawable the caller follows (a shot's planes and occurrences,
// shot-motion-warnings.ts; a StampPainting's moving groups, paint-painting-motion-warnings.ts) on the motion it adds,
// what carries it held as it stands that frame, so a camera knock warns on the camera alone, not on every plane.
// docs/painting-authoring.md says what each warning means.

import { paintCameraMovesBetween, paintCameraPoseAt, paintCameraShutterShut, paintPlaneSimilarity, paintStageCentre, type PaintCamera, type PaintCameraPose } from './paint-camera.ts';
import { paintSimilarityApply, paintSimilarityInverse, type PaintSimilarity } from './paint-similarity.ts';
import { paintSecondsText, type PaintSpanFrame } from './paint-span-moments.ts';
import { presentationValueAt } from './paint-value.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampBox, StampPoint } from '#lib/paint/painting/models/stamp-region.ts';

/** Where a frame's speed is read: a quarter frame either side, the frame's own drawing held (its `frame`). */
const SPEED_STEP = 0.25;

/**
 * A speed jump: speed changing across two frames by at least this many px a frame more than the acceleration either
 * side of them accounts for, and by at least JUMP_SHARE of the faster speed, so a slow drift's rounding never counts.
 */
const JUMP_PX = 2;
const JUMP_SHARE = 0.5;

/**
 * With nothing to blur it, the most of the frame's width a drawable moves a second: the seven-second rule's pace (a
 * pan crossing the frame in under 7 s judders even with a half-open shutter's blur to bridge its frames). Crisper
 * motion than that reads as staccato, a painted look; past it, it strobes.
 */
const SHUT_WIDTHS_A_SECOND = 1 / 7;

/**
 * A step is a hold's when the drawable moves, within its frames, under this share of how far it steps between them:
 * its drawing is held, through the shutter too, so no shutter blurs the step.
 */
const HELD_SHARE = 0.5;

/** The most frames a hold's steps lie apart and still count as one run of them: a hold on fours. */
const HOLD_GAP = 4;

/**
 * A pop: visibility changing by at least this much between two frames while in frame, unless it's a swap: a drawable at
 * the same depth, where it shows, stepping as far the other way then (a cel, or a view on a plane of its own, switched
 * by visibility).
 */
const POP_STEP = 0.9;

/** The moments the judge reads, three a frame (a quarter frame before, at and after it), and the camera's pose at each, kept. */
export type PaintMotionSamples = { readonly moments: readonly PaintMoment[]; readonly cameraAt: (sample: number) => PaintCameraPose };

/**
 * A drawable followed, its box in document px (`everywhere`: whatever the frame shows). `placeAt(sample, held)` lays
 * it, document px to frame px, at `sample` with what carries it (the camera, its plane, the nodes above its own) as at
 * `held`: `placeAt(s, s)` is where the frame shows it. `snapsBetween`: whether its own motion means a jump there.
 */
export type PaintMotionFollowed = {
  readonly name: string;
  readonly depthAt: (sample: number) => number;
  readonly box: StampBox | 'everywhere';
  readonly placeAt: (sample: number, held: number) => PaintSimilarity;
  readonly visibilityAt: (moment: PaintMoment) => number;
  readonly snapsBetween: (from: number, to: number) => boolean;
};

/** A warning about drawable `name`'s motion, or the camera's (`camera`). */
export type PaintMotionWarning = { readonly name: string; readonly message: string };

/** How far `p` moves from frame k to frame k + 1, laid by `at` (samples three a frame). */
function frameStepOf(at: (sample: number) => PaintSimilarity, k: number, p: StampPoint): StampPoint {
  const a = paintSimilarityApply(at(3 * k + 1), p), b = paintSimilarityApply(at(3 * k + 4), p);
  return { x: b.x - a.x, y: b.y - a.y };
}

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
function shownPart(box: StampBox | 'everywhere', place: PaintSimilarity, width: number, height: number): StampPoint[] {
  if (place.ma === 0 && place.mb === 0) return [];
  const back = paintSimilarityInverse(place), frame = corners({ x0: 0, y0: 0, x1: width, y1: height }).map((p) => paintSimilarityApply(back, p));
  return box === 'everywhere' ? frame : clippedPolygon(corners(box), frame);
}

const px = (n: number) => Number(n.toFixed(1));

/** Runs of consecutive flagged indices, each its first and last; with `bridged`, across a gap it says joins two. */
function runsOf(flagged: readonly number[], bridged: (last: number, next: number) => boolean = () => false): { first: number; last: number }[] {
  const runs: { first: number; last: number }[] = [];
  for (const k of flagged) {
    const run = runs.at(-1);
    if (run && (run.last === k - 1 || bridged(run.last, k))) run.last = k;
    else runs.push({ first: k, last: k });
  }
  return runs;
}

/** A drawable judged over the frames: where the frame shows it at each sample, what of it each frame shows, how visible it is. */
type PaintMotionJudged = {
  readonly drawable: PaintMotionFollowed;
  readonly at: (sample: number) => PaintSimilarity;
  readonly shown: readonly (readonly StampPoint[])[];
  readonly visibility: readonly number[];
};

/** How far `judged`'s visibility steps from frame k to frame k + 1. */
const visibilityStep = ({ visibility }: PaintMotionJudged, k: number) => visibility[k + 1] - visibility[k];

/** Where `judged` shows across frames k and k + 1, frame px, or null where it shows in neither. */
function shownAcross({ at, shown }: PaintMotionJudged, k: number): StampBox | null {
  const points = [...shown[k].map((p) => paintSimilarityApply(at(3 * k + 1), p)), ...shown[k + 1].map((p) => paintSimilarityApply(at(3 * k + 4), p))];
  if (!points.length) return null;
  return { x0: Math.min(...points.map(({ x }) => x)), y0: Math.min(...points.map(({ y }) => y)), x1: Math.max(...points.map(({ x }) => x)), y1: Math.max(...points.map(({ y }) => y)) };
}

/** Whether `one`'s step at frame k is a swap (POP_STEP): another of `all` at its depth steps as far the other way where it shows. */
function swappedAt(all: readonly PaintMotionJudged[], one: PaintMotionJudged, k: number): boolean {
  const here = shownAcross(one, k);
  return !!here && all.some((other) => {
    if (other === one || other.drawable.depthAt(3 * k + 1) !== one.drawable.depthAt(3 * k + 1)) return false;
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

/** The times a warning's other runs happen, after its own: each up to three, else how many and the last. */
function othersText(seconds: readonly number[]): string {
  const sorted = seconds.toSorted((a, b) => a - b).map(paintSecondsText);
  if (!sorted.length) return '';
  if (sorted.length > 3) return ` (and ${sorted.length} more times, the last at ${sorted.at(-1)})`;
  return ` (and at ${sorted.length === 1 ? sorted[0] : `${sorted.slice(0, -1).join(', ')} and ${sorted.at(-1)}`})`;
}

/** The nearest depth any of `camera`'s planes lies at, at any of `moments`: where its move carries paint farthest. */
function nearestDepth(camera: PaintCamera, moments: readonly PaintMoment[]): number {
  return camera.planes.reduce((nearest, plane) => {
    if (plane.kind === 'instanced') return Math.min(nearest, plane.depths.near);
    const { depth } = plane;
    return typeof depth === 'number' ? Math.min(nearest, depth) : moments.reduce((least, moment) => Math.min(least, presentationValueAt(depth, moment)), nearest);
  }, Infinity);
}

/**
 * The camera's own move and the drawables `follow` gives, judged over `frames` of `camera`'s span: a speed jump at a
 * key unless a key snaps there, a move faster than nothing blurs (a shut shutter, or a hold's steps), a visibility
 * popping within a frame; each kind once an owner, one line it can act on.
 */
export function paintMotionWarnings(camera: PaintCamera, frames: readonly PaintSpanFrame[], follow: (samples: PaintMotionSamples) => readonly PaintMotionFollowed[]): PaintMotionWarning[] {
  const { span } = camera, { width, height } = camera.stage.frame, step = SPEED_STEP / span.fps;
  // Three samples a frame: before, at and after it, each reading the frame's drawing. One outside the span reads
  // nothing the picture shows: a move under way at its cut isn't a jump.
  const moments = frames.flatMap(({ t }) => [paintMoment(t - step, t), paintMoment(t), paintMoment(t + step, t)]);
  const hasBefore = frames.map(({ t }) => t - step >= span.from - 1e-9), hasAfter = frames.map(({ t }) => t + step < span.to - 1e-9);
  const poses: PaintCameraPose[] = [];
  const cameraAt = (sample: number) => (poses[sample] ??= paintCameraPoseAt(camera, moments[sample]));
  const nearest = nearestDepth(camera, moments), centre = paintStageCentre(camera.stage);
  const cameraMoves = (from: number, to: number) => paintCameraMovesBetween(camera, moments[from], moments[to]);
  const cameraFollowed: PaintMotionFollowed = {
    name: 'camera', depthAt: () => nearest, box: 'everywhere', visibilityAt: () => 1,
    placeAt: (sample) => paintPlaneSimilarity(cameraAt(sample), nearest, centre),
    snapsBetween: (from, to) => cameraMoves(from, to).snapped,
  };
  const warnings: PaintMotionWarning[] = [], warn = (name: string, message: string) => warnings.push({ name, message });
  const shut = paintCameraShutterShut(camera.lens), limit = (width * SHUT_WIDTHS_A_SECOND) / span.fps;
  const judged: PaintMotionJudged[] = [cameraFollowed, ...follow({ moments, cameraAt })].map((drawable) => {
    const placed: PaintSimilarity[] = [], at = (sample: number) => (placed[sample] ??= drawable.placeAt(sample, sample));
    const shown = frames.map((_, k) => shownPart(drawable.box, at(3 * k + 1), width, height));
    return { drawable, at, shown, visibility: frames.map((_, k) => drawable.visibilityAt(moments[3 * k + 1])) };
  });
  for (const one of judged) {
    const { drawable, at: seen, shown, visibility } = one;
    const isCamera = drawable === cameraFollowed, atDepth = isCamera ? ` at depth ${Number(nearest.toFixed(2))}` : '';
    // Where it lies at each sample with what carries it held as at frame k: the motion it adds about frame k.
    const ownAbout = (k: number) => {
      const placed: PaintSimilarity[] = [];
      return (sample: number) => (placed[sample] ??= drawable.placeAt(sample, 3 * k + 1));
    };
    // Document point p, laid by `at`, about frame k: its velocity just before and just after (px a frame), and its
    // acceleration (px a frame²), each null where its sample lies outside the span.
    const motionAt = (at: (sample: number) => PaintSimilarity, k: number, p: StampPoint) => {
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
    const jumpAt = (at: (sample: number) => PaintSimilarity, k: number, p: StampPoint) => {
      const from = motionAt(at, k, p).before, to = motionAt(at, k + 1, p).after;
      if (!from || !to) return null;
      const around = [k - 1, k + 2].flatMap((j) => (j >= 0 && j < frames.length ? [motionAt(at, j, p).acceleration] : [])).filter((each) => each !== null);
      const carried = accelerationsCarried(around);
      const residual = Math.min(...carried.map((a) => Math.hypot(to.x - from.x - a.x * (1 + SPEED_STEP), to.y - from.y - a.y * (1 + SPEED_STEP))));
      return { residual, from: Math.hypot(from.x, from.y), to: Math.hypot(to.x, to.y) };
    };
    /** How fast p moves within frames k and k + 1, the most just after k and just before k + 1, px a frame; unknown, infinite. */
    const withinAt = (at: (sample: number) => PaintSimilarity, k: number, p: StampPoint) => {
      const read = [motionAt(at, k, p).after, motionAt(at, k + 1, p).before].filter((v) => v !== null);
      return read.length ? Math.max(...read.map((v) => Math.hypot(v.x, v.y))) : Infinity;
    };
    const jumps: number[] = [], jumpPoints: StampPoint[] = [], strobes: number[] = [], heldSteps: number[] = [], stepBy: number[] = [], pops: number[] = [];
    for (let k = 0; k + 1 < frames.length; k++) {
      const own = ownAbout(k), points = visibility[k] > 0 ? shown[k] : [];
      let worst = 0, worstPoint: StampPoint | null = null, added = 0, carried = 0, onScreen = 0, within = 0;
      for (const p of points) {
        const jump = jumpAt(own, k, p);
        if (jump && jump.residual >= JUMP_PX && jump.residual >= JUMP_SHARE * Math.max(jump.from, jump.to) && jump.residual > worst) [worst, worstPoint] = [jump.residual, p];
        const ownStep = frameStepOf(own, k, p), screenStep = frameStepOf(seen, k, p);
        added = Math.max(added, Math.hypot(ownStep.x, ownStep.y));
        onScreen = Math.max(onScreen, Math.hypot(screenStep.x, screenStep.y));
        carried = Math.max(carried, Math.hypot(screenStep.x - ownStep.x, screenStep.y - ownStep.y));
        within = Math.max(within, withinAt(own, k, p));
      }
      if (worstPoint && !drawable.snapsBetween(3 * k, 3 * k + 5)) {
        jumps.push(k);
        jumpPoints[k] = worstPoint;
      }
      // A hold's own step is held through the shutter, so no shutter blurs it. With the shutter shut, what the frame
      // shows strobes, and is this drawable's to slow where it adds past the pace itself or what carries it doesn't.
      const held = within < HELD_SHARE * added;
      stepBy[k] = held ? added : onScreen;
      if (held && added > limit) heldSteps.push(k);
      if (!held && shut && onScreen > limit && (added > limit || carried <= limit)) strobes.push(k);
      const inFrame = shown[k].length > 0 || shown[k + 1].length > 0;
      if (inFrame && Math.abs(visibilityStep(one, k)) >= POP_STEP && !swappedAt(judged, one, k)) pops.push(k);
    }
    // Each kind warns once: its first jump or pop, or its fastest run, by its numbers; the others by when.
    // A jump on a frame shows in the pairs either side of it; between two frames, in theirs alone.
    const jumpRuns = runsOf(jumps);
    if (jumpRuns.length) {
      const [{ first, last }, ...others] = jumpRuns, p = jumpPoints[first];
      const from = jumpAt(ownAbout(first), first, p)!.from, to = jumpAt(ownAbout(last), last, p)!.to;
      const when = last === first + 1 ? `at ${paintSecondsText(frames[last].t)}` : `between ${paintSecondsText(frames[first].t)} and ${paintSecondsText(frames[last + 1].t)}`;
      const plays = isCamera ? cameraMoves(3 * first, 3 * last + 5).origins : [], by = plays.length ? ` (${plays.join(', ')})` : '';
      const also = othersText(others.map((run) => frames[Math.round((run.first + run.last + 1) / 2)].t));
      warn(drawable.name, `its speed jumps ${when}${by}, from ${px(from)} to ${px(to)} px a frame${atDepth}${also}: meet the key at the speed it leaves at (a curve easing into it, or between: 'smooth'), or mark the key snap: true if the jump is meant`);
    }
    /** Of the runs `flagged` makes, the fastest, how far it steps, and when the others start. */
    const fastestRun = (flagged: readonly number[], runs: readonly { first: number; last: number }[]) => {
      const speeds = runs.map(({ first, last }) => Math.max(...flagged.filter((k) => k >= first && k <= last).map((k) => stepBy[k])));
      const i = speeds.indexOf(Math.max(...speeds)), { first, last } = runs[i];
      return { speed: speeds[i], when: runText(frames, first, last + 1), also: othersText(runs.filter((_, j) => j !== i).map((run) => frames[run.first].t)) };
    };
    const strobeRuns = runsOf(strobes);
    if (strobeRuns.length) {
      const { speed, when, also } = fastestRun(strobes, strobeRuns);
      warn(drawable.name, `moves up to ${px(speed)} px a frame${atDepth} with the shutter shut, ${when}${also}; past ${px(limit)} px a frame it strobes: slow it, or open the shutter`);
    }
    // A hold's steps come a frame or more apart.
    const heldRuns = runsOf(heldSteps, (from, to) => to - from <= HOLD_GAP);
    if (heldRuns.length) {
      const { speed, when, also } = fastestRun(heldSteps, heldRuns);
      warn(drawable.name, `steps up to ${px(speed)} px${atDepth} at a time as its hold steps, ${when}${also}; a held drawing holds through the shutter, so a step past ${px(limit)} px strobes: hold it on ones, or slow it`);
    }
    if (pops.length) {
      const [k, ...others] = pops;
      warn(drawable.name, `its visibility steps from ${px(visibility[k])} to ${px(visibility[k + 1])} within a frame at ${paintSecondsText(frames[k + 1].t)}${othersText(others.map((j) => frames[j + 1].t))}: it pops in or out; fade it over a few frames`);
    }
  }
  return warnings;
}
