// stamp-gate-contact.ts: where water lands, held to the touch law (stamp-wet-contact.ts) applied pixel by pixel, as
// the wet field takes it. A fine checkerboard tip, 64 texels drawn 64 px across, so each pixel is touched wholly or not
// at all, is traced on the GPU; its coverage taken through stampTipTouch and averaged per 8 px cell must come to half
// in every cell wholly under the stamp. A pair a pixel apart, each touching where the other doesn't, must join to
// whole where both reach: averaged before joining, each would leave its cells half.

import { stampTipLevels } from '#lib/paint/brush/models/stamp-tip-levels.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { stampTipFullContact, stampTipTouch } from '#lib/paint/painting/models/stamp-wet-contact.ts';
import { STAMP_GATE_WHITE, stampGateAsset, stampGateBrush, type StampGateImage, type StampGatePainting } from './stamp-gate-paintings.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';

export const STAMP_GATE_CONTACT_IDS = ['contact/checker', 'contact/checker-pair'] as const;
export type StampGateContactId = (typeof STAMP_GATE_CONTACT_IDS)[number];

const SIZE = 64;
/** The checkerboard: a texel of paint (0, as an image's dark) beside one of none. */
const CHECKER: StampGateImage = { size: SIZE, pixels: Uint8Array.from({ length: SIZE * SIZE }, (_, i) => (((i % SIZE) + Math.floor(i / SIZE)) % 2 ? 0 : 255)) };
/** The cells a case's touch is averaged over, px. */
const CELL = 8;
/** How far a cell's mean touch may sit from what it should be: a pixel's rounding at the tip's texels, not a law's order. */
const STAMP_GATE_CONTACT_TOLERANCE = 0.02;

/** Case `id`'s stamps, their pixel centres on the checker's texel centres: the pair's second a pixel right of the first. */
export function stampGateContactPainting(id: StampGateContactId): StampGatePainting {
  const at = id === 'contact/checker' ? [{ x: SIZE / 2 + 8, y: SIZE / 2 + 8 }] : [{ x: SIZE / 2 + 8, y: SIZE / 2 + 8 }, { x: SIZE / 2 + 9, y: SIZE / 2 + 8 }];
  const brush = stampGateBrush('Checker', { flow: 1, tip: { image: stampGateAsset('checker.png'), roundness: 1, sampling: 'isotropic' } });
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: STAMP_GATE_WHITE, mixing: { kind: 'flat' } }, (p) => p.group('g', { composite: 'glaze', opacity: 1 }, (g) => g.passage('p', {}, (pass) => {
    pass.stamps('checker', { brush, size: SIZE, well: { paint: { kind: 'color', color: '#000000' } }, at });
  }))));
  return { painting, width: SIZE + 16, height: SIZE + 16, t: 0, images: { 'checker.png': CHECKER } };
}

/**
 * The GPU's traced coverage of case `id`'s painting through the touch law, each cell's mean: half in every cell wholly
 * under the single stamp, whole in every cell under both of the pair's.
 */
export function checkStampGateContact(id: StampGateContactId, coverage: Float32Array): StampGateWashCheck {
  const gate = stampGateContactPainting(id), { width } = gate;
  const full = stampTipFullContact(stampTipLevels({ width: SIZE, height: SIZE, pixels: CHECKER.pixels }));
  // The stamp lays x and y 8 to 72; the pair's second, x 9 to 73.
  const [from, to, expected] = id === 'contact/checker' ? [8, SIZE + 8, 0.5] : [9, SIZE + 8, 1];
  let worst = 0, at = '', cells = 0;
  for (let y0 = CELL; y0 + CELL <= SIZE + 8; y0 += CELL) for (let x0 = Math.ceil(from / CELL) * CELL; x0 + CELL <= to; x0 += CELL) {
    let sum = 0;
    for (let y = y0; y < y0 + CELL; y++) for (let x = x0; x < x0 + CELL; x++) sum += stampTipTouch(coverage[y * width + x], 1, full);
    const mean = sum / CELL ** 2, difference = Math.abs(mean - expected);
    cells++;
    if (difference > worst) [worst, at] = [difference, `(${x0}, ${y0}): ${mean.toFixed(3)}, not ${expected}`];
  }
  return { id, passed: worst <= STAMP_GATE_CONTACT_TOLERANCE, detail: `${cells} cells, worst ${worst.toFixed(3)}${at && ` at ${at}`}` };
}
