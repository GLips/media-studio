// still-probe.tsx: measures a still for lib/models/still/still-check.ts and hands it to lib/engine/render/render-stills.ts as an artifact: every
// element's own text and every <img>, found in the DOM as drawn, so a design needs no markup of its own for the check.
// It only measures; what's a problem is decided in Node, beside the pixels of the ground pass.
//
// SVG text and CSS background images are not measured.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AbsoluteFill, Artifact, useDelayRender, useVideoConfig } from 'remotion';
import type { StillImageMark, StillMeasure, StillTextMark } from '#models/still/still-check.ts';
import type { Rect } from '#models/camera/camera.ts';
import { whenLaidOut } from '../probe/screen-rect.ts';
import { STILL_MEASURE_ARTIFACT } from '#models/still/still-presets.ts';

type ClientRect = { left: number; top: number; right: number; bottom: number };

function effectiveOpacity(el: Element, root: Element) {
  let opacity = 1;
  for (let a: Element | null = el; a && a !== root.parentElement; a = a.parentElement) opacity *= Number(getComputedStyle(a).opacity);
  return opacity;
}

/** `r` less what its clipping ancestors, up to and including the root (the frame), cut off. */
function shownPart(el: Element, root: Element, r: ClientRect): ClientRect {
  let { left, top, right, bottom } = r;
  for (let a: Element | null = el.parentElement; a && a !== root.parentElement; a = a.parentElement) {
    const style = getComputedStyle(a);
    if (a === root || style.overflow !== 'visible' || style.clipPath !== 'none') {
      const c = a.getBoundingClientRect();
      [left, top, right, bottom] = [Math.max(left, c.left), Math.max(top, c.top), Math.min(right, c.right), Math.min(bottom, c.bottom)];
    }
  }
  return { left, top, right: Math.max(left, right), bottom: Math.max(top, bottom) };
}

/** Any CSS colour as sRGB 0–255 and alpha, through a canvas, which reads every syntax Chrome computes. */
function colorReader() {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  return (css: string): [number, number, number, number] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
}

function measureStill(root: HTMLElement, w: number): StillMeasure {
  const box = root.getBoundingClientRect(), scale = box.width / w;
  const toFrame = (r: ClientRect): Rect => ({ x: (r.left - box.left) / scale, y: (r.top - box.top) / scale, w: (r.right - r.left) / scale, h: (r.bottom - r.top) / scale });
  const readColor = colorReader();

  const texts: StillTextMark[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (el.closest('svg')) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
    if (!own.length) continue;
    const style = getComputedStyle(el);
    const opacity = effectiveOpacity(el, root);
    if (style.visibility !== 'visible' || opacity < 0.05) continue;
    const range = document.createRange();
    const lines = own.flatMap((n) => {
      range.selectNodeContents(n);
      return [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    });
    if (!lines.length) continue;
    const ink = { left: Math.min(...lines.map((r) => r.left)), top: Math.min(...lines.map((r) => r.top)), right: Math.max(...lines.map((r) => r.right)), bottom: Math.max(...lines.map((r) => r.bottom)) };
    const [r, g, b, a] = readColor(style.color);
    texts.push({
      text: own.map((n) => n.textContent!.trim()).join(' '),
      ink: toFrame(ink), shown: toFrame(shownPart(el, root, ink)),
      // An inline element has no box of its own to overflow. Below a line height of about 1.2 the glyphs' own boxes
      // overhang the lines by a fraction of an em, which isn't overflow; a line that doesn't fit is a whole line height.
      overflowsBox: style.display !== 'inline' && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 0.3 * parseFloat(style.fontSize)),
      color: [r, g, b, a * opacity], size: parseFloat(style.fontSize), weight: Number(style.fontWeight),
    });
  }

  const images: StillImageMark[] = [...root.querySelectorAll('img')].filter((img) => effectiveOpacity(img, root) >= 0.05).map((img) => {
    const r = img.getBoundingClientRect();
    return { src: decodeURI(new URL(img.currentSrc || img.src).pathname), rect: toFrame(r), shown: toFrame(shownPart(img, root, r)), natural: { w: img.naturalWidth, h: img.naturalHeight } };
  });
  return { w, h: box.height / scale, texts, images };
}

/** Every FitText settled (it marks itself `data-still-fitted`) and every image decoded, so what's measured is final. */
async function whenStillSettled(root: HTMLElement) {
  await whenLaidOut(root);
  while (root.querySelector('[data-still-fit]:not([data-still-fitted])')) await new Promise((resolve) => setTimeout(resolve, 16));
  await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode()));
}

// Transparent, not hidden: the text keeps its layout, and FitText still measures it.
const GROUND_PASS_CSS = '[data-still-root] * { color: transparent !important; text-shadow: none !important; -webkit-text-stroke: 0 !important; text-decoration-color: transparent !important; }';

/** A still's root: draws `children`, measures them, and in the ground pass draws their text transparent. */
export function StillProbe({ ground, children }: { ground?: boolean; children: ReactNode }) {
  const { width } = useVideoConfig();
  const root = useRef<HTMLDivElement>(null);
  const { delayRender, continueRender } = useDelayRender();
  const [measure, setMeasure] = useState<string | null>(null);
  const pending = useRef<number | null>(null);

  useLayoutEffect(() => {
    const handle = delayRender('measuring the still');
    pending.current = handle;
    let live = true;
    whenStillSettled(root.current!).then(() => {
      if (live) setMeasure(JSON.stringify(measureStill(root.current!, width)));
    });
    return () => {
      live = false;
      if (pending.current === handle) continueRender(handle);
      pending.current = null;
    };
  }, [width, delayRender, continueRender]);

  useEffect(() => {
    if (measure === null || pending.current === null) return;
    continueRender(pending.current);
    pending.current = null;
  }, [measure, continueRender]);

  return (
    <AbsoluteFill ref={root} data-still-root="" style={{ overflow: 'hidden' }}>
      {ground && <style>{GROUND_PASS_CSS}</style>}
      {children}
      {measure !== null && <Artifact filename={STILL_MEASURE_ARTIFACT} content={measure} />}
    </AbsoluteFill>
  );
}
