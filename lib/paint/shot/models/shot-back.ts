// shot-back.ts: the opaque back (ENGINE 5.4, 6.1). Its ground lays paper over the stage, but its paint stops at its
// document, past which lies bare paper that a defocus or a move reads into the frame's edge as a pale fringe. So its
// painting must hold all the frame reads of it: refused short, never clamped, the fix put in its lay's terms. Checked
// once the lay is known: a still lay as the shot compiles, a cover as it's laid, a pin as it's measured
// (shotBarePaperProblem), a callback's at each frame's moment and shutter ends (shotBackFrameProblem).
//
// Negative space: a callback's lay between those moments isn't read.

import { paintCameraFrameReads, paintCameraShotReads, type PaintCameraPlaneRead } from '#lib/paint/animation/models/paint-camera-build.ts';
import { paintLevelBendShift, paintLevelPlacedHeld } from '#lib/paint/animation/models/paint-motion-reach.ts';
import {
  paintPlacementOfSimilarity, paintSimilarityAfter, paintSimilarityBox, paintSimilarityInverse, paintSimilarityOf, paintSimilarityScale, type PaintSimilarity,
} from '#lib/paint/animation/models/paint-similarity.ts';
import type { PaintMoment, StampGroupLay } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampGroupPlacement } from '#lib/paint/painting/models/stamp-group-motion.ts';
import { stampBoxGrown, type StampBox, type StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { CompiledPaintedShot, CompiledShotPaintedPlane } from './shot-compile.ts';
import { shotLaySimilarity, shotPlaneLayAt, shotPlaneMomentAt } from './shot-frame-plan.ts';
import type { CompiledShotMotion } from './shot-motion.ts';
import { shotNodeShift } from './shot-reach.ts';

/** What the back is checked through: its shot's built camera and motion. */
export type ShotBackSetting = Pick<CompiledPaintedShot, 'camera' | 'motion'>;

/**
 * How the back is laid, which is how its fix is worded: a lay as written (null: none), a cover of `box` (`relaid`
 * covering another box the same way), or a pin of document points `sources`; each with the lay it comes to.
 */
export type ShotBackLaying =
  | { readonly kind: 'lay'; readonly lay: StampGroupLay | null }
  | { readonly kind: 'cover'; readonly lay: StampGroupLay; readonly box: StampBox; readonly relaid: (box: StampBox) => StampGroupLay }
  | { readonly kind: 'pin'; readonly lay: StampGroupLay; readonly sources: readonly StampPoint[] };

/** `plane`'s document, document px, `grow` px larger on every side. */
const documentOf = ({ paints }: CompiledShotPaintedPlane, grow = 0): StampBox => ({ x0: -grow, y0: -grow, x1: paints.widthPx + grow, y1: paints.heightPx + grow });

/**
 * The document px the back's ground must cover at `at`: the stage (plane px, its margin round the frame) taken back
 * through its lay then, grown by the most its node moves a point and a pixel.
 */
export function shotBackGroundBox({ frame, margin }: Pick<StampStage, 'frame' | 'margin'>, plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, at: PaintMoment): StampBox {
  const node = motion.nodes.get(plane.id), stageBox = { x0: -margin, y0: -margin, x1: frame.width + margin, y1: frame.height + margin };
  return stampBoxGrown(paintSimilarityBox(paintSimilarityInverse(shotPlaneLayAt(plane, motion, at)), stageBox), (node ? shotNodeShift(node, documentOf(plane)) : 0) + 1);
}

/**
 * What of `painted` (document px) the back's paint covers all shot long: shrunk by the most its node's bend and boil
 * move a point, then laid by every placement the node plays; null where nothing is covered throughout.
 */
function backHeld(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, painted: StampBox): StampBox | null {
  const node = motion.nodes.get(plane.id);
  if (!node) return painted;
  const bent = stampBoxGrown(painted, -(paintLevelBendShift(node, painted, true) + (node.marks.kind === 'wobble' ? node.marks.wobble.amount : 0)));
  return bent.x0 < bent.x1 && bent.y0 < bent.y1 ? paintLevelPlacedHeld(node, bent) : null;
}

/** Below this many document px short, a shortfall is the float arithmetic's, not the painting's. */
const BACK_SLACK = 1e-6;

/** How far `read` lies past `held` on its worst side, px: 0 or less inside it; everywhere past nothing. */
const excess = (read: StampBox, held: StampBox | null) => (held ? Math.max(held.x0 - read.x0, read.x1 - held.x1, held.y0 - read.y0, read.y1 - held.y1) : Infinity);

const unionOf = (boxes: readonly StampBox[]): StampBox => ({
  x0: Math.min(...boxes.map((box) => box.x0)), y0: Math.min(...boxes.map((box) => box.y0)), x1: Math.max(...boxes.map((box) => box.x1)), y1: Math.max(...boxes.map((box) => box.y1)),
});

/** `reads` taken back through `lay` to document px: what the frame shows (`seen`), what its blur reads, and how far that is. */
function readsThrough(reads: readonly PaintCameraPlaneRead[], lay: PaintSimilarity) {
  const toDocument = paintSimilarityInverse(lay);
  return reads.map(({ when, seen, reach }) => ({
    when, seen: paintSimilarityBox(toDocument, seen), read: paintSimilarityBox(toDocument, stampBoxGrown(seen, reach)), blur: reach / paintSimilarityScale(lay),
  }));
}

/** The least whole n from `from` up to `most` that `passes`, which holds for every n past one that does; null for none. */
function leastPassing(from: number, most: number, passes: (n: number) => boolean): number | null {
  let fails = from - 1, holds = from;
  while (holds < most && !passes(holds)) [fails, holds] = [holds, Math.min(most, holds * 2)];
  if (holds > most || !passes(holds)) return null;
  while (holds - fails > 1) {
    const mid = Math.floor((fails + holds) / 2);
    if (passes(mid)) holds = mid;
    else fails = mid;
  }
  return holds;
}

/** The least scale about `pivot` (inside `held`) bringing `read` within `held`. */
const scaleToHold = (read: StampBox, held: StampBox, { x, y }: StampPoint) =>
  Math.max((x - read.x0) / (x - held.x0), (read.x1 - x) / (held.x1 - x), (y - read.y0) / (y - held.y0), (read.y1 - y) / (held.y1 - y));

const strictlyInside = ({ x, y }: StampPoint, { x0, y0, x1, y1 }: StampBox) => x > x0 && x < x1 && y > y0 && y < y1;

/** `scale` as a percentage larger, rounded up to a tenth so the lay it names holds. */
const percentLarger = (scale: number) => Math.ceil((scale - 1) * 1000 - BACK_SLACK) / 10;

const num = (value: number) => String(Number(value.toFixed(3)));
const pointText = ({ x, y }: StampPoint) => `${num(x)}, ${num(y)}`;
const layText = ({ x, y, rotation, scale }: StampGroupPlacement, pivot: StampPoint) =>
  `{ placement: { x: ${num(x)}, y: ${num(y)}, rotation: ${num(rotation)}, scale: ${num(scale)} }, pivot: { x: ${num(pivot.x)}, y: ${num(pivot.y)} } }`;

/** The scale `by` about `pivot`, as a similarity. */
const scaledAbout = (pivot: StampPoint, by: number): PaintSimilarity => paintSimilarityOf({ x: 0, y: 0, rotation: 0, scale: by }, pivot);

/**
 * The ways to make the back laid by `lay` as `laying` says hold `read` (document px, all the frame reads of it): lay
 * it larger, cover less of it, pin its points nearer, or paint more of it (`more` px each side, null: none holds).
 */
function backFixes(laying: ShotBackLaying, lay: PaintSimilarity, read: StampBox, held: StampBox, more: number | null, reads: readonly PaintCameraPlaneRead[]): string[] {
  if (laying.kind === 'cover') {
    const { box, relaid } = laying, most = Math.floor(Math.min(box.x1 - box.x0, box.y1 - box.y0) / 2 - BACK_SLACK);
    const covering = (n: number) => unionOf(readsThrough(reads, shotLaySimilarity(relaid(stampBoxGrown(box, -n)))).map((each) => each.read));
    const less = leastPassing(Math.max(1, Math.ceil(excess(read, held) - BACK_SLACK)), most, (n) => excess(covering(n), held) <= BACK_SLACK);
    const smaller = less === null ? null : stampBoxGrown(box, -less);
    return [
      ...(smaller ? [`cover a box ${less} px smaller on every side (box: { x0: ${num(smaller.x0)}, y0: ${num(smaller.y0)}, x1: ${num(smaller.x1)}, y1: ${num(smaller.y1)} })`] : []),
      ...(more === null ? [] : [`paint ${more} px more past its box on every side (the box then ${more} px further right and down, with its paint)`]),
    ];
  }
  if (laying.kind === 'pin') {
    const [a, b] = laying.sources, fixes: string[] = [], middle = b && { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Two points brought nearer about their midpoint lay the plane larger about it, as many times as they came nearer.
    if (b && middle && strictlyInside(middle, held)) {
      const larger = percentLarger(scaleToHold(read, held, middle)), by = 1 + larger / 100;
      const nearer = ({ x, y }: StampPoint) => pointText({ x: middle.x + (x - middle.x) / by, y: middle.y + (y - middle.y) / by });
      fixes.push(`pin its sourcePx nearer each other about their midpoint, at ${nearer(a)} and ${nearer(b)}, laying it ${larger.toFixed(1)}% larger`);
    }
    if (more !== null) fixes.push(`paint ${more} px more on every side (its sourcePx then ${more} px further right and down, with its paint)`);
    return fixes;
  }
  // About its own pivot reads simplest, its scale alone changing; about the painting's centre wherever that takes less.
  const written = laying.lay, centre = { x: (held.x0 + held.x1) / 2, y: (held.y0 + held.y1) / 2 }, atCentre = percentLarger(scaleToHold(read, held, centre));
  const own = written && strictlyInside(written.pivot, held) ? percentLarger(scaleToHold(read, held, written.pivot)) : Infinity;
  const about = written && own <= atCentre ? written.pivot : centre, larger = Math.min(own, atCentre), by = 1 + larger / 100;
  const scaled = written && about === written.pivot
    ? `lay it ${larger.toFixed(1)}% larger about its pivot (placement scale ${num(written.placement.scale)} → ${num(Math.ceil(written.placement.scale * by * 1000 - BACK_SLACK) / 1000)})`
    : `lay it ${larger.toFixed(1)}% larger about its centre: ${layText(paintPlacementOfSimilarity(paintSimilarityAfter(lay, scaledAbout(about, by)), about), about)}`;
  if (more === null) return [scaled];
  // Painting more on the top and left moves every document px of it, its pivot among them, `more` right and down.
  const painted = written
    ? `paint ${more} px more on every side and lay it ${more} px further up and left (placement x: ${num(written.placement.x - more)}, y: ${num(written.placement.y - more)}, its pivot moving with its paint)`
    : `paint ${more} px more on every side and lay it ${more} px up and left: ${layText({ x: -more, y: -more, rotation: 0, scale: 1 }, { x: 0, y: 0 })}`;
  return [scaled, painted];
}

/**
 * Why the back, laid by `lay` as `laying` says, can't hold all `reads` read of it, or null: the worst read's
 * shortfall, refused, and how to mend it. `moment`: the reads are one moment's, its lay a callback's then.
 */
function backProblem(plane: CompiledShotPaintedPlane, motion: CompiledShotMotion, reads: readonly PaintCameraPlaneRead[], lay: PaintSimilarity, laying: ShotBackLaying, moment: boolean): string | null {
  const painted = documentOf(plane), held = backHeld(plane, motion, painted), through = readsThrough(reads, lay);
  const worst = through.reduce((most, each) => (excess(each.read, held) > excess(most.read, held) ? each : most)), short = excess(worst.read, held);
  if (short <= BACK_SLACK) return null;
  if (!held) return 'is the back, and its node moves its paint further than its painting is wide, so none of it stays painted all shot long: move it less';
  const read = unionOf(through.map((each) => each.read));
  const more = leastPassing(Math.max(1, Math.ceil(short - BACK_SLACK)), 1 << 20, (n) => excess(read, backHeld(plane, motion, documentOf(plane, n))) <= BACK_SLACK);
  const past = Math.min(worst.seen.x0 - held.x0, held.x1 - worst.seen.x1, worst.seen.y0 - held.y0, held.y1 - worst.seen.y1), moved = excess(painted, held);
  const reaches = past > -BACK_SLACK ? `${Math.floor(Math.max(0, past) + BACK_SLACK)} px past the frame` : `to ${Math.ceil(-past - BACK_SLACK)} px inside the frame`;
  const blurred = worst.blur > 0 ? `, its blur reading ${Math.ceil(worst.blur - BACK_SLACK)} px past the frame` : '';
  const node = moved > BACK_SLACK ? `, its node moving its edge up to ${Math.ceil(moved - BACK_SLACK)} px in` : '';
  const fixes = backFixes(laying, lay, read, held, more, reads).join(', or ') || 'paint it larger';
  return `is the back, painted ${reaches} (${worst.when})${blurred}${node}, and past its painting lies bare paper: ${moment ? 'at that moment, ' : ''}${fixes}`;
}

/**
 * Why `plane`, laid as `laying` says, can't hold all the camera reads of it over its shot, or null: null too unless
 * it's the opaque back. A still lay is checked as the shot compiles, a cover as it's laid, a pin as it's measured.
 */
export function shotBarePaperProblem({ camera, motion }: ShotBackSetting, plane: CompiledShotPaintedPlane, laying: ShotBackLaying): string | null {
  if (!plane.opaqueBack) return null;
  return backProblem(plane, motion, paintCameraShotReads(camera, plane.depth), shotLaySimilarity(laying.lay), laying, false);
}

/**
 * Why `plane`, laid by a callback, can't hold what the frame at `at` reads of it, at that moment and its shutter's
 * ends, each laid as the callback lays it then; or null: null too unless it's the opaque back laid so.
 */
export function shotBackFrameProblem(
  { camera, motion }: ShotBackSetting, plane: CompiledShotPaintedPlane, at: PaintMoment, shutter: { readonly open: PaintMoment; readonly close: PaintMoment } | null,
): string | null {
  if (!plane.opaqueBack || plane.lay.kind !== 'moving') return null;
  const moments = [at, ...(shutter ? [shutter.open, shutter.close] : [])], reads = paintCameraFrameReads(camera, plane.depth, at, moments);
  for (const [i, each] of moments.entries()) {
    const lay = plane.lay.lay(shotPlaneMomentAt(motion, plane.id, each)), problem = backProblem(plane, motion, [reads[i]], shotLaySimilarity(lay), { kind: 'lay', lay }, true);
    if (problem) return problem;
  }
  return null;
}
