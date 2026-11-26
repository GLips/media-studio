// shot-images.ts: a shot's images as their keys and reads name them. An image is a painted plane's sharp picture at
// one moment, before the lens places it, or an effect's output. It reads other pictures (an alphaOf mask reads a
// drawable's coverage, an effect each of its inputs' pictures), and
// its key names what it read and through what map, so a picture is kept under all that made its pixels. Evaluation
// needs no order: asking for an image asks first for what it reads. The shot's load refuses a chain of reads back to
// its own plane (shotMaskCheck), so asking always ends.

import { textSha256Hex } from '#lib/platform/hash/models/sha256.ts';
import type { PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { CompiledShotPlane } from './shot-compile.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import { shotPlacedReads } from './shot-effect.ts';
import { shotOccurrencePlane } from './shot-occurrences.ts';

/**
 * One of an image's reads: its name (the drawable a mask names, or an effect's `read <i>`), and a key naming the pixels
 * read there as its reader reads them.
 */
export type ShotImageReadKey = { readonly name: string; readonly key: string };

/** An image's keys: each selection's picture's, and the image's own, its selections summed. */
export type ShotImageKeys = { readonly shares: readonly string[]; readonly image: string };

/**
 * An image's keys from its selections' (each its plan's key and weight; one, unless it dissolves) and its `reads`'.
 * A selection's picture is kept under its plan's key and what it read. The image's key adds a dissolve's weights, a
 * selection's never: moving weights lays nothing anew.
 */
export function shotImageKeys(shares: readonly { readonly key: string; readonly weight: number }[], reads: readonly ShotImageReadKey[]): ShotImageKeys {
  const read = reads.map(({ name, key }) => [name, key]), [lone] = shares;
  const keys = shares.map(({ key }) => (read.length ? JSON.stringify([key, read]) : key));
  return { shares: keys, image: keys.length === 1 && lone.weight === 1 ? keys[0] : JSON.stringify(keys.map((key, i) => [key, shares[i].weight])) };
}

/** The key a reader reads image `image` (its key) under, through `across`, the reader's plane px to the image's. */
export const shotImageReadKey = (image: string, { ma, mb, kx, ky }: PaintSimilarity) => JSON.stringify([image, ma, mb, kx, ky]);

/**
 * An effect's output's key: as its one share, its effect's own key (its name and parameters, shot-effect.ts) and the
 * visibility it's laid at; as its reads, each read's input's key through its map, in order. Its box follows from those.
 */
export const shotEffectImageKey = (effect: string, visibility: number, reads: readonly { readonly key: string; readonly map: PaintSimilarity }[]) =>
  textSha256Hex(JSON.stringify([effect, visibility, reads.map(({ key, map }) => [key, map.ma, map.mb, map.kx, map.ky])]));

/** Check the placed-image graph before a renderer can follow it recursively. Masks already exclude effect planes. */
export function shotPlacedImageProblems(planes: readonly CompiledShotPlane[]): PaintingProblem[] {
  const byId = new Map(planes.map((plane) => [plane.id, plane])), checked = new Set<string>(), problems: PaintingProblem[] = [];
  const visit = (plane: CompiledShotPlane, path: readonly string[]) => {
    if (plane.kind !== 'effect' || checked.has(plane.id)) return;
    checked.add(plane.id);
    const here = [...path, plane.id];
    for (const read of shotPlacedReads(plane.image)) {
      const source = byId.get(read.plane);
      const error = (message: string) => problems.push(paintingProblem('error', plane.id, 'source', message));
      if (read.earlier) error(`shotPlaneImage(${read.plane}) reads this exposure. For earlier drawings pass the source directly`);
      if (source?.kind !== 'painted' && source?.kind !== 'effect') error(`shotPlaneImage needs a placed painted or effect plane, got ${read.plane}`);
      else if (here.includes(source.id)) error(`shotPlaneImage reads in a cycle: ${[...here, source.id].join(' -> ')}`);
      else visit(source, here);
    }
  };
  for (const plane of planes) visit(plane, []);
  return problems;
}

/**
 * The planes plane `id`'s image needs at a moment: it, and each plane its masks read, theirs, and on. What evaluating
 * it alone solves. An instanced plane's variants share its id.
 */
export function shotImageReach(planes: readonly CompiledShotPlane[], id: string): ReadonlySet<string> {
  const planeOf = new Map(planes.map((plane) => [plane.id, plane])), reach = new Set<string>();
  const visit = (at: string) => {
    if (reach.has(at)) return;
    reach.add(at);
    const plane = planeOf.get(at);
    if (plane?.kind === 'effect') for (const read of shotPlacedReads(plane.image)) visit(read.plane);
    if (plane?.kind === 'painted') for (const { drawable } of plane.masks) visit(shotOccurrencePlane(drawable));
  };
  visit(id);
  return reach;
}
