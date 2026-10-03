// stamp-gate-private-cases.ts: what the gate's private run paints with each of a pack's brushes, whose images can't
// be public. In flat colour: a stroke, and a flood under masking fluid alone, within a region and with a load, each
// with a stroke under a state of the fluid built on the flood's. In its style's medium and paper (`wash`): a flood
// and a stroke in a wash on dry paper, and again on paper prepared wet with a drop of water near the flood's edge, so
// its barrier, rim and bloom are held. Its baselines sit in ignored work/validation/.

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampBrushProbeMedium } from '#lib/paint/brush-packs/models/stamp-brush-profile-probes.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { stampBloom } from '#lib/paint/painting/models/stamp-wet-techniques.ts';
import type { StampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampGatePainting } from './stamp-gate-paintings.ts';

/** The cases painted black on white in flat colour, what each brush's own shape and the masks do. */
export const STAMP_GATE_PRIVATE_FLAT_CASES = ['stroke', 'flood', 'within', 'load'] as const;
export type StampGatePrivateCase = (typeof STAMP_GATE_PRIVATE_FLAT_CASES)[number] | 'wash';

export const STAMP_GATE_PRIVATE_SIZE = { width: 640, height: 420 };
/** When each case is painted; a painting reads the same at any time. */
export const STAMP_GATE_PRIVATE_TIME = 1;

const black = { kind: 'color', color: '#000000' } as const;

/**
 * A flat case's painting of `brush`, a glaze of black on white. Past the stroke: a flood under a ragged reserve half
 * lifted on its right; apart from it, so neither's paint lies on the other, a stroke under a state built on the
 * flood's with two more ops (a soft ragged band, a global lift).
 */
function stampGatePrivateFlatRecipe(brush: StampBrush, privateCase: Exclude<StampGatePrivateCase, 'wash'>): StampPaintRecipe {
  return stampPaintRecipe({ paper: { color: '#ffffff' }, mixing: { kind: 'flat' } }, (paint) => paint.group('g', { composite: 'glaze', opacity: 1 }, (group) => {
    if (privateCase === 'stroke') {
      group.passage('p', {}, (pass) => pass.stroke('s', { brush, well: { paint: black }, size: 60, path: [{ x: 60, y: 60 }, { x: 460, y: 80 }, { x: 440, y: 340 }, { x: 80, y: 360 }] }));
      return;
    }
    group.mask('reserve', { region: { kind: 'ellipse', x: 240, y: 200, radiusX: 90, radiusY: 70 }, edge: { soft: 2, ragged: { amount: 6, scale: 14 } } });
    group.unmask('lift', { region: { kind: 'polygon', points: [{ x: 240, y: 120 }, { x: 350, y: 120 }, { x: 350, y: 300 }, { x: 240, y: 300 }] }, amount: 0.5 });
    const within = privateCase === 'within' ? { kind: 'polygon' as const, points: [{ x: 40, y: 30 }, { x: 460, y: 60 }, { x: 440, y: 390 }, { x: 60, y: 370 }] } : undefined;
    group.passage('p', { ...(within && { within: { region: within } }) }, (pass) => {
      const fill = {
        brush, well: { paint: black }, size: 60, direction: 0.3, application: { kind: 'flood' as const },
        region: { kind: 'polygon' as const, points: [{ x: 30, y: 60 }, { x: 290, y: 20 }, { x: 470, y: 110 }, { x: 450, y: 400 }, { x: 240, y: 330 }, { x: 60, y: 400 }] },
        ...(privateCase === 'load' && { load: { kind: 'linear' as const, from: { x: 30, y: 0, value: 1 }, to: { x: 470, y: 0, value: 0.3 } } }),
      };
      pass.fill('f', fill);
      pass.mask('band', { region: { kind: 'polygon', points: [{ x: 500, y: 180 }, { x: 630, y: 170 }, { x: 630, y: 230 }, { x: 500, y: 240 }] }, edge: { soft: 4, ragged: { amount: 5, scale: 10 } } });
      pass.unmask('ease', { amount: 0.3 });
      pass.stroke('s', { brush, well: { paint: black }, size: 50, path: [{ x: 560, y: 40 }, { x: 575, y: 380 }] });
    });
  }));
}

/** The flood each half of the wash case paints, `dx` px across: its left side runs near-straight, so a drop sits by it. */
const washFloodOf = (dx: number): StampPoint[] => [[20, 50], [250, 30], [270, 250], [150, 300], [30, 270]].map(([x, y]) => ({ x: x + dx, y }));

/**
 * The wash case's painting of `brush` in `medium`'s paper and mixing with `paint`, a glaze: on the left, a flood and
 * a stroke below it in a wash on dry paper; on the right the same on paper prepared wet past both, and a drop of
 * water just inside the flood's left side, its bloom reaching the outline.
 */
function stampGatePrivateWashRecipe(brush: StampBrush, { paper, mixing }: StampBrushProbeMedium, paint: PaintMaterial): StampPaintRecipe {
  const half = STAMP_GATE_PRIVATE_SIZE.width / 2, { height } = STAMP_GATE_PRIVATE_SIZE;
  return stampPaintRecipe({ paper, mixing }, (painting) => [0, half].forEach((dx) => {
    const prewet = dx > 0, sheet = [{ x: dx + 5, y: 5 }, { x: dx + half - 5, y: 5 }, { x: dx + half - 5, y: height - 5 }, { x: dx + 5, y: height - 5 }];
    painting.group(prewet ? 'prewet' : 'dry', { composite: 'glaze', opacity: 1 }, (group) => group.passage('w', prewet ? { preparation: { region: { kind: 'polygon', points: sheet } } } : {}, (wash) => {
      wash.fill('f', { brush, well: { paint }, size: 50, direction: 0.3, application: { kind: 'flood' }, region: { kind: 'polygon', points: washFloodOf(dx) } });
      wash.stroke('s', { brush, well: { paint }, size: 40, path: [{ x: dx + 40, y: 350 }, { x: dx + 170, y: 375 }, { x: dx + 290, y: 360 }] });
      if (prewet) stampBloom(wash, 'drop', { brush, size: 30, at: [{ x: dx + 45, y: 150 }] });
    }));
  }));
}

/**
 * A case's painting of `brush` as the page draws it and its inputs are hashed, compiled: a flat case on white in flat
 * colour; the wash case on `medium`'s paper in its mixing, its paint at half strength so a rim and a bloom read.
 */
export function stampGatePrivatePainting(brush: StampBrush, privateCase: StampGatePrivateCase, medium: StampBrushProbeMedium): Omit<StampGatePainting, 'images'> {
  const at = { ...STAMP_GATE_PRIVATE_SIZE, t: STAMP_GATE_PRIVATE_TIME };
  if (privateCase !== 'wash') return { painting: compileStampPaintRecipe(stampGatePrivateFlatRecipe(brush, privateCase)), ...at };
  const { paint } = medium;
  if (paint.kind !== 'mixture') throw new Error(`stamp gate: ${brush.name}'s wash case needs a style that paints in pigment, as a wash does`);
  return { painting: compileStampPaintRecipe(stampGatePrivateWashRecipe(brush, medium, { ...paint, strength: 0.5 })), ...at };
}
