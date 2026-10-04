// painting-reveal.ts: a document's reveals as a selection's lays read them (docs/painting-authoring.md, Time). A film
// is cut by its layer's reveal and every enclosing group's, multiplied. Each is read in its node's frame: a node posed
// on a sheet it doesn't own carries its reveal with its marks, while one at or above the sheet's owner moves the
// finished sheet, so its reveal is read where the sheet was painted. And how wide a strokes reveal's band must be to
// show all an application lays.

import { PAINT_SIMILARITY_IDENTITY, paintSimilarityInverse, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampRevealSampleAt, type StampRevealLink } from '#lib/paint/painting/models/stamp-reveal.ts';
import { STAMP_FLAT_TIP_FLOOR } from '#lib/paint/painting/models/stamp-tip-support.ts';
import { stampWetDepositReach } from '#lib/paint/painting/models/stamp-wet-reach.ts';
import { paintingCappedMedium, type PaintingSelectionCompiled } from './painting-document-compile.ts';
import type { AnyApplication, MediumName, NodeKey, Reveal } from './painting-document.ts';
import { paintingLargestDiameter, paintingNodeBox } from './painting-footprint.ts';
import { paintingFitSimilarity, paintingPoseAfter, paintingPoseMap, paintingSimilarityPose, type PaintingNodePose, type PaintingPoses } from './painting-pose.ts';
import type { PaintingTree } from './painting-tree.ts';

/**
 * A reveal cutting a film: its node's, and the nodes posing the film's marks from below its sheet's owner down to
 * that node, outermost first (none for a node moving the finished sheet, or the sheet's owner).
 */
export type PaintingFilmReveal = { readonly node: NodeKey; readonly reveal: Reveal; readonly posedBy: readonly NodeKey[] };

/** Each film's reveals, by sheet and film, outermost first. */
export type PaintingFilmReveals = readonly (readonly (readonly PaintingFilmReveal[])[])[];

const filmReveals = new WeakMap<PaintingSelectionCompiled, PaintingFilmReveals>();

/** The reveals cutting each film `compiled` lays, by sheet and film: its layer's line's, outermost first; none for a film none cuts. */
export function paintingFilmReveals(compiled: PaintingSelectionCompiled): PaintingFilmReveals {
  const known = filmReveals.get(compiled);
  if (known) return known;
  const { tree } = compiled;
  const made = compiled.sheets.map(({ sheet, layers }) => layers.map((layer) => {
    const { groups, node } = tree.layers[layer], line = [...groups, node.key], below = sheet.owner === null ? 0 : line.indexOf(sheet.owner) + 1;
    return line.flatMap((key, i): PaintingFilmReveal[] => {
      const { reveal } = tree.byKey.get(key)!.node;
      return reveal ? [{ node: key, reveal, posedBy: i >= below ? line.slice(below, i + 1) : [] }] : [];
    });
  }));
  filmReveals.set(compiled, made);
  return made;
}

/** Whether any film `compiled` lays is cut by a reveal. */
export const paintingSelectionReveals = (compiled: PaintingSelectionCompiled) => paintingFilmReveals(compiled).some((sheet) => sheet.some((film) => film.length > 0));

const REST = paintingSimilarityPose(PAINT_SIMILARITY_IDENTITY);
const wordsOf = ({ ma, mb, kx, ky }: PaintSimilarity) => [ma, mb, kx, ky] as const;

/** How many points a side a warp's stand-in similarity is fit over, across its node's box. */
const FIT_GRID = 5;

/**
 * The similarity standing for `pose` over `node`'s paint: itself, or under a warp the best fit over a grid across the
 * box of what the node lays (fields aren't warped: a posed deposit's way back to rest is a fit too).
 */
function paintingRevealPoseFit(tree: PaintingTree, node: NodeKey, pose: PaintingNodePose): PaintSimilarity {
  if (pose.kind === 'similarity') return pose.map;
  const box = paintingNodeBox(tree.byKey.get(node)!.node);
  if (!box) return PAINT_SIMILARITY_IDENTITY;
  const points = Array.from({ length: FIT_GRID * FIT_GRID }, (_, k) => ({
    x: box.x0 + ((box.x1 - box.x0) * (k % FIT_GRID)) / (FIT_GRID - 1), y: box.y0 + ((box.y1 - box.y0) * Math.floor(k / FIT_GRID)) / (FIT_GRID - 1),
  }));
  return paintingFitSimilarity(points, paintingPoseMap(pose));
}

/**
 * `reveals` (a film's, paintingFilmReveals') as a pass reads them at scene second `at` (Infinity: fully revealed), the
 * film's marks posed by `poses` as they were painted: each with the similarity taking a film point back to its node's
 * rest point, and the time it shows at (stampRevealSampleAt).
 */
export function paintingRevealLinks(tree: PaintingTree, reveals: readonly PaintingFilmReveal[], poses: PaintingPoses, at: number): StampRevealLink[] {
  return reveals.map(({ node, reveal, posedBy }) => {
    const pose = posedBy.reduce((outer, key) => paintingPoseAfter(outer, poses.get(key) ?? REST), REST);
    const toFilm = paintingRevealPoseFit(tree, node, pose), toRest = paintSimilarityInverse(toFilm);
    return { reveal, toRest: wordsOf(toRest), toFilm: wordsOf(toFilm), at: stampRevealSampleAt(reveal, Math.hypot(toRest.ma, toRest.mb), at) };
  });
}

/**
 * How wide a strokes reveal's band must be, px, to show all `application` lays round a path they share: its widest
 * diameter and wobble, a tip's floor each side, and when `wet` the furthest its water carries paint in its `medium`
 * (spread held to `maxSpreadPx`) or any of `sheetMedia`, the films it lands in.
 */
export function paintingRevealBandPx(application: AnyApplication, medium: MediumName, { wet = true, sheetMedia = [] }: { wet?: boolean; sheetMedia?: readonly MediumName[] } = {}): number {
  const diameter = paintingLargestDiameter(application, application.diameterPx), { charge } = application, own = PAINT_MEDIA[medium];
  const wobble = application.kind === 'stroke' ? application.hand?.wobble?.position ?? 0 : 0;
  const capped = charge.kind === 'paint' && charge.maxSpreadPx !== undefined ? paintingCappedMedium(own, charge.maxSpreadPx, application.diameterPx) : own;
  const water = charge.kind === 'lift' ? 0 : charge.water ?? own.wetting.defaultWater, carrier = { action: { kind: charge.kind }, diameter };
  const carried = wet ? Math.max(...[capped, ...sheetMedia.map((name) => PAINT_MEDIA[name])].map((each) => stampWetDepositReach(carrier, each, water))) : 0;
  return Math.ceil(diameter * (1 + 2 * wobble) + 2 * carried + 2 * STAMP_FLAT_TIP_FLOOR);
}
