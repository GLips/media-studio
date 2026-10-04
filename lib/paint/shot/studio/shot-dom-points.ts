// shot-dom-points.ts: a PaintedShot's page as its paint reads it (ENGINE 6.3), once layout is final (whenLaidOut), as
// it loads and as each frame draws: whether HTML lies behind its first canvas, that every canvas fills its frame and
// a glaze reaches the HTML behind it, and where its pinned elements' centres lie in frame px. A pinned element
// (`data-pin`) resized so its centre moves draws its frame again.
//
// Negative space: an element moved with no re-render and no resize (a sibling's unsized image loading) isn't seen
// until the next frame draws. Whether HTML meant to lie over a canvas is positioned isn't checked: it can't be told
// from HTML lying outside the canvas's paint.

import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { shotCanvasLayings, shotPageProblems, type CompiledPaintedShot, type ShotCanvasLaying } from '../models/shot-compile.ts';
import { shotDomCentre, type ShotPinCentres } from '../models/shot-placement.ts';
import { shotCanvasStart, type ShotCanvasElements } from './shot-canvas.ts';

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
 * Whether HTML lies behind `canvas`, a PaintedShot's first, inside its element `holder`: text or a laid-out element
 * before it in document order, or a background on a wrapper holding it. What lies outside the shot doesn't count: a
 * clear back shows its shot's own HTML.
 */
