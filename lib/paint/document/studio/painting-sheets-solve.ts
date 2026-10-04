// painting-sheets-solve.ts: a compiled selection's sheets solved on a device and laid as one composite (ENGINE 5.3,
// 5.4). Poses split at each sheet's owner: the nodes below it pose its entries' marks before its solve
// (painting-pose.ts); its owner and the nodes above move its finished films, card and paper, as the composite's
// placement of the sheet. The root's sheet has no owner, so all its posing comes before painting.
//
// Each sheet's films are held from its solve until the caller releases them, so a later sheet's solve can't give
// them up before they're drawn or read.

import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { StampSheetsComposite } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import { holdStampSheetFilms } from '#lib/paint/painting/studio/stamp-sheet-films.ts';
import { solveStampSheet, type StampSheetSolved } from '#lib/paint/painting/studio/stamp-sheet-solver.ts';
import type { PaintingSelectionCompiled } from '../models/painting-document-compile.ts';
import { PAINTING_REST_POSE, paintingChainPose, paintingPoseText, paintingSheetPlace, paintingSheetPosed, type PaintingPoses } from '../models/painting-pose.ts';
import { paintingRevealLinksOf } from '../models/painting-reveal.ts';

/**
 * A selection's sheets solved: each one's solve, at its index in the compiled selection; their composite; and
 * `release`, letting their films go once the composite is drawn or read.
 */
export type PaintingSheetsSolved = { readonly solved: readonly StampSheetSolved[]; readonly composite: StampSheetsComposite; readonly release: () => void };

/**
 * What a selection's solve is told: the poses moving its nodes (all at rest when left out), the scene second whose
 * prefix each sheet shows (all of it when left out), and where costs count.
 */
export type PaintingSheetsSolveOptions = { readonly poses?: PaintingPoses; readonly at?: number; readonly costs?: StampPaintCostTally };

/**
 * Each of `compiled`'s sheets posed by `poses` and solved on `owner`, one after another, its films held until
 * `release`: each one's solve at its index in the compiled selection. Releases what it held when one is refused.
 */
export async function solvePaintingSheetFilms(
  owner: StampPaintGpuOwner, compiled: PaintingSelectionCompiled, { poses = new Map(), at, costs }: PaintingSheetsSolveOptions = {},
): Promise<{ readonly solved: readonly StampSheetSolved[]; readonly release: () => void }> {
  const holds: (() => void)[] = [], release = () => holds.splice(0).forEach((letGo) => letGo());
  // The device's lease runs the solves in turn, and each hold runs as its solve settles, before the next one starts.
  const settled = await Promise.allSettled(compiled.sheets.map(({ program }) => solveStampSheet(owner, paintingSheetPosed(compiled.tree, program, poses, costs), { costs, ...(at !== undefined && { at }) }).then((done) => {
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
  return { solved, release };
}

/**
 * Each of `compiled`'s sheets posed by `poses` and solved on `owner`; and the composite laying them, each own sheet
 * placed by its owner chain's map, each film cut by its reveals at `at`. Refuses an own sheet its chain warps: a
 * composite places a sheet by a similarity, and only a shot lays one through a warp (shot-sheets-lay.ts).
 */
export async function solvePaintingSheets(owner: StampPaintGpuOwner, compiled: PaintingSelectionCompiled, options: PaintingSheetsSolveOptions = {}): Promise<PaintingSheetsSolved> {
  const { solved, release } = await solvePaintingSheetFilms(owner, compiled, options), poses = options.poses ?? new Map(), reveals = paintingRevealLinksOf(compiled, poses, options.at);
  const sheets = compiled.sheets.map(({ program, ownerChain }, s) => {
    const pose = paintingChainPose(compiled.tree, ownerChain, poses);
    if (pose.kind === 'warp') {
      release();
      throw new Error(`painting: ${program.name} is placed by a warp (${pose.text}); a still lays a sheet moved by a similarity only`);
    }
    return { program, films: solved[s].films, place: paintingPoseText(pose) === PAINTING_REST_POSE ? null : paintingSheetPlace(pose.map), reveals: reveals[s] };
  });
  return { solved, composite: { sheets, steps: compiled.steps }, release };
}
