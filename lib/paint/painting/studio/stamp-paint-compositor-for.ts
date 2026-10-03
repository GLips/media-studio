// stamp-paint-compositor-for.ts: which compositor a painting mixes in, chosen before anything is loaded so a painting
// it can't mix fails first. A renderer of a painting and a wash solver of a document alike start here.

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { PAINT_BANDS } from '#lib/paint/materials/models/paint-spectrum.ts';
import type { CompiledStampPaint } from '../models/stamp-paint-recipe-compile.ts';
import { compileStampPigmentPaint, stampPigmentGroupMedium } from '../models/stamp-pigment-paint.ts';
import { stampPaintMedia, type StampPaintMedia } from '../models/stamp-wetness.ts';
import { flatStampPaintCompositor, type StampPaintCompositor } from './stamp-paint-compositor.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';
import { stampPigmentCompositor } from './stamp-paint-pigment-compositor.ts';

/**
 * A painting's compositor, made on a device as it loads, its media binding, and whether its washes land: only
 * pigment's do, each group in a medium.
 */
export type StampPaintCompositorChoice = { compositorOn: (device: StampPaintDevice) => StampPaintCompositor } & (
  | { wet: true; media: StampPaintMedia<PaintMedium> }
  | { wet: false; media: StampPaintMedia<null> }
);

/**
 * How `painting`'s mixing composites it, on its paper. Flat colour has no media, so it refuses a group naming a
 * mixing of its own, and lays no wash.
 */
export function stampPaintCompositorFor(painting: CompiledStampPaint): StampPaintCompositorChoice {
  const { mixing, paper } = painting;
  if (mixing.kind === 'pigment') {
    const paint = compileStampPigmentPaint(painting, mixing, PAINT_BANDS);
    const media = stampPaintMedia(painting, (group) => stampPigmentGroupMedium(paint, painting, group));
    return { compositorOn: (device) => stampPigmentCompositor(device, paint, paper.color), media, wet: true };
  }
  for (const { id, mixing: own } of painting.groups) {
    if (own) throw new Error(`stamp paint: group ${id} paints in ${own.medium.name}, but its style mixes in flat colour, which has no media; paint it in a pigment style`);
  }
  const flat = flatStampPaintCompositor(painting);
  return { compositorOn: () => flat, media: stampPaintMedia(painting, () => null), wet: false };
}
