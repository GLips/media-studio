// painting-sheets-solve.ts: a compiled selection's sheets solved on a device and laid as one composite (ENGINE 5.3,
// 5.4). Poses split at each sheet's owner: the nodes below it pose its entries' marks before its solve
// (painting-pose.ts); its owner and the nodes above move its finished films, card and paper, as the composite's
// placement of the sheet. The root's sheet has no owner, so all its posing comes before painting.

import { paintPlacementOfSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { StampSheetsComposite } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { solveStampSheet, type StampSheetSolved } from '#lib/paint/painting/studio/stamp-sheet-solver.ts';
import type { PaintingSelectionCompiled } from '../models/painting-document-compile.ts';
import { paintingChainMap, paintingSheetPosed, type PaintingPoses } from '../models/painting-pose.ts';
import type { PaintingEvaluation } from '../models/painting-source.ts';
import type { PaintingSheet, PaintingTree } from '../models/painting-tree.ts';

/** A selection's sheets solved: each one's solve, at its index in the compiled selection, and their composite. */
export type PaintingSheetsSolved = { readonly solved: readonly StampSheetSolved[]; readonly composite: StampSheetsComposite };

/**
 * The nodes whose poses move `sheet` whole, as node ordinals outermost first: its owner and every group enclosing it.
 * None for the root's sheet.
 */
export function paintingSheetOwnerChain(tree: PaintingTree, sheet: PaintingSheet): number[] {
  if (sheet.owner === null) return [];
  const owner = tree.byKey.get(sheet.owner)!;
  return [...owner.groups, sheet.owner].map((key) => tree.nodes.indexOf(tree.byKey.get(key)!));
}

/**
 * Each of `compiled`'s sheets (from `evaluation`) posed by `poses` and solved on `owner`, costs counted into `costs`;
 * and the composite laying them, each own sheet placed by its owner's chain.
 */
export async function solvePaintingSheets(
  owner: StampPaintGpuOwner, evaluation: PaintingEvaluation, compiled: PaintingSelectionCompiled, { poses = new Map(), costs }: { poses?: PaintingPoses; costs?: StampPaintCostTally } = {},
): Promise<PaintingSheetsSolved> {
  // The device's solve lease runs them one after another, in the order asked.
  const solved = await Promise.all(compiled.sheets.map(({ program }) => solveStampSheet(owner, paintingSheetPosed(program, poses, costs), { costs })));
  const sheets = compiled.sheets.map(({ sheet, program }, s) => {
    const chain = paintingSheetOwnerChain(evaluation.tree, sheet), moved = chain.some((node) => poses.has(node));
    return { program, films: solved[s].films, place: moved ? paintPlacementOfSimilarity(paintingChainMap(chain, poses), { x: 0, y: 0 }) : null };
  });
  return { solved, composite: { sheets, steps: compiled.steps } };
}
