// painting-reveal.ts: a document's reveals as a selection's lays read them (docs/painting-authoring.md, Time). A film
// is cut by its layer's reveal and every enclosing group's, multiplied. Each is read in its node's frame: a node posed
// on a sheet it doesn't own carries its reveal with its marks, while one at or above the sheet's owner moves the
// finished sheet, so its reveal is read where the sheet was painted. And for authors: when a reveal ends and when it
// reaches a point, an eased pull as reveal strokes, how wide a stroke reads, which sizes its band, and the band
// showing all it lays.

import { PAINT_SIMILARITY_IDENTITY, paintSimilarityInverse, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import { stampBrushMeasuredProfile, stampBrushVisibleWidth } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampPolylineDistance } from '#lib/paint/painting/models/stamp-area-boundaries.ts';
import { stampDepositWater } from '#lib/paint/painting/models/stamp-paint-action.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import {
  stampRevealArrivalSpan, stampRevealPathLength, stampRevealPointArrival, stampRevealSampleAt, type StampFilmRevealLinks, type StampReveal, type StampRevealCap,
} from '#lib/paint/painting/models/stamp-reveal.ts';
import { stampMarksReach } from '#lib/paint/painting/models/stamp-sheet-wrap.ts';
import { stampSheetWetReach } from '#lib/paint/painting/models/stamp-wet-reach.ts';
import { compilePaintingDeposit, type PaintingBrushOf } from './painting-deposit-compile.ts';
import { paintingCappedMedium, type PaintingSelectionCompiled } from './painting-document-compile.ts';
import type { AnyApplication, MediumName, NodeKey, Reveal, RevealStroke } from './painting-document.ts';
import { paintingNodeBox } from './painting-footprint.ts';
import { paintingPoseAfter, paintingPoseFitOver, paintingSimilarityPose, type PaintingPoses } from './painting-pose.ts';
import { paintingStampReveal } from './painting-reveal-profile.ts';

/**
 * A reveal cutting a film: its node's, and the nodes posing the film's marks from below its sheet's owner down to
 * that node, outermost first (none for a node moving the finished sheet, or the sheet's owner).
 */
type PaintingFilmReveal = { readonly node: NodeKey; readonly reveal: StampReveal; readonly posedBy: readonly NodeKey[] };

const filmReveals = new WeakMap<PaintingSelectionCompiled, readonly (readonly (readonly PaintingFilmReveal[])[])[]>();

/** The reveals cutting each film `compiled` lays, by sheet and film: its layer's line's, outermost first; none for a film none cuts. */
function paintingFilmReveals(compiled: PaintingSelectionCompiled) {
  const known = filmReveals.get(compiled);
  if (known) return known;
  const { tree } = compiled;
  const made = compiled.sheets.map(({ sheet, layers }) => layers.map((layer) => {
    const { groups, node } = tree.layers[layer], line = [...groups, node.key], below = sheet.owner === null ? 0 : line.indexOf(sheet.owner) + 1;
    return line.flatMap((key, i): PaintingFilmReveal[] => {
      const { reveal } = tree.byKey.get(key)!.node;
      return reveal ? [{ node: key, reveal: paintingStampReveal(reveal), posedBy: i >= below ? line.slice(below, i + 1) : [] }] : [];
    });
  }));
  filmReveals.set(compiled, made);
  return made;
}

const REST = paintingSimilarityPose(PAINT_SIMILARITY_IDENTITY);
const wordsOf = ({ ma, mb, kx, ky }: PaintSimilarity) => [ma, mb, kx, ky] as const;

/**
 * Each film `compiled` lays cut by its reveals at scene second `at` (Infinity, left out: fully revealed), by sheet:
 * each reveal with the similarity taking a film point back to its node's rest point (a warp's fit over the layer's
 * paint, as the shot's lattice fits it) under `poses`, and the time it shows at (stampRevealSampleAt).
 */
export function paintingRevealLinksOf(compiled: PaintingSelectionCompiled, poses: PaintingPoses, at = Infinity): StampFilmRevealLinks[] {
  const { tree } = compiled;
  return paintingFilmReveals(compiled).map((sheet, s) => sheet.map((film, f) => {
    const box = paintingNodeBox(tree.layers[compiled.sheets[s].layers[f]].node);
    return film.map(({ reveal, posedBy }) => {
      const pose = posedBy.reduce((outer, key) => paintingPoseAfter(outer, poses.get(key) ?? REST), REST);
      // A layer laying nothing has no film to cut: any similarity stands.
      const toFilm = box ? paintingPoseFitOver(pose, box).fit : PAINT_SIMILARITY_IDENTITY, toRest = paintSimilarityInverse(toFilm);
      return { reveal, toRest: wordsOf(toRest), toFilm: wordsOf(toFilm), at: stampRevealSampleAt(reveal, Math.hypot(toRest.ma, toRest.mb), at) };
    });
  }));
}

/**
 * The scene second `reveal` finishes, as the pass reads it: its last arrival plus its `softS`. A field's last arrival
 * is its base's latest plus its delay's, wherever each lies.
 */
export function paintingRevealEnd(reveal: Reveal): number {
  const stamp = paintingStampReveal(reveal);
  return stampRevealArrivalSpan(stamp).last + (stamp.softS ?? 0);
}

/**
 * The scene second `reveal`'s front reaches `point` (document px), as the pass reads it. Strokes: when the earliest
 * band covering the point first touches it; off every band, at its nearest path point. On a wrapped document a band's
 * copy across a seam isn't read: ask on the side its path runs.
 */
