// shot-canvas-surface.ts: a shot canvas's surfaces on its owner's device, laid as shotCanvasLaying says. An opaque
// canvas draws in its colour canvas alone, its filter hidden; a glaze draws in both, each premultiplied, the lens
// developing them together (lens-passes.ts's glaze).

import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintSurface, type StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import type { ShotCanvasLaying } from '../models/shot-compile.ts';
import type { ShotCanvasElements } from './shot-dom-points.ts';

/** A shot canvas's surfaces: `colour`, and a glaze's `filter`, the canvas under it the page is multiplied by (null when opaque). */
export type ShotCanvasSurface = { readonly colour: StampPaintSurface; readonly filter: StampPaintSurface | null };

/** `elements` sized `width` × `height` and configured on `owner`'s device as `laying` says, one after another. */
export async function createShotCanvasSurface(
  owner: StampPaintGpuOwner, { filter, colour }: ShotCanvasElements, laying: ShotCanvasLaying, { width, height }: { readonly width: number; readonly height: number },
): Promise<ShotCanvasSurface> {
  filter.style.display = laying === 'glaze' ? '' : 'none';
  if (laying === 'opaque') {
    Object.assign(colour, { width, height });
    return { colour: await createStampPaintSurface(owner, { canvas: colour, width, height, alphaMode: 'opaque' }), filter: null };
  }
  Object.assign(filter, { width, height });
  Object.assign(colour, { width, height });
  const under = await createStampPaintSurface(owner, { canvas: filter, width, height, alphaMode: 'premultiplied' });
  return { colour: await createStampPaintSurface(owner, { canvas: colour, width, height, alphaMode: 'premultiplied' }), filter: under };
}

/** Unconfigures `surface`'s canvases; the owner stays. */
export function disposeShotCanvasSurface({ colour, filter }: ShotCanvasSurface) {
  colour.dispose();
  filter?.dispose();
}
