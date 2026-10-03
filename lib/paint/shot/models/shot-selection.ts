// shot-selection.ts: what a plane of a shot shows of a painting: a selection of an evaluation's layers and groups
// (painting-selection.ts's LayerSelection, finished and composed in document order), or two such blended. A source is
// a description; nothing is solved until a shot draws it. A shot's load holds each plane's source to what a shot can
// draw (paintedSourceProblems) and reports every problem with its plane's, so the constructors build without judging.

import type { AnyApplication, Key } from '#lib/paint/document/models/painting-document.ts';
import { paintingField, paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { LayerSelection } from '#lib/paint/document/models/painting-selection.ts';
import { paintingLayersUnder, paintingSheetName, type PaintingNodePlace, type PaintingTree } from '#lib/paint/document/models/painting-tree.ts';
import { shotOccurrenceKey } from './shot-occurrences.ts';

/**
 * Two finished selections' plane pictures interpolated linearly, `k` 0..1 from a to b, in their native form: opaque
 * colour on an opaque backing, colour and transmittance for clear painted pictures, premultiplied RGBA at an RGBA
 * output. It mixes pictures, never pigment. Either side may be a dissolve.
 */
export type Dissolve = { readonly kind: 'dissolve'; readonly a: PaintedSource; readonly b: PaintedSource; readonly k: number };

export type PaintedSource = LayerSelection | Dissolve;

/** `a` blended toward `b` by `k` 0..1, as one source. */
export function dissolve(a: PaintedSource, b: PaintedSource, k: number): Dissolve {
  return { kind: 'dissolve', a, b, k };
}

/** What a document key names other than a layer or group, for the message refusing it. */
function nonNodeKind(tree: PaintingTree, key: Key): string | null {
  for (const { node } of tree.layers) {
    for (const wash of node.washes) {
      if (wash.key === key) return 'a wash';
      const applications: readonly AnyApplication[] = wash.applications;
      if (applications.some((application) => application.key === key)) return 'an application';
    }
  }
  return null;
}

/**
 * Problems in a selection of plane `plane`, at `field` in it: nothing selected, an `at` that isn't a scene second, a
 * key naming no layer or group, a layer selected twice (by itself and through its group, say), or an own sheet's
 * layer selected without its owner and the rest of that sheet's layers.
 */
function selectionProblems(plane: string, field: string, { painting: evaluation, layers, at }: LayerSelection): PaintingProblem[] {
  const problems: PaintingProblem[] = [], error = (owner: string, within: string, message: string) => problems.push(paintingProblem('error', owner, within, message));
  if (layers.length === 0) error(plane, paintingField(field, 'layers'), `selects nothing of ${evaluation.source}: name its layers or groups`);
  if (at !== undefined && !Number.isFinite(at)) error(plane, paintingField(field, 'at'), `${at} isn't a finite scene second`);
  const { tree } = evaluation, places: PaintingNodePlace[] = [];
  layers.forEach((key, i) => {
    const place = tree.byKey.get(key);
    if (place) places.push(place);
    else {
      const kind = nonNodeKind(tree, key);
      error(plane, paintingField(field, `layers[${i}]`), `names ${key}, which ${kind ? `is ${kind}: it selects layers and groups` : `is unknown in ${evaluation.source}`}`);
    }
  });
  const chosen = new Map<Key, Key>();
  for (const place of places) {
    for (const { node } of paintingLayersUnder(tree, place)) {
      const before = chosen.get(node.key);
      if (before !== undefined) error(shotOccurrenceKey(plane, node.key), '', `is selected twice, through ${before} and ${place.node.key}`);
      else chosen.set(node.key, place.node.key);
    }
  }
  const covered = (owner: Key) => places.some(({ node, kind }) => node.key === owner || (kind === 'group' && tree.byKey.get(owner)?.groups.includes(node.key)));
  for (const sheet of tree.sheets) {
    if (sheet.owner === null || covered(sheet.owner)) continue;
    const onIt = tree.layers.filter((place) => place.sheet === sheet).map(({ node }) => node.key);
    const picked = onIt.filter((key) => chosen.has(key));
    if (picked.length > 0 && picked.length < onIt.length) {
      error(shotOccurrenceKey(plane, picked[0]), '', `lies on ${paintingSheetName(sheet)}: select ${sheet.owner}, or all its sheet's layers, on one plane`);
    }
  }
  return problems;
}

/**
 * Every problem in `source`, the source of plane `plane`, that keeps a shot from drawing it: a selection's
 * (selectionProblems) and a dissolve's `k` outside 0..1, either side's in turn. A shot's load reports them all.
 */
export function paintedSourceProblems(plane: string, source: PaintedSource, field = 'source'): PaintingProblem[] {
  if (source.kind === 'layers') return selectionProblems(plane, field, source);
  const k = source.k >= 0 && source.k <= 1 ? [] : [paintingProblem('error', plane, paintingField(field, 'k'), `${source.k} isn't within 0..1`)];
  return [...k, ...paintedSourceProblems(plane, source.a, paintingField(field, 'a')), ...paintedSourceProblems(plane, source.b, paintingField(field, 'b'))];
}

/** One selection a plane's source blends, and its weight in the plane's picture. */
export type PaintedSourceShare = { readonly selection: LayerSelection; readonly weight: number };

const sameSelection = (a: LayerSelection, b: LayerSelection) =>
  a.painting === b.painting && a.ground === b.ground && a.at === b.at && a.layers.length === b.layers.length && a.layers.every((key, i) => key === b.layers[i]);

/**
 * The selections `source` blends, weights summing to 1: `dissolve(a, b, k)` weighs a by 1 − k and b by k, nested ones
 * multiplying. A dissolve is linear in each form a plane's picture takes, so this weighted sum is the nested blends.
 * A weight of 0 is dropped (`k` at 0 or 1 solves one side); equal selections merge.
 */
export function paintedSourceShares(source: PaintedSource): PaintedSourceShare[] {
  const shares: { selection: LayerSelection; weight: number }[] = [];
  const visit = (at: PaintedSource, weight: number) => {
    if (weight === 0) return;
    if (at.kind === 'dissolve') {
      visit(at.a, weight * (1 - at.k));
      visit(at.b, weight * at.k);
      return;
    }
    const same = shares.find(({ selection }) => sameSelection(selection, at));
    if (same) same.weight += weight;
    else shares.push({ selection: at, weight });
  };
  visit(source, 1);
  return shares;
}

/**
 * The one selection `source` draws, or why it can't be drawn: a dissolve between its ends blends two (ENGINE 10 slice
 * 6). At k 0 or 1 it's the end shown.
 */
export function paintedSourceSelection(source: PaintedSource): { readonly selection: LayerSelection } | { readonly problem: string } {
  const shares = paintedSourceShares(source);
  if (shares.length !== 1) return { problem: `blends ${shares.length} selections: a dissolve between its ends isn't drawn yet (ENGINE slice 6), only at k 0 or 1` };
  return { selection: shares[0].selection };
}

/**
 * The authored levels either side of `value` and how far between them it sits, `k` 0..1: on a level, or past either
 * end, both ends are that level and `k` is 0. `levels` ascend.
 */
export function bracket(value: number, levels: readonly number[]): { readonly lower: number; readonly upper: number; readonly k: number } {
  if (levels.length === 0 || !levels.every((level, i) => Number.isFinite(level) && (i === 0 || level > levels[i - 1]))) {
    throw new Error(`bracket's levels ${levels.join(', ')} aren't finite and ascending`);
  }
  if (!Number.isFinite(value)) throw new Error(`bracket's value ${value} isn't finite`);
  const upper = levels.findIndex((level) => level >= value);
  if (upper < 0) return { lower: levels.at(-1)!, upper: levels.at(-1)!, k: 0 };
  if (levels[upper] === value || upper === 0) return { lower: levels[upper], upper: levels[upper], k: 0 };
  const below = levels[upper - 1], above = levels[upper];
  return { lower: below, upper: above, k: (value - below) / (above - below) };
}
