// stamp-gate-bend.ts: the GPU gate's bend (part of animation/warp). A drift and a field moving nothing are affine;
// this shears a wet hull, its reserve and bloom, so a lattice that only carried affine maps, or lost the mask or the
// wet paint as it resampled, shows.

import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type StampPaintPaper } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';

type Rgba = ArrayLike<number>;
const SIZE = { width: 240, height: 160 };
const PAPER: StampPaintPaper = {
  color: '#fbf7ee', grain: { image: { style: 'gate', pack: 'gate', file: 'grain.png' }, scale: 0.2, depth: 0.7 }, image: { style: 'gate', pack: 'gate', file: 'photograph.png' },
};
const steadyBrush = () => stampGateBrush('Steady', { flow: 0.6 });
const mixture = (...parts: { pigment: PaintPigmentAppearance; amount: number }[]): PaintMaterial => ({ kind: 'mixture', parts, strength: 0.8 });
const disc = ({ x, y }: { x: number; y: number }, r: number) => ({ kind: 'ellipse' as const, x, y, radiusX: r, radiusY: r });

/**
 * The bend: rest column `x` moved down `shift` px, none of it left of `from`, all of it right of `to`, eased between
 * (a shear, not an affine map). Either side a lattice carries it exactly, so the paint there can be compared.
 */
export const STAMP_GATE_BEND = { from: 90, to: 150, shift: 12 };
const BEND_HULL = { x: 120, y: 80, radiusX: 105, radiusY: 30 }, BEND_RESERVE = { x: 190, y: 82 };
const bendShift = (x: number, shift: number) => {
  const { from, to } = STAMP_GATE_BEND, u = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return (shift * (1 - Math.cos(Math.PI * u))) / 2;
};
const bentBy = (shift: number) => (): StampPaintFrameState => new Map([['cut-out', { warp: { map: ({ x, y }) => ({ x, y: y + bendShift(x, shift) }), key: `bend ${shift}` } }]]);

/**
 * A sky under an opaque hull on its own paper, painted wet: a flood round masking fluid's reserve, a bloom dropped in.
 * Bent `shift` px by STAMP_GATE_BEND's shear, or left still.
 */
export function stampGateBendPainting(shift: number | null): StampGatePainting {
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('sky', { composite: 'glaze', opacity: 1 }, (g) => g.pass('wash', {}, (pass) => pass.fill('sky', {
      brush: steadyBrush(), diameter: 40, application: { kind: 'flood' }, material: mixture({ pigment: W.ultramarine, amount: 1 }), region: stampGatePolygon(0, 0, 240, 0, 240, 160, 0, 160),
    })));
    p.group('cut-out', { composite: 'opaque', paper: 'own' }, (g) => g.wash('wet', {}, (w) => {
      w.mask('reserve', { region: disc(BEND_RESERVE, 9) });
      w.fill('hull', { brush: steadyBrush(), diameter: 24, application: { kind: 'flood' }, region: { kind: 'ellipse', ...BEND_HULL }, material: mixture({ pigment: W.ultramarine, amount: 1 }, { pigment: W.burntSienna, amount: 1 }) });
      w.bloom('drop', { brush: steadyBrush(), diameter: 20, at: [{ x: 45, y: 78 }] });
    }));
  }));
  return { painting, paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W }, ...SIZE, t: 0, images: STAMP_GATE_IMAGES, ...(shift !== null && { frameAt: bentBy(shift) }) };
}

/**
 * Where the bend's hull wholly covers the sky, as a test of a rest pixel. The reserve's hole shows the still sky
 * through it, so it's left out; the paint round it, which the fluid shaped, is kept.
 */
const coveredByBend = (x: number, y: number) => ((x - BEND_HULL.x) / (BEND_HULL.radiusX - 20)) ** 2 + ((y - BEND_HULL.y) / (BEND_HULL.radiusY - 10)) ** 2 <= 1
  && Math.hypot(x - BEND_RESERVE.x, y - BEND_RESERVE.y) > 9 + 3;

/**
 * The most the bent hull differs, either side of the bend, from the still one where the lattice moves it exactly
 * (left: not at all; right: STAMP_GATE_BEND's shift down), over its body: its wet paint, bloom and reserve.
 */
export function stampGateBendCarried(still: Rgba, bent: Rgba, width: number) {
  const { from, to, shift } = STAMP_GATE_BEND;
  let left = 0, right = 0;
  for (let y = 0; y + shift < SIZE.height; y++) for (let x = 0; x < width; x++) {
    if (!coveredByBend(x, y) || (x >= from - 2 && x <= to + 2)) continue;
    const dy = x < from ? 0 : shift;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(bent[((y + dy) * width + x) * 4 + c] - still[(y * width + x) * 4 + c]);
      if (x < from) left = Math.max(left, d);
      else right = Math.max(right, d);
    }
  }
  return { left, right };
}
