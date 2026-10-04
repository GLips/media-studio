// shot-canvas.ts: a PaintedShot's element and its canvases, from the page to their surfaces on the owner's device. A
// canvas is two elements, a filter then its colour: an opaque canvas draws in its colour alone, its filter hidden; a
// glaze draws in both, each premultiplied, the lens developing them together (lens-passes.ts's glaze). PaintedShot,
// PaintedShotCanvas and the gate make every shot element and canvas here, so the page checked is the page drawn.

import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintSurface, type StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import type { ShotCanvasLaying } from '../models/shot-compile.ts';

/**
 * A shot's element at `box` (page or composition px), the frame `frame` px scaled to fill it. Its transform makes it
 * the containing block of the fixed canvases it holds. Isolated, so a glaze's multiply stops at it: the page outside
 * the shot is never filtered per channel, only seen through a canvas's alpha.
 */
export function shotElementStyle(box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }, frame: { readonly width: number; readonly height: number }) {
  return {
    position: 'absolute', left: `${box.x}px`, top: `${box.y}px`, width: `${frame.width}px`, height: `${frame.height}px`, overflow: 'hidden',
    transform: `scale(${box.w / frame.width}, ${box.h / frame.height})`, transformOrigin: '0 0', isolation: 'isolate',
  } as const;
}

/**
 * A shot canvas's element: fixed to the shot's element, so each fills the frame however deep it's nested.
 * Positioned, a canvas paints over HTML that isn't: HTML lying over one is positioned.
 */
const SHOT_CANVAS_STYLE = { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' } as const;

/** A shot canvas's filter element: what lies behind it inside the shot's element is multiplied by it. */
const SHOT_FILTER_CANVAS_STYLE = { ...SHOT_CANVAS_STYLE, mixBlendMode: 'multiply' } as const;

/**
 * A shot canvas's elements, siblings: `filter`, then `colour` over it. An opaque canvas draws only in `colour`, its
 * filter hidden; a glaze draws in both (ShotCanvasLaying).
 */
export type ShotCanvasElements = { readonly filter: HTMLCanvasElement; readonly colour: HTMLCanvasElement };

/** A shot canvas's elements, styled, on no page: one drawn off the page reads back what it's drawn. */
export function createShotCanvasElements(): ShotCanvasElements {
  const [filter, colour] = [SHOT_FILTER_CANVAS_STYLE, SHOT_CANVAS_STYLE].map((style) => {
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, style);
    return canvas;
  });
  return { filter, colour };
}

/**
 * A new shot canvas's elements placed in `host`, an element of their own that makes no box (display: contents), so
 * they lie where it does among the shot's HTML.
 */
export function placeShotCanvas(host: HTMLElement): ShotCanvasElements {
  host.style.display = 'contents';
  const canvas = createShotCanvasElements();
  host.append(canvas.filter, canvas.colour);
  return canvas;
}

/** Takes `canvas`'s elements off the page. */
export function removeShotCanvas({ filter, colour }: ShotCanvasElements) {
  filter.remove();
  colour.remove();
}

/** Where `canvas` begins on the page: what lies before this in document order lies behind it. */
export const shotCanvasStart = ({ filter }: ShotCanvasElements): Element => filter;

/** Canvases in page order, for a sort: negative when `a` lies before `b`. */
export const shotCanvasPageOrder = (a: ShotCanvasElements, b: ShotCanvasElements) =>
  (shotCanvasStart(a).compareDocumentPosition(shotCanvasStart(b)) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);

/** A shot canvas's surfaces, laid as `laying` says: `colour`, and a glaze's `filter`, under it, the page multiplied by it. */
export type ShotCanvasSurface =
  | { readonly laying: 'opaque'; readonly colour: StampPaintSurface }
  | { readonly laying: 'glaze'; readonly colour: StampPaintSurface; readonly filter: StampPaintSurface };

/** Every surface `surface` draws into: its colour, and a glaze's filter. */
export const shotCanvasPaintSurfaces = (surface: ShotCanvasSurface): StampPaintSurface[] => (surface.laying === 'glaze' ? [surface.colour, surface.filter] : [surface.colour]);

/** `elements` sized `width` × `height` and configured on `owner`'s device as `laying` says, one after another. */
export async function createShotCanvasSurface(
  owner: StampPaintGpuOwner, { filter, colour }: ShotCanvasElements, laying: ShotCanvasLaying, { width, height }: { readonly width: number; readonly height: number },
): Promise<ShotCanvasSurface> {
  filter.style.display = laying === 'glaze' ? '' : 'none';
  Object.assign(colour, { width, height });
  if (laying === 'opaque') return { laying, colour: await createStampPaintSurface(owner, { canvas: colour, width, height, alphaMode: 'opaque' }) };
  Object.assign(filter, { width, height });
  const under = await createStampPaintSurface(owner, { canvas: filter, width, height, alphaMode: 'premultiplied' });
  return { laying, colour: await createStampPaintSurface(owner, { canvas: colour, width, height, alphaMode: 'premultiplied' }), filter: under };
}

/** Unconfigures `surface`'s canvases; the owner stays. */
export function disposeShotCanvasSurface(surface: ShotCanvasSurface) {
  for (const each of shotCanvasPaintSurfaces(surface)) each.dispose();
}
