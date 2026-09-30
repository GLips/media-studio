// stamp-wetness.ts: how wet the paper is where each of a wash's deposits lands, worked out once as a painting loads,
// from the recipe alone in painting order. Painting time starts at 0 with each wash and only its waits advance it; the
// scene's clock only reveals what was painted, so a frame never depends on the frames before it.
//
// The record is coarse: grids of cells many pixels across, read bilinearly (STAMP_GRID_AT_WGSL). A hard edge is the
// landing law's to draw, where wetness falls to nothing.
//
// Negative space: this first cut is uniform over each wash; each cell drying from its own watering comes later.

import type { PaintMedium } from '#lib/picture/paint/models/paint-medium.ts';
import { stampPaintFieldEnds } from './stamp-paint-field.ts';
import type { CompiledStampDeposit, CompiledStampPaint, CompiledStampPass, StampPaintPaper, StampWashWait } from './stamp-paint-recipe.ts';
import type { StampGrid } from './stamp-region.ts';

/**
 * The paper at a moment: `wetness`, water on it, 0 (dry) to 1 (a standing wash); `workable`, how freely paint there
 * still moves, 0 (set) to 1 (as wet as laid). Both on one lattice covering the whole painting, as the GPU's gridAt
 * holds a grid's border value beyond it.
 */
export type StampWetState = { wetness: StampGrid; workable: StampGrid };

/**
 * A wash's deposit landing: `tau`, painting seconds into its wash; the paper `before` it and `after` its own water;
 * `water`, what its brush carries, 0..1 (0 for a lift).
 */
export type StampWetLanding = { tau: number; before: StampWetState; after: StampWetState; water: number };

/** A wash's record: how many painting seconds it took, its waits included, and the paper as it's left. */
export type StampWashRecord = { duration: number; end: StampWetState };

export type StampWetness = {
  landings: ReadonlyMap<CompiledStampDeposit, StampWetLanding>;
  washes: ReadonlyMap<CompiledStampPass, StampWashRecord>;
};

/** A paper's absorbency when it doesn't say. */
export const STAMP_PAPER_ABSORBENCY = 0.5;

/** A grid of one value everywhere: the smallest gridAt reads, 2 × 2. */
const evenGrid = (value: number): StampGrid => ({ x0: 0, y0: 0, cell: 1, columns: 2, rows: 2, values: new Float32Array(4).fill(value) });

/**
 * Every wash deposit's landing in `painting`, its paint in `medium` on `paper`. The paper loses water at
 * `(0.5 + absorbency) / drying` of a full wash a second; paint stays workable while the paper is wetter than damp.
 */
export function compileStampWetness(painting: CompiledStampPaint, medium: PaintMedium, paper: StampPaintPaper): StampWetness {
  const { wetting } = medium;
  const rate = (0.5 + (paper.absorbency ?? STAMP_PAPER_ABSORBENCY)) / wetting.drying;
  const state = (level: number): StampWetState => ({ wetness: evenGrid(level), workable: evenGrid(Math.min(1, level / wetting.damp)) });
  const landings = new Map<CompiledStampDeposit, StampWetLanding>(), washes = new Map<CompiledStampPass, StampWashRecord>();
  for (const pass of painting.groups.flatMap((group) => group.passes)) {
    if (pass.kind !== 'wash') continue;
    const { preparation, schedule } = pass.wash;
    const ends = preparation && stampPaintFieldEnds(preparation.wetness);
    let tau = 0, level = ends ? Math.max(ends.first, ends.second) : 0;
    const waitFor = (until: StampWashWait) => {
      const seconds = typeof until === 'object' ? until.seconds : Math.max(0, level - (until === 'damp' ? wetting.damp : 0)) / rate;
      tau += seconds;
      level = Math.max(0, level - seconds * rate);
    };
    for (const step of schedule) {
      if (step.kind === 'wait') {
        waitFor(step.until);
        continue;
      }
      const { deposit } = step;
      const water = deposit.action.kind === 'lift' ? 0 : step.water ?? wetting.brushWater;
      const before = state(level);
      level = Math.max(level, water);
      landings.set(deposit, { tau, before, after: state(level), water });
    }
    washes.set(pass, { duration: tau, end: state(level) });
  }
  return { landings, washes };
}
