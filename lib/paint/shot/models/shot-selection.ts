// shot-selection.ts: what a plane of a shot shows of a painting: some of an evaluation's layers and groups, finished
// and composed in document order, or two such blended. A selection is a description; nothing is solved until a shot
// draws it. layersOf refuses what no shot could draw: keys the evaluation lacks, a key selected twice, an own sheet
// split from its owner.

import type { AnyApplication, Key, NodeKey } from '#lib/paint/document/models/painting-document.ts';
import { paintingLayersUnder, type PaintingNodePlace, type PaintingSheets } from '#lib/paint/document/models/painting-sheets.ts';
import type { PaintingEvaluation } from '#lib/paint/document/models/painting-source.ts';

/**
 * Under a selection: the root sheet's paper, or nothing. Left out: paper on a shot's back plane, nothing nearer. Paint
 * keeps its sheet's grain either way; this decides only whether the paper itself is drawn.
 */
export type SelectionGround = 'paper' | 'transparent';

/**
 * Layers or groups of one evaluation, finished and composed in document order, in document px. The selected layers of
 * one sheet are painted as one history; layers it leaves out aren't painted into it. `at`: the scene second whose
 * scheduled prefix its clocked washes show (every application when left out). An own sheet's layers go together.
 */
export type LayerSelection = {
  readonly kind: 'layers';
  readonly painting: PaintingEvaluation;
  readonly layers: readonly NodeKey[];
  readonly ground?: SelectionGround;
  readonly at?: number;
};

/**
 * Two finished selections' plane pictures interpolated linearly, `k` 0..1 from a to b, in their native form: opaque
 * colour on an opaque backing, colour and transmittance for clear painted pictures, premultiplied RGBA at an RGBA
 * output. It mixes pictures, never pigment. Either side may be a dissolve.
 */
export type Dissolve = { readonly kind: 'dissolve'; readonly a: PaintedSource; readonly b: PaintedSource; readonly k: number };

export type PaintedSource = LayerSelection | Dissolve;

/** What a document key names other than a layer or group, for the message refusing it. */
function nonNodeKind(sheets: PaintingSheets, key: Key): string | null {
  for (const { node } of sheets.layers) {
    for (const wash of node.washes) {
      if (wash.key === key) return 'a wash';
      const applications: readonly AnyApplication[] = wash.applications;
      if (applications.some((application) => application.key === key)) return 'an application';
    }
  }
  return null;
}

/** The selected keys' places, each key known and naming a layer or group. Throws naming the first that isn't. */
function selectedPlaces(evaluation: PaintingEvaluation, keys: readonly Key[]): PaintingNodePlace[] {
  return keys.map((key) => {
    const place = evaluation.sheets.byKey.get(key);
    if (place) return place;
    const kind = nonNodeKind(evaluation.sheets, key);
    throw new Error(`layersOf names ${key}, which ${kind ? `is ${kind}: it selects layers and groups` : `is unknown in ${evaluation.source}`}`);
  });
}

/**
 * `layers` of `evaluation` as a plane's source, with `ground` and `at`. Throws when a key is unknown or names no layer
 * or group, a layer is selected twice (by itself and through its group, say), or a layer on an own sheet is selected
 * without its sheet's owner and without the rest of that sheet's layers.
 */
export function layersOf(
  evaluation: PaintingEvaluation, layers: readonly NodeKey[], options: { readonly ground?: SelectionGround; readonly at?: number } = {},
): LayerSelection {
  if (layers.length === 0) throw new Error(`layersOf selects nothing of ${evaluation.source}: name its layers or groups`);
  const { ground, at } = options;
  if (at !== undefined && !Number.isFinite(at)) throw new Error(`layersOf's at ${at} isn't a finite scene second`);
  const places = selectedPlaces(evaluation, layers);
  const chosen = new Map<Key, Key>();
  for (const place of places) {
    for (const { node } of paintingLayersUnder(evaluation.sheets, place)) {
      const before = chosen.get(node.key);
      if (before !== undefined) throw new Error(`layersOf selects ${node.key} twice: through ${before} and ${place.node.key}`);
      chosen.set(node.key, place.node.key);
    }
  }
  const covered = (owner: Key) => places.some(({ node, kind }) => node.key === owner || (kind === 'group' && evaluation.sheets.byKey.get(owner)?.groups.includes(node.key)));
  for (const sheet of evaluation.sheets.sheets) {
    if (sheet.owner === null || covered(sheet.owner)) continue;
    const onIt = evaluation.sheets.layers.filter((place) => place.sheet === sheet).map(({ node }) => node.key);
    const picked = onIt.filter((key) => chosen.has(key));
    if (picked.length > 0 && picked.length < onIt.length) {
      throw new Error(`layersOf: ${picked[0]} lies on ${sheet.owner}'s own sheet: select ${sheet.owner}, or all its sheet's layers, together`);
    }
  }
  return { kind: 'layers', painting: evaluation, layers, ...(ground && { ground }), ...(at !== undefined && { at }) };
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

/** `a` blended toward `b` by `k` 0..1, as one source. */
export function dissolve(a: PaintedSource, b: PaintedSource, k: number): Dissolve {
  if (!(k >= 0 && k <= 1)) throw new Error(`dissolve's k ${k} isn't within 0..1`);
  return { kind: 'dissolve', a, b, k };
}
