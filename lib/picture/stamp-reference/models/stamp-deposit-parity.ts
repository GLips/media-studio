// stamp-deposit-parity.ts: whole deposits painted by the GPU renderer and by the CPU reference, compared pixel by
// pixel (the deposits command). The formula grids hold each WGSL twin alone; this holds what joins them: a fill's
// body in its build, masking fluid states built one on another in cropped textures, `within`, a fill's load and front.
//
// Each case is a glaze group of black on white, so the GPU's paint is its coverage (an opaque group raises it). A plain
// stroke is the control: what a brush's stages already differ by, which a fill or a mask should add nothing to.

import { bindStampBrushImages, type StampBrush, type StampBrushImageSource } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { stampDepositKeepAt } from '#lib/picture/stamp-paint/models/stamp-deposit-keep.ts';
import { stampPaintRecipe, type CompiledStampPaint, type StampPaintRecipe } from '#lib/picture/stamp-paint/models/stamp-paint-recipe.ts';
import type { StampReferenceMips } from './stamp-reference-image.ts';
import { renderStampReferenceDeposit } from './stamp-reference-deposit.ts';

export const STAMP_DEPOSIT_PARITY_CASES = ['stroke', 'fill', 'within', 'load', 'front'] as const;
export type StampDepositParityCase = (typeof STAMP_DEPOSIT_PARITY_CASES)[number];

export const STAMP_DEPOSIT_PARITY_SIZE = { width: 640, height: 420 };
/** When each case is painted: halfway through the front case's reveal. */
export const STAMP_DEPOSIT_PARITY_TIME = 1;
/** The most a case's rms may differ by: a plain stroke of a Procreate brush differs by about 0.006, its rims unmodelled. */
export const STAMP_DEPOSIT_PARITY_RMS = 0.01;

const black = { kind: 'color', color: '#000000' } as const;

/**
 * A case's painting of `brush`. Past the control: a fill under a ragged reserve half lifted on its right; apart from
 * it, so neither's paint lies on the other, a stroke under a state built on the fill's with two more ops (a soft
 * ragged band, a global lift): a state of the fluid drawn from the one under it.
 */
export function stampDepositParityRecipe(brush: StampBrush, parityCase: StampDepositParityCase): StampPaintRecipe {
  return stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => {
    if (parityCase === 'stroke') {
      group.pass('p', {}, (pass) => pass.stroke('s', { brush, material: black, diameter: 60, path: [{ x: 60, y: 60 }, { x: 460, y: 80 }, { x: 440, y: 340 }, { x: 80, y: 360 }] }));
      return;
    }
    group.mask('reserve', { region: { kind: 'ellipse', x: 240, y: 200, radiusX: 90, radiusY: 70 }, edge: { soft: 2, ragged: { amount: 6, scale: 14 } } });
    group.unmask('lift', { region: { kind: 'polygon', points: [{ x: 240, y: 120 }, { x: 350, y: 120 }, { x: 350, y: 300 }, { x: 240, y: 300 }] }, amount: 0.5 });
    const within = parityCase === 'within' ? { kind: 'polygon' as const, points: [{ x: 40, y: 30 }, { x: 460, y: 60 }, { x: 440, y: 390 }, { x: 60, y: 370 }] } : undefined;
    group.pass('p', { ...(within && { within }) }, (pass) => {
      const fill = {
        brush, material: black, diameter: 60, direction: 0.3,
        region: { kind: 'polygon' as const, points: [{ x: 30, y: 60 }, { x: 290, y: 20 }, { x: 470, y: 110 }, { x: 450, y: 400 }, { x: 240, y: 330 }, { x: 60, y: 400 }] },
        ...(parityCase === 'load' && { load: { kind: 'linear' as const, from: { x: 30, y: 0, value: 1 }, to: { x: 470, y: 0, value: 0.3 } } }),
      };
      pass.fill('f', parityCase === 'front' ? { ...fill, appliedAt: 0, drawnOver: 2 * STAMP_DEPOSIT_PARITY_TIME } : fill);
      pass.mask('band', { region: { kind: 'polygon', points: [{ x: 500, y: 180 }, { x: 630, y: 170 }, { x: 630, y: 230 }, { x: 500, y: 240 }] }, edge: { soft: 4, ragged: { amount: 5, scale: 10 } } });
      pass.unmask('ease', { amount: 0.3 });
      pass.stroke('s', { brush, material: black, diameter: 50, path: [{ x: 560, y: 40 }, { x: 575, y: 380 }] });
    });
  }));
}

/**
 * The CPU reference's coverage of `painting` at `t` (one glaze group of black), each deposit's laid over those before
 * it, its images bound by `bind`.
 */
export function stampDepositParityReference(painting: CompiledStampPaint, bind: (image: StampBrushImageSource) => StampReferenceMips, t: number): Float32Array {
  const { width, height } = STAMP_DEPOSIT_PARITY_SIZE, coverage = new Float32Array(width * height);
  for (const pass of painting.groups[0].passes) {
    for (const deposit of pass.deposits) {
      const { coverage: laid } = renderStampReferenceDeposit({
        brush: bindStampBrushImages(deposit.brush, deposit.diameter, bind), stamps: deposit.stamps, dualStamps: deposit.dualStamps,
        diameter: deposit.diameter, opacity: deposit.opacity, grainOffset: deposit.grainOffset, box: { x: 0, y: 0, width, height },
        ...(deposit.kind === 'fill' && { fill: deposit.fill }),
        keep: (x, y) => stampDepositKeepAt(deposit, pass.within, t, x, y),
      });
      laid.forEach((a, i) => {
        coverage[i] = a + coverage[i] * (1 - a);
      });
    }
  }
  return coverage;
}

/** Root-mean-square and largest difference between two coverages of one size. */
export function compareStampDepositCoverage(gpu: ArrayLike<number>, cpu: ArrayLike<number>): { rms: number; max: number } {
  let sum = 0, max = 0;
  for (let i = 0; i < gpu.length; i++) {
    const d = Math.abs(gpu[i] - cpu[i]);
    sum += d * d;
    max = Math.max(max, d);
  }
  return { rms: Math.sqrt(sum / gpu.length), max };
}
