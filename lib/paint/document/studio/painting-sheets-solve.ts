// painting-sheets-solve.ts: a compiled selection's sheets solved on a device and laid as one composite (ENGINE 5.3,
// 5.4). Poses split at each sheet's owner: the nodes below it pose its entries' marks before its solve
// (painting-pose.ts); its owner and the nodes above move its finished films, card and paper, as the composite's
// placement of the sheet. The root's sheet has no owner, so all its posing comes before painting.
//
// Each sheet's films are held from its solve until the caller releases them, so a later sheet's solve can't give
// them up before they're drawn or read.

import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { stampCanonicalJson } from '#lib/paint/painting/models/stamp-sheet-state-key.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { StampSheetsComposite } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import { holdStampSheetFilms } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import { solveStampSheet, type StampSheetSolved } from '#lib/paint/painting/studio/stamp-sheet-solver.ts';
import type { PaintingSelectionCompiled } from '../models/painting-document-compile.ts';
import { PAINTING_REST_POSE, paintingChainMap, paintingSheetPlace, paintingSheetPosed, type PaintingPoses } from '../models/painting-pose.ts';

/**
 * A selection's sheets solved: each one's solve, at its index in the compiled selection; their composite; and
 * `release`, letting their films go once the composite is drawn or read.
 */
export type PaintingSheetsSolved = { readonly solved: readonly StampSheetSolved[]; readonly composite: StampSheetsComposite; readonly release: () => void };

/** What a selection's solve is told: the poses moving its nodes (all at rest when left out), and where costs count. */
export type PaintingSheetsSolveOptions = { readonly poses?: PaintingPoses; readonly costs?: StampPaintCostTally };

/**
 * Each of `compiled`'s sheets posed by `poses` and solved on `owner`, one after another, its films held; and the
 * composite laying them, each own sheet placed by its owner chain's map.
 */
export async function solvePaintingSheets(
  owner: StampPaintGpuOwner, compiled: PaintingSelectionCompiled, { poses = new Map(), costs }: PaintingSheetsSolveOptions = {},
): Promise<PaintingSheetsSolved> {
  const holds: (() => void)[] = [], release = () => holds.splice(0).forEach((letGo) => letGo());
  // The device's lease runs the solves in turn, and each hold runs as its solve settles, before the next one starts.
  const settled = await Promise.allSettled(compiled.sheets.map(({ program }) => solveStampSheet(owner, paintingSheetPosed(compiled.tree, program, poses, costs), { costs }).then((done) => {
    holds.push(holdStampSheetFilms(owner, done.films));
    return done;
  })));
  const solved: StampSheetSolved[] = [];
  for (const outcome of settled) {
    if (outcome.status === 'rejected') {
      release();
      throw outcome.reason;
    }
    solved.push(outcome.value);
  }
  const sheets = compiled.sheets.map(({ program, ownerChain }, s) => {
    const map = paintingChainMap(compiled.tree, ownerChain, poses);
    return { program, films: solved[s].films, place: stampCanonicalJson(map) === PAINTING_REST_POSE ? null : paintingSheetPlace(map) };
  });
  return { solved, composite: { sheets, steps: compiled.steps }, release };
}
