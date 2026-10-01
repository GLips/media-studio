// stamp-gate-live.ts: the GPU gate's live check (animation/live). A live group's marks, compiled from its posed
// geometry, are drawn in place of the group as written, with their own wetness, regions and wet stages; that frame
// must be the painting compiled with that pose, and the painting drawn as written after it must be as before.

import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import type { PaintPigmentAppearance } from '#lib/paint/materials/models/paint-pigment.ts';
import { WATERCOLOUR_PIGMENTS as W } from '#lib/paint/materials/models/paint-watercolour-pigments.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { compileStampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPaintPaper } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import { stampGateFrameDifference, stampGateFramePasses } from './stamp-gate-frames.ts';
import { STAMP_GATE_IMAGES, stampGateBrush, stampGatePolygon, type StampGatePainting } from './stamp-gate-paintings.ts';
import type { StampGateWashCheck } from './stamp-gate-layer.ts';
import { stampBloom } from '#lib/paint/painting/models/stamp-wet-techniques.ts';

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
  const painting = compileStampPaintRecipe(stampPaintRecipe({ paper: PAPER, mixing: { kind: 'pigment', medium: PAINT_MEDIA.watercolour, pigments: W } }, (p) => {
    p.group('sky', { composite: 'glaze', opacity: 1 }, (g) => g.passage('wash', { wetHistory: false }, (pass) => pass.fill('sky', {
      brush: steady, size: 40, application: { kind: 'flood' }, well: { paint: mixture({ pigment: W.ultramarine, amount: 0.6 }) }, region: stampGatePolygon(0, 0, 240, 0, 240, 160, 0, 160),
    })));
    p.group('sac', { composite: 'opaque' }, (g) => {
      g.mask('glint', { region: { kind: 'ellipse', x: x - 18, y: y - 10, radiusX: 9, radiusY: 6 }, edge: { soft: 2 } });
      g.passage('skin', {}, (w) => {
        w.fill('skin', {
          brush: steady, size: 24, application: { kind: 'flood' }, well: { paint: mixture({ pigment: W.yellowOchre, amount: 0.7 }, { pigment: W.burntSienna, amount: 0.3 }) },
          region: { kind: 'ellipse', x, y, radiusX: 52, radiusY: 34 },
        });
        stampBloom(w, 'drop', { brush: steady, size: 22, at: [{ x: x + 16, y: y + 8 }] });
      });
      g.passage('shade', { within: { region: { kind: 'ellipse', x, y, radiusX: 52, radiusY: 34 } }, wetHistory: false }, (pass) => pass.stroke('shade', {
        brush: steady, size: 14, well: { paint: mixture({ pigment: W.burntSienna, amount: 1 }) }, path: [{ x: x - 60, y: y + 22 }, { x: x + 60, y: y + 28 }],
      }));
    });
    p.group('over', { composite: 'glaze', opacity: 0.8 }, (g) => g.passage('line', { wetHistory: false }, (pass) => pass.stroke('line', {
      brush: steady, size: 8, well: { paint: mixture({ pigment: W.ultramarine, amount: 1 }, { pigment: W.burntSienna, amount: 1 }) }, path: [{ x: 20, y: 130 }, { x: 220, y: 40 }],
    })));
  }));
  return { painting, ...SIZE, t: 0, images: STAMP_GATE_IMAGES };
}

/** The frame state drawing the rest painting's sac live, posed STAMP_GATE_LIVE_POSE. */
export const stampGateLiveState = (): StampPaintFrameState => new Map([['sac', { marks: { kind: 'live', marks: stampGateLivePainting(STAMP_GATE_LIVE_POSE).painting.groups[1], key: 'posed' } }]]);

/**
 * Whether the rest painting with its sac live and posed draws the posed painting's frame (`live` against `posed`); drawn
 * at the same live key again, laid from its film, exactly that (`held`); and drawn as written after, its
 * first frame again (`again` against `rest`); and whether the pose moved anything, so the check bites.
 */
export function checkStampGateLive({ rest, live, held, again, posed }: { rest: Rgba; live: Rgba; held: Rgba; again: Rgba; posed: Rgba }): StampGateWashCheck {
  const asPosed = stampGateFrameDifference(live, posed), asHeld = stampGateFrameDifference(held, live);
  const asBefore = stampGateFrameDifference(again, rest), moved = stampGateFrameDifference(rest, posed);
  return {
    id: 'animation/live: live marks draw as the painting compiled with them, restore as drawn, and leave the painting as written',
    passed: stampGateFramePasses(asPosed) && asHeld.max === 0 && stampGateFramePasses(asBefore) && moved.max > 20,
    detail: `live against compiled posed: max ${asPosed.max}, mean ${asPosed.mean.toFixed(4)}; held at its key against live: max ${asHeld.max} (over 0 fails); `
      + `as written after it against before: max ${asBefore.max}, mean ${asBefore.mean.toFixed(4)}; the pose moves up to ${moved.max} levels (20 or less fails)`,
  };
}
