// painting-selection.ts: some of an evaluation's layers and groups, as a shot's plane shows them and a film readback
// reads them: the evaluation, the keys selected, and the prefix. A selection is a description;
// nothing is compiled or solved until something draws or reads it. The shot builds its sources on it (shot-selection.ts).

import type { RedrawToken } from '#lib/timing/drawings/models/drawing-schedule.ts';
import type { NodeKey } from './painting-document.ts';
import type { PaintingEvaluation } from './painting-source.ts';

/**
 * Under a selection: the root sheet's paper, or nothing. Left out: paper on a shot's back plane, nothing nearer. Paint
 * keeps its sheet's grain either way; this decides only whether the paper itself is drawn.
 */
export type SelectionGround = 'paper' | 'transparent';

/**
 * Layers or groups of one evaluation, finished and composed in document order, in document px. The selected layers of
 * one sheet are painted as one history; layers it leaves out aren't painted into it. `at`: the scene second its
 * clocked washes and its reveals show (all of both when left out). An own sheet's layers go together.
 */
export type LayerSelection = {
  readonly kind: 'layers';
  readonly painting: PaintingEvaluation;
  readonly layers: readonly NodeKey[];
  readonly ground?: SelectionGround;
  /** Resolved mark tokens by layer or group key. The closest key to each layer wins. */
  readonly redraw?: ReadonlyMap<NodeKey, RedrawToken>;
  readonly at?: number;
};

/** `layers` of `evaluation` as a plane's source or a readback's selection, with `ground` and `at`. */
export function layersOf(
  evaluation: PaintingEvaluation, layers: readonly NodeKey[], options: Pick<LayerSelection, 'ground' | 'at' | 'redraw'> = {},
): LayerSelection {
  return { kind: 'layers', painting: evaluation, layers, ...options };
}
