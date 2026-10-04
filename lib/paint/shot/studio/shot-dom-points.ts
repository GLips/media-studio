// shot-dom-points.ts: a PaintedShot's page as its paint reads it (ENGINE 6.3), once layout is final (whenLaidOut):
// whether HTML lies behind its first canvas, that every canvas fills its frame, and where its pinned elements' centres
// lie in frame px. Pins are measured as each frame is drawn, and again when the shot or a pinned element resizes.
//
// Negative space: an element moved with no re-render and no resize (a sibling's unsized image loading) isn't seen
// until the next frame draws.

import type { RefObject } from 'react';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { CompiledPaintedShot } from '../models/shot-compile.ts';
import { shotDomCentre, type ShotPinCentres } from '../models/shot-placement.ts';

type ShotFrameSize = { readonly width: number; readonly height: number };

/** How far a canvas's box may stray from its shot's, page px: a scaled layout's rounding. */
const SHOT_CANVAS_SLACK = 0.5;

/** Whether a computed colour is clear: the browser writes a clear one with an alpha of 0, `rgba(…, 0)` or `…/ 0)`. */
const paintsNothing = (color: string) => color === 'transparent' || /^rgba\(.*,\s*0\)$|\/\s*0\)$/.test(color);

/** Whether `ancestor` shows anything of its own behind what it holds: a background colour or image. */
function paintsBackground(ancestor: Element): boolean {
  const style = getComputedStyle(ancestor);
  return !paintsNothing(style.backgroundColor) || style.backgroundImage !== 'none';
}

/**
 * Whether HTML lies behind `first`, a PaintedShot's first canvas, inside its element `holder`: text or a laid-out
 * element before it in document order, or a background on a wrapper holding it. What lies outside the shot doesn't
 * count: a clear back shows its shot's own HTML.
 */
export function shotHtmlBehind(holder: Element, first: Element): boolean {
  const walker = document.createTreeWalker(holder, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && node !== first; node = walker.nextNode()) {
    if (node instanceof Text) {
      if (node.data.trim() && node.parentElement?.getClientRects().length) return true;
    } else if (node instanceof Element) {
      if (node.contains(first)) {
        if (paintsBackground(node)) return true;
        continue;
      }
      const { width, height } = node.getBoundingClientRect();
      if (width > 0 && height > 0) return true;
    }
  }
  return false;
}

const rectText = (r: DOMRect) => `${r.left.toFixed(1)}, ${r.top.toFixed(1)} → ${r.right.toFixed(1)}, ${r.bottom.toFixed(1)}`;

/**
 * Throws unless each of `canvases` lies over `holder`'s whole box, `names` naming them (none for the shot's own). A
 * canvas is fixed to its shot's element, which a transformed, filtered or contained wrapper between them takes over.
 */
export function assertShotCanvasesFill(holder: Element, canvases: readonly HTMLCanvasElement[], names: readonly string[]): void {
  const shot = holder.getBoundingClientRect();
  canvases.forEach((canvas, index) => {
    const box = canvas.getBoundingClientRect(), name = names[index] === undefined ? "the shot's own canvas" : `PaintedShotCanvas ${names[index]}`;
    const strays = [box.left - shot.left, box.top - shot.top, box.right - shot.right, box.bottom - shot.bottom].some((d) => Math.abs(d) > SHOT_CANVAS_SLACK);
    if (strays) {
      throw new Error(`${name} lies at ${rectText(box)} page px, and its PaintedShot at ${rectText(shot)}: a canvas fills its shot, so no wrapper between them may be transformed, filtered or contained (each holds a fixed canvas in its own box)`);
    }
  });
}

/** The elements `shot`'s pinned planes pin to, by plane id: none without pins. */
function shotPinElements(shot: CompiledPaintedShot): ReadonlyMap<string, readonly RefObject<Element | null>[]> {
  return new Map(shot.planes.flatMap((plane) => (plane.kind === 'painted' && plane.lay.kind === 'pinned' ? [[plane.id, plane.lay.pin.points.map(({ element }) => element)] as const] : [])));
}

const sameCentre = (a: StampPoint | null, b: StampPoint | null) => a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01);

const sameCentres = (a: ShotPinCentres, b: ShotPinCentres) =>
  [...a].every(([id, centres]) => centres.every((centre, i) => sameCentre(centre, b.get(id)?.[i] ?? null)));

/** A shot's pinned elements, measured on asking and watched for resizes between. */
export type ShotPinWatch = {
  /** Each pinned element's centre in frame px as laid out now, remembered as the drawn one: null where it isn't rendered. */
  readonly measure: () => ShotPinCentres;
  readonly dispose: () => void;
};

/**
 * `shot`'s pins measured against `holder`, its element, `frame` px wide and high; `moved` called when a resize moves
 * one from where it was last measured. Observes the elements mounted as it starts: one mounted later is measured as
 * frames draw.
 */
export function createShotPinWatch(holder: Element, frame: ShotFrameSize, shot: CompiledPaintedShot, moved: () => void): ShotPinWatch {
  const pins = shotPinElements(shot);
  const centresNow = (): ShotPinCentres => {
    const box = holder.getBoundingClientRect();
    return new Map([...pins].map(([id, elements]) => [id, elements.map(({ current }) => (current?.isConnected && current.getClientRects().length ? shotDomCentre(current.getBoundingClientRect(), box, frame) : null))]));
  };
  let drawn: ShotPinCentres | null = null;
  const observer = pins.size ? new ResizeObserver(() => {
    if (drawn && !sameCentres(centresNow(), drawn)) moved();
  }) : null;
  if (observer) for (const element of [holder, ...[...pins.values()].flatMap((elements) => elements.flatMap(({ current }) => (current ? [current] : [])))]) observer.observe(element);
  return {
    measure: () => (drawn = centresNow()),
    dispose: () => observer?.disconnect(),
  };
}