export const paintingRevealArrivalAt = (reveal: Reveal, point: StampPoint): number => stampRevealPointArrival(paintingStampReveal(reveal), point);

/** `points` from `s0` to `s1` px along them. */
function pathBetween(points: readonly StampPoint[], s0: number, s1: number): StampPoint[] {
  const out: StampPoint[] = [];
  let along = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], span = Math.hypot(b.x - a.x, b.y - a.y);
    const at = (s: number) => ({ x: a.x + ((b.x - a.x) * (s - along)) / span, y: a.y + ((b.y - a.y) * (s - along)) / span });
    if (span > 0 && along + span > s0 && along < s1) {
      if (out.length === 0) out.push(at(Math.max(s0, along)));
      out.push(at(Math.min(s1, along + span)));
    }
    along += span;
  }
  return out;
}

/** How an eased pull runs: its band, its scene seconds, where `ease` (0..1 to 0..1) puts its front, and how finely it's cut. */
export type PaintingEasedReveal = {
  readonly widthPx: number;
  readonly from: number;
  readonly to: number;
  readonly ease: (u: number) => number;
  /** Pieces a second (30): one a frame at 30 fps puts the front where the ease does every frame. */
  readonly piecesPerSecond?: number;
  readonly cap?: StampRevealCap;
};

/** Pieces shorter than this, px, are dropped: an ease that barely moves the front there adds nothing. */
const EASED_PIECE_LEAST_PX = 0.5;

/**
 * `points` revealed by a band pulled from `from` to `to` with its front where `ease` puts it: a reveal stroke's front
 * runs at constant speed, so the path is cut into pieces, each at its stretch's pace. `cap` applies to the pull's two
 * ends; the joins between pieces are round, so they close up.
 */
export function paintingEasedRevealStrokes(points: readonly StampPoint[], { widthPx, from, to, ease, piecesPerSecond = 30, cap }: PaintingEasedReveal): RevealStroke[] {
  const length = stampRevealPathLength(points), over = to - from, pieces = Math.max(1, Math.ceil(over * piecesPerSecond));
  const strokes = Array.from({ length: pieces }, (_, k): RevealStroke => ({
    points: pathBetween(points, length * ease(k / pieces), length * ease((k + 1) / pieces)), widthPx, from: from + (over * k) / pieces, to: from + (over * (k + 1)) / pieces,
  })).filter((piece) => stampRevealPathLength(piece.points) >= EASED_PIECE_LEAST_PX);
  // Only the pull's ends square: where pieces join at a bend, round ends close the wedge square ones would leave open.
  if (cap === 'flat' && strokes.length > 0) {
    strokes[0] = { ...strokes[0], cap };
    strokes[strokes.length - 1] = { ...strokes[strokes.length - 1], cap };
  }
  return strokes;
}

/** How a band is sized: the brushes `application` names, whether its wash is wet, and the media of the films its water lands in. */
export type PaintingRevealBandSetting = { readonly brushOf: PaintingBrushOf; readonly wet?: boolean; readonly sheetMedia?: readonly MediumName[] };

/**
 * The band, px, a strokes reveal needs to show all stroke `application` lays round its subpaths: its compiled stamps'
 * farthest reach and, when `wet` (true, left out), as far as its water carries paint in `medium` or any of
 * `sheetMedia`. An upper bound, mostly faint stamps and water nobody sees: needed only where carried paint shows.
 */
export function paintingRevealBandPx(
  application: AnyApplication & { readonly kind: 'stroke' }, medium: MediumName, { brushOf, wet = true, sheetMedia = [] }: PaintingRevealBandSetting,
): number {
  const { deposit } = compilePaintingDeposit(application, application.key ?? 'band', { id: 'band', wet, brushOf });
  let farthest = 0;
  for (const marks of [deposit.stamps, deposit.dualStamps]) {
    for (const { x, y } of marks) farthest = Math.max(farthest, Math.min(...application.subpaths.map((path) => stampPolylineDistance(path, x, y))));
  }
  const { charge } = application, own = PAINT_MEDIA[medium];
  const capped = charge.kind === 'paint' && charge.maxSpreadPx !== undefined ? paintingCappedMedium(own, charge.maxSpreadPx, application.diameterPx) : own;
  const carried = wet ? stampSheetWetReach(sheetMedia.map((name) => PAINT_MEDIA[name]), deposit, capped, stampDepositWater(deposit, capped)) : 0;
  return Math.ceil(2 * (farthest + stampMarksReach(deposit) + carried));
}

/**
 * How wide stroke `application` reads, px, which sizes a strokes reveal's band: its brush's visible width (as `studio
 * brushes describe` prints it) at `diameterPx` times its points' largest `scale`, plus its hand's wobble either side.
 * Refuses a brush without a measured profile. A painting source can't resolve a brush, so a test holds its bands to
 * this.
 */
export function paintingStrokeVisibleWidthPx(application: AnyApplication & { readonly kind: 'stroke' }, brushOf: PaintingBrushOf): number {
  const brush = brushOf(application.brush);
  let scale = 0;
  for (const path of application.subpaths) for (const point of path) scale = Math.max(scale, point.scale ?? 1);
  const wobble = 2 * (application.hand?.wobble?.position ?? 0) * application.diameterPx;
  return stampBrushVisibleWidth(stampBrushMeasuredProfile(brush), application.diameterPx * scale, brush.name) + wobble;
}
