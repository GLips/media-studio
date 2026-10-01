// stamp-gate-live.ts: the GPU gate's live check (animation/live). A live group's marks, compiled from its posed
// geometry, are drawn in place of the group as written, with their own wetness, regions and wet stages; that frame
// must be the painting compiled with that pose, and the painting drawn as written after it must be as before.

import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { compileStampPaintRecipe, stampPaintRecipe, type StampPaintPaper } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import { stampGateFrameDifference, stampGateFramePasses } from './stamp-gate-frames.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import type { StampGateWashCheck } from './stamp-gate-washes.ts';

type Rgba = ArrayLike<number>;
const SIZE = { width: 240, height: 160 };
const PAPER: StampPaintPaper = { color: '#fbf7ee', grain: { image: { style: 'gate', pack: 'gate', file: 'grain.png' }, scale: 0.2, depth: 0.7 } };
const mixture = (...parts: { pigment: PaintPigmentAppearance; amount: number }[]): PaintMaterial => ({ kind: 'mixture', parts, strength: 0.8 });

/** How far the sac is posed from where it's written, px: down and right, so every region it has moves. */
export const STAMP_GATE_LIVE_POSE = { x: 14, y: 9 };

/**
 * A sky, then a sac posed `pose` px from its rest: a wash with a glint reserved by fluid, a bloom dropped into it and a
 * shade kept `within` it; then a stroke over both, a group drawn after the live one.
 */
export function stampGateLivePainting(pose = { x: 0, y: 0 }): StampGatePainting {
  const steady = stampGateBrush('Steady', { flow: 0.6 }), x = 110 + pose.x, y = 76 + pose.y;
  const painting = compileStampPaintRecipe(stampPaintRecipe((p) => {
    p.group('sky', { composite: 'glaze', opacity: 1 }, (g) => g.pass('wash', {}, (pass) => pass.fill('sky', {
      brush: steady, diameter: 40, application: { kind: 'flood' }, material: mixture({ pigment: W.ultramarine, amount: 0.6 }), region: stampGatePolygon(0, 0, 240, 0, 240, 160, 0, 160),
    })));
    p.group('sac', { composite: 'opaque' }, (g) => {
      g.mask('glint', { region: { kind: 'ellipse', x: x - 18, y: y - 10, radiusX: 9, radiusY: 6 }, edge: { soft: 2 } });
      g.wash('skin', {}, (w) => {
        w.fill('skin', {
          brush: steady, diameter: 24, application: { kind: 'flood' }, material: mixture({ pigment: W.yellowOchre, amount: 0.7 }, { pigment: W.burntSienna, amount: 0.3 }),
          region: { kind: 'ellipse', x, y, radiusX: 52, radiusY: 34 },
        });
        w.bloom('drop', { brush: steady, diameter: 22, at: [{ x: x + 16, y: y + 8 }] });
      });
      g.pass('shade', { within: { kind: 'ellipse', x, y, radiusX: 52, radiusY: 34 } }, (pass) => pass.stroke('shade', {
        brush: steady, diameter: 14, material: mixture({ pigment: W.burntSienna, amount: 1 }), path: [{ x: x - 60, y: y + 22 }, { x: x + 60, y: y + 28 }],
      }));
    });
    p.group('over', { composite: 'glaze', opacity: 0.8 }, (g) => g.pass('line', {}, (pass) => pass.stroke('line', {
      brush: steady, diameter: 8, material: mixture({ pigment: W.ultramarine, amount: 1 }, { pigment: W.burntSienna, amount: 1 }), path: [{ x: 20, y: 130 }, { x: 220, y: 40 }],
    })));
  }));
  return { painting, paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W }, ...SIZE, t: 0, images: STAMP_GATE_IMAGES };
}

/** The frame state drawing the rest painting's sac live, posed STAMP_GATE_LIVE_POSE. */
export const stampGateLiveState = (): StampPaintFrameState => new Map([['sac', { live: { marks: stampGateLivePainting(STAMP_GATE_LIVE_POSE).painting.groups[1], key: 'posed' } }]]);

/**
 * Whether the rest painting with its sac live and posed draws the posed painting's frame (`live` against `posed`), and
 * drawn as written after that, its first frame again (`again` against `rest`), each within a frame's tolerance; and
 * whether the pose moved anything, so the check bites.
 */
export function checkStampGateLive({ rest, live, again, posed }: { rest: Rgba; live: Rgba; again: Rgba; posed: Rgba }): StampGateWashCheck {
  const asPosed = stampGateFrameDifference(live, posed), asBefore = stampGateFrameDifference(again, rest), moved = stampGateFrameDifference(rest, posed);
  return {
    id: 'animation/live: live marks draw as the painting compiled with them, and leave the painting as written', passed: stampGateFramePasses(asPosed) && stampGateFramePasses(asBefore) && moved.max > 20,
    detail: `live against compiled posed: max ${asPosed.max}, mean ${asPosed.mean.toFixed(4)}; as written after it against before: max ${asBefore.max}, mean ${asBefore.mean.toFixed(4)}; the pose moves up to ${moved.max} levels (20 or less fails)`,
  };
}
