// stamp-gate-private-cases.ts: what the gate's private run paints with each of a pack's brushes, whose images can't
// be public: a stroke, and a flood under masking fluid alone, within a region, with a load and its front halfway, each
// with a stroke under a state of the fluid built on the flood's. Its baselines sit in ignored work/validation/.

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { StampGatePainting } from './stamp-gate-paintings.ts';

export const STAMP_GATE_PRIVATE_CASES = ['stroke', 'flood', 'within', 'load', 'front'] as const;
export type StampGatePrivateCase = (typeof STAMP_GATE_PRIVATE_CASES)[number];

export const STAMP_GATE_PRIVATE_SIZE = { width: 640, height: 420 };
/** When each case is painted: halfway through the front case's reveal. */
export const STAMP_GATE_PRIVATE_TIME = 1;

const black = { kind: 'color', color: '#000000' } as const;

/**
 * A case's painting of `brush`, a glaze of black on white. Past the stroke: a flood under a ragged reserve half lifted on
 * its right; apart from it, so neither's paint lies on the other, a stroke under a state built on the flood's with two
 * more ops (a soft ragged band, a global lift).
 */
export function stampGatePrivateRecipe(brush: StampBrush, privateCase: StampGatePrivateCase): StampPaintRecipe {
  return stampPaintRecipe((paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => {
    if (privateCase === 'stroke') {
      group.pass('p', {}, (pass) => pass.stroke('s', { brush, material: black, diameter: 60, path: [{ x: 60, y: 60 }, { x: 460, y: 80 }, { x: 440, y: 340 }, { x: 80, y: 360 }] }));
      return;
    }
    group.mask('reserve', { region: { kind: 'ellipse', x: 240, y: 200, radiusX: 90, radiusY: 70 }, edge: { soft: 2, ragged: { amount: 6, scale: 14 } } });
    group.unmask('lift', { region: { kind: 'polygon', points: [{ x: 240, y: 120 }, { x: 350, y: 120 }, { x: 350, y: 300 }, { x: 240, y: 300 }] }, amount: 0.5 });
    const within = privateCase === 'within' ? { kind: 'polygon' as const, points: [{ x: 40, y: 30 }, { x: 460, y: 60 }, { x: 440, y: 390 }, { x: 60, y: 370 }] } : undefined;
    group.pass('p', { ...(within && { within: { region: within } }) }, (pass) => {
      const fill = {
        brush, material: black, diameter: 60, direction: 0.3, application: { kind: 'flood' as const },
        region: { kind: 'polygon' as const, points: [{ x: 30, y: 60 }, { x: 290, y: 20 }, { x: 470, y: 110 }, { x: 450, y: 400 }, { x: 240, y: 330 }, { x: 60, y: 400 }] },
        ...(privateCase === 'load' && { load: { kind: 'linear' as const, from: { x: 30, y: 0, value: 1 }, to: { x: 470, y: 0, value: 0.3 } } }),
      };
      pass.fill('f', privateCase === 'front' ? { ...fill, appliedAt: 0, drawnOver: 2 * STAMP_GATE_PRIVATE_TIME } : fill);
      pass.mask('band', { region: { kind: 'polygon', points: [{ x: 500, y: 180 }, { x: 630, y: 170 }, { x: 630, y: 230 }, { x: 500, y: 240 }] }, edge: { soft: 4, ragged: { amount: 5, scale: 10 } } });
      pass.unmask('ease', { amount: 0.3 });
      pass.stroke('s', { brush, material: black, diameter: 50, path: [{ x: 560, y: 40 }, { x: 575, y: 380 }] });
    });
  }));
}

/** A case's painting of `brush` as the page draws it and its inputs are hashed: compiled, on white, in flat colour. */
export function stampGatePrivatePainting(brush: StampBrush, privateCase: StampGatePrivateCase): Omit<StampGatePainting, 'images'> {
  const painting = compileStampPaintRecipe(stampGatePrivateRecipe(brush, privateCase));
  return { painting, paper: { color: '#ffffff' }, mixing: { kind: 'flat' }, ...STAMP_GATE_PRIVATE_SIZE, t: STAMP_GATE_PRIVATE_TIME };
}
