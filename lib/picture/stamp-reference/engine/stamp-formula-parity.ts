// stamp-formula-parity.ts: runs every paired formula's WGSL twin on the GPU over its transfer grid
// (models/stamp-formula-parity.ts) in the render browser, and holds each to its CPU side. `node
// harness/stamp-reference.ts formulas` runs it; it needs WebGPU, so it isn't among the tests.

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBrowserModulePage } from '#lib/output/render/engine/browser-module-page.ts';
import { compareStampFormulaGrid, stampFormulaGrids } from '../models/stamp-formula-parity.ts';

const PARITY_PAGE = fileURLToPath(new URL('../studio/stamp-formula-parity-page.ts', import.meta.url));

/** Each formula's grid run on the GPU against the CPU (compareStampFormulaGrid). */
export async function checkStampFormulaParity() {
  const grids = stampFormulaGrids();
  // The page loads no files; it's served its own folder only because the page server serves one.
  const results = await withBrowserModulePage({ entry: PARITY_PAGE, filesDir: dirname(PARITY_PAGE) }, (call) =>
    call<number[][]>('runStampFormulaParity', grids.map(({ call: wgsl, width, rows }) => ({ call: wgsl, width, rows: Array.from(rows) }))));
  return grids.map((grid, i) => compareStampFormulaGrid(grid, results[i]));
}