export function shotHtmlBehind(holder: Element, canvas: ShotCanvasElements): boolean {
  const first = shotCanvasStart(canvas), walker = document.createTreeWalker(holder, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
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

/**
 * The computed styles that make an element the containing block of a fixed descendant, so a canvas inside it fills
 * it rather than the shot: each property, and whether its value does. An unsupported property reads ''.
 */
const SHOT_FIXED_HOLDERS: readonly (readonly [property: string, holds: (value: string) => boolean])[] = [
  ...['transform', 'translate', 'scale', 'rotate', 'perspective', 'filter', 'backdrop-filter', 'offset-path'].map((property) => [property, (value: string) => value !== 'none'] as const),
  ['contain', (value) => /\b(layout|paint|strict|content)\b/.test(value)],
  ['will-change', (value) => /\b(transform|translate|scale|rotate|perspective|filter)\b/.test(value)],
  ['container-type', (value) => value !== 'normal'],
  ['transform-style', (value) => value === 'preserve-3d'],
  ['content-visibility', (value) => value === 'auto'],
];

/** What in `style` holds a fixed descendant in its element's own box, as `property: value`, or null. */
function shotFixedHolding(style: CSSStyleDeclaration): string | null {
  for (const [property, holds] of SHOT_FIXED_HOLDERS) {
    const value = style.getPropertyValue(property);
    if (value && holds(value)) return `${property}: ${value}`;
  }
  return null;
}

/**
 * The computed styles past SHOT_FIXED_HOLDERS that make an element a stacking context, an isolated group: a glaze
 * canvas inside one is multiplied over the group alone, none of the HTML behind it. z-index is shotGlazeIsolating's.
 */
const SHOT_GLAZE_ISOLATORS: readonly (readonly [property: string, isolates: (value: string) => boolean])[] = [
  ['opacity', (value) => Number(value) < 1],
  ['mix-blend-mode', (value) => value !== 'normal'],
  ['isolation', (value) => value === 'isolate'],
  ['position', (value) => value === 'fixed' || value === 'sticky'],
  ['clip-path', (value) => value !== 'none'],
  ['mask-image', (value) => value !== 'none'],
  ['will-change', (value) => /\b(opacity|mix-blend-mode|isolation|z-index|clip-path|mask)\b/.test(value)],
];

/** What in `wrapper`'s `style` isolates what it holds from what lies behind it, as `property: value`, or null. */
function shotGlazeIsolating(wrapper: Element, style: CSSStyleDeclaration): string | null {
  for (const [property, isolates] of SHOT_GLAZE_ISOLATORS) {
    const value = style.getPropertyValue(property);
    if (value && isolates(value)) return `${property}: ${value}`;
  }
  // A z-index stacks only a positioned element or a flex or grid item.
  const container = wrapper.parentElement ? getComputedStyle(wrapper.parentElement).display : '';
  return style.zIndex !== 'auto' && (style.position !== 'static' || /flex|grid/.test(container)) ? `z-index: ${style.zIndex}` : null;
}

const rectText = (r: DOMRect) => `${r.left.toFixed(1)}, ${r.top.toFixed(1)} → ${r.right.toFixed(1)}, ${r.bottom.toFixed(1)}`;

/** Canvas `index`'s name in a problem, its PaintedShotCanvas's (`names`; none for the shot's own). */
const shotCanvasName = (names: readonly string[], index: number) => (names[index] === undefined ? "the shot's own canvas" : `PaintedShotCanvas ${names[index]}`);

/** The elements between `canvas` and `holder`, the shot's element, innermost first. */
function shotCanvasWrappers(holder: Element, { colour }: ShotCanvasElements): Element[] {
  const wrappers: Element[] = [];
  for (let wrapper = colour.parentElement; wrapper && wrapper !== holder; wrapper = wrapper.parentElement) wrappers.push(wrapper);
  return wrappers;
}

/**
 * Why `canvases` (named by `names`) don't each lie over `holder`, the shot's element, whole. A wrapper holding a
 * canvas in its box is refused even while it changes nothing (an identity transform about to slide).
 */
export function shotCanvasFillProblems(holder: Element, canvases: readonly ShotCanvasElements[], names: readonly string[]): PaintingProblem[] {
  const frame = holder.getBoundingClientRect();
  return canvases.flatMap((canvas, index) => {
    const problem = (message: string) => [paintingProblem('error', 'shot', 'canvas', `${shotCanvasName(names, index)} ${message}: a canvas fills its shot, so no wrapper between them is transformed, filtered or contained`)];
    for (const wrapper of shotCanvasWrappers(holder, canvas)) {
      const holding = shotFixedHolding(getComputedStyle(wrapper));
      if (holding) return problem(`lies in a <${wrapper.localName}> with ${holding}, which holds a fixed canvas in its own box`);
    }
    const box = canvas.colour.getBoundingClientRect();
    const strays = [box.left - frame.left, box.top - frame.top, box.right - frame.right, box.bottom - frame.bottom].some((d) => Math.abs(d) > SHOT_CANVAS_SLACK);
    return strays ? problem(`lies at ${rectText(box)} page px, and its PaintedShot at ${rectText(frame)}`) : [];
  });
}

/**
 * Why a glaze among `canvases` (named by `names`, laid as `layings` says) can't reach the HTML behind it: a wrapper
 * between it and `holder`, the shot's element, making a stacking context, which its multiply would stop at.
 */
export function shotGlazeIsolationProblems(holder: Element, canvases: readonly ShotCanvasElements[], names: readonly string[], layings: readonly ShotCanvasLaying[]): PaintingProblem[] {
  return canvases.flatMap((canvas, index) => {
    if (layings[index] !== 'glaze') return [];
    for (const wrapper of shotCanvasWrappers(holder, canvas)) {
      const isolating = shotGlazeIsolating(wrapper, getComputedStyle(wrapper));
      if (isolating) {
        return [paintingProblem('error', 'shot', 'canvas', `${shotCanvasName(names, index)} is a glaze over the HTML behind it, and lies in a <${wrapper.localName}> with ${isolating}, which isolates it from that HTML: no wrapper between a glaze canvas and its shot makes a stacking context`)];
      }
    }
    return [];
  });
}

/** The element names `shot`'s pinned planes pin to, by plane id: none without pins. */
function shotPinNames(shot: CompiledPaintedShot): ReadonlyMap<string, readonly string[]> {
  return new Map(shot.planes.flatMap((plane) => (plane.kind === 'painted' && plane.lay.kind === 'screen' && plane.lay.screen.kind === 'pin' ? [[plane.id, plane.lay.screen.points.map(({ element }) => element)] as const] : [])));
}

const sameCentre = (a: StampPoint | null, b: StampPoint | null) => a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01);

const sameCentres = (a: ShotPinCentres, b: ShotPinCentres) =>
  [...a].every(([id, centres]) => centres.every((centre, i) => sameCentre(centre, b.get(id)?.[i] ?? null)));

/** A shot's page, read as each frame draws, its pinned elements watched for resizes between. */
export type ShotPageWatch = {
  /**
   * The page as laid out now: why the frame can't be drawn over it, and each pinned element's centre in frame px (null
   * where it isn't rendered), remembered as the drawn one.
   */
  readonly read: () => { readonly pins: ShotPinCentres; readonly problems: readonly PaintingProblem[] };
  readonly dispose: () => void;
};

/**
 * `shot`'s page in `holder`, its element, over `canvases` (named by `names`); `moved` called when a pinned element
 * resizes so its centre leaves where the last frame drew it. Each pinned element is watched from the frame that first
 * finds it.
 */
export function createShotPageWatch(holder: Element, canvases: readonly ShotCanvasElements[], names: readonly string[], shot: CompiledPaintedShot, moved: () => void): ShotPageWatch {
  const pins = shotPinNames(shot), observed = new Set<Element>();
  let drawn: ShotPinCentres | null = null;
  const observer = pins.size ? new ResizeObserver(() => {
    if (drawn && !sameCentres(measure().centres, drawn)) moved();
  }) : null;
  function measure() {
    const box = holder.getBoundingClientRect(), problems: PaintingProblem[] = [];
    const centres: ShotPinCentres = new Map([...pins].map(([id, elements]) => [id, elements.map((element, i) => {
      const found = holder.querySelectorAll(`[data-pin="${CSS.escape(element)}"]`), [only] = found;
      if (found.length > 1) problems.push(paintingProblem('error', id, `lay.points[${i}].element`, `names ${element}, the data-pin of ${found.length} elements in the shot: a pin names one`));
      if (found.length !== 1 || !only.getClientRects().length) return null;
      if (observer && !observed.has(only)) {
        observed.add(only);
        observer.observe(only);
      }
      return shotDomCentre(only.getBoundingClientRect(), box, shot.camera.stage.frame);
    })]));
    return { centres, problems };
  }
  return {
    read: () => {
      const { centres, problems } = measure();
      drawn = centres;
      const page = shot.clearBack ? shotPageProblems(shot, { htmlBehind: shotHtmlBehind(holder, canvases[0]) }) : [];
      const placed = [...shotCanvasFillProblems(holder, canvases, names), ...shotGlazeIsolationProblems(holder, canvases, names, shotCanvasLayings(shot))];
      return { pins: centres, problems: [...placed, ...page, ...problems] };
    },
    dispose: () => observer?.disconnect(),
  };
}
