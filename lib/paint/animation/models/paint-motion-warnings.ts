// paint-motion-warnings.ts: motion judged frame by frame over a camera's span for what tends to read badly, warnings
// beside a picture that draws, never refusals. What's followed is the caller's: each drawable as a similarity,
// document px to frame px, at every frame and a quarter frame either side (a shot's planes and occurrences,
// shot-motion-warnings.ts; a StampPainting's planes and moving groups, paint-painting-motion-warnings.ts).
// docs/painting-authoring.md says what each warning means.

import { paintCameraPoseAt, paintCameraShutterShut, type PaintCamera, type PaintCameraPose } from './paint-camera.ts';
import { paintSimilarityApply, paintSimilarityInverse, type PaintSimilarity } from './paint-similarity.ts';
import { paintSecondsText, type PaintSpanFrame } from './paint-span-moments.ts';
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
 * A pop: visibility changing by at least this much between two frames while in frame, unless it's a swap: a drawable on
 * the same plane, where it shows, stepping as far the other way then (a cel or a view switched by visibility).
 */
const POP_STEP = 0.9;

/**
 * A drawable followed: its name and plane, its box (document px), how it lies at a moment (`sample` naming it for a
 * memo), and how visible it is then; `moves` false for one moved only as its plane is, whose motion its plane's
 * warnings say.
 */
export type PaintMotionFollowed = {
  readonly name: string;
  readonly plane: string;
  readonly moves: boolean;
  readonly box: StampBox;
  readonly placeAt: (moment: PaintMoment, sample: number) => PaintSimilarity;
  readonly visibilityAt: (moment: PaintMoment) => number;
};

/** A warning about drawable `name`'s motion. */
export type PaintMotionWarning = { readonly name: string; readonly message: string };

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

/** A drawable judged over the frames: where it lies at each sample, what of it each frame shows, how visible it is. */
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

/** Whether `one`'s step at frame k is a swap (POP_STEP): another of `all` on its plane steps as far the other way where it shows. */
function swappedAt(all: readonly PaintMotionJudged[], one: PaintMotionJudged, k: number): boolean {
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
 * The drawables `follow` gives (handed the camera's pose at each sample), judged over `frames` of `camera`'s span: a
 * speed jump at a key, a move faster than nothing blurs (a shut shutter, or a hold's steps), a visibility popping
 * within a frame; each run of frames once.
 */
export function paintMotionWarnings(
  camera: PaintCamera, frames: readonly PaintSpanFrame[], follow: (cameraAt: (sample: number) => PaintCameraPose) => readonly PaintMotionFollowed[],
): PaintMotionWarning[] {
  const { span } = camera, { width, height } = camera.stage.frame, step = SPEED_STEP / span.fps;
  // Three samples a frame: before, at and after it, each reading the frame's drawing. One outside the span reads
  // nothing the picture shows: a move under way at its cut isn't a jump.
  const samples = frames.flatMap(({ t }) => [paintMoment(t - step, t), paintMoment(t), paintMoment(t + step, t)]);
  const hasBefore = frames.map(({ t }) => t - step >= span.from - 1e-9), hasAfter = frames.map(({ t }) => t + step < span.to - 1e-9);
  const poses: PaintCameraPose[] = [];
  const cameraAt = (sample: number) => (poses[sample] ??= paintCameraPoseAt(camera, samples[sample]));
  const warnings: PaintMotionWarning[] = [], warn = (name: string, message: string) => warnings.push({ name, message });
  const shut = paintCameraShutterShut(camera.lens), limit = (width * SHUT_WIDTHS_A_SECOND) / span.fps;
  const judged: PaintMotionJudged[] = follow(cameraAt).map((drawable) => {
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
    /** How fast p moves within frames k and k + 1, the most just after k and just before k + 1, px a frame; unknown, infinite. */
    const withinAt = (k: number, p: StampPoint) => {
      const read = [motionAt(k, p).after, motionAt(k + 1, p).before].filter((v) => v !== null);
      return read.length ? Math.max(...read.map((v) => Math.hypot(v.x, v.y))) : Infinity;
    };
    const jumps: number[] = [], fast: number[] = [], pops: number[] = [], movedBy: number[] = [], heldBy: boolean[] = [];
    let jumpPoint: StampPoint | null = null;
    for (let k = 0; k + 1 < frames.length; k++) {
      const points = drawable.moves && visibility[k] > 0 ? shown[k] : [];
      let worst = 0, worstPoint: StampPoint | null = null, moved = 0, within = 0;
      for (const p of points) {
        const jump = jumpAt(k, p);
        if (jump && jump.residual >= JUMP_PX && jump.residual >= JUMP_SHARE * Math.max(jump.from, jump.to) && jump.residual > worst) [worst, worstPoint] = [jump.residual, p];
        moved = Math.max(moved, distance(paintSimilarityApply(at(3 * k + 4), p), paintSimilarityApply(at(3 * k + 1), p)));
        within = Math.max(within, withinAt(k, p));
      }
      if (worstPoint) {
        jumps.push(k);
        jumpPoint ??= worstPoint;
      }
      movedBy[k] = moved;
      heldBy[k] = within < HELD_SHARE * moved;
      // A hold's step is held through the shutter, so an open one doesn't blur it either.
      if ((shut || heldBy[k]) && moved > limit) fast.push(k);
      const inFrame = shown[k].length > 0 || shown[k + 1].length > 0;
      if (inFrame && Math.abs(visibilityStep(one, k)) >= POP_STEP && !swappedAt(judged, one, k)) pops.push(k);
    }
    // A jump on a frame shows in the pairs either side of it; between two frames, in theirs alone.
    for (const { first, last } of runsOf(jumps)) {
      const p = jumpPoint!, from = jumpAt(first, p)!.from, to = jumpAt(last, p)!.to;
      const when = last === first + 1 ? `at ${paintSecondsText(frames[last].t)}` : `between ${paintSecondsText(frames[first].t)} and ${paintSecondsText(frames[last + 1].t)}`;
      warn(drawable.name, `its speed jumps ${when}, from ${px(from)} to ${px(to)} px a frame: meet the key at the speed it leaves at (a curve easing into it, or between: 'smooth')`);
    }
    // A hold's steps come a frame or more apart, each run of them one warning.
    for (const { first, last } of runsOf(fast, (from, to) => heldBy[from] && heldBy[to] && to - from <= HOLD_GAP)) {
      const run = movedBy.slice(first, last + 1), fastest = Math.max(...run), when = runText(frames, first, last + 1);
      warn(drawable.name, heldBy[first + run.indexOf(fastest)]
        ? `steps up to ${px(fastest)} px at a time as its hold steps, ${when}; a held drawing holds through the shutter, so a step past ${px(limit)} px strobes: hold it on ones, or slow it`
        : `moves up to ${px(fastest)} px a frame with the shutter shut, ${when}; past ${px(limit)} px a frame it strobes: slow it, or open the shutter`);
    }
    if (pops.length) {
      const k = pops[0], more = pops.length > 1 ? ` (and ${pops.length - 1} more time${pops.length > 2 ? 's' : ''})` : '';
      warn(drawable.name, `its visibility steps from ${px(visibility[k])} to ${px(visibility[k + 1])} within a frame at ${paintSecondsText(frames[k + 1].t)}${more}: it pops in or out`);
    }
  }
  return warnings;
}
