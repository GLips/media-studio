// still-check.ts: what makes a still fail, judged from the still probe's measurements (lib/studio/still-probe.tsx) and
// the pixels of its ground pass (the still drawn with every text transparent). Pure; lib/render-stills.ts renders both
// and refuses to write a still with a problem, as `studio render` refuses a failed framing check.
//
// Five kinds: text cut off or overflowing its box (and a fitted headline at its floor), text or a logo under a
// platform's UI, text that doesn't stand off the ground drawn under it, an image drawn soft from too few pixels, and a
// crop showing an empty band of its image at an edge.
import type { Rect } from './studio/camera.ts';
import type { StillFitReport, StillUiZone } from './studio/still-presets.ts';

/** One element's own text, as drawn. `ink` is its text's line boxes; `shown`, the part its clipping ancestors and the frame leave. */
export type StillTextMark = {
  text: string; ink: Rect; shown: Rect;
  /** Its content is wider or taller than its own box. */
  overflowsBox: boolean;
  /** sRGB 0–255, alpha 0–1 with every ancestor's opacity in it. */
  color: readonly [number, number, number, number];
  size: number; weight: number;
};
/** One `<img>`: its box, the part shown, and its file's own pixels. */
export type StillImageMark = { src: string; rect: Rect; shown: Rect; natural: { w: number; h: number } };
export type StillMeasure = { w: number; h: number; texts: StillTextMark[]; images: StillImageMark[] };
/** A decoded frame, RGB, row by row. */
export type StillPixels = { w: number; h: number; rgb: Uint8Array };

export type StillCheckKind = 'clipped' | 'fit' | 'ui-zone' | 'contrast' | 'upscaled' | 'empty-crop';
export type StillProblem = { kind: StillCheckKind; problem: string };

/** Text's contrast with its ground below this fails: WCAG AA's, for body and for display sizes. */
export const STILL_CONTRAST_MIN = { body: 4.5, display: 3 };
/** An image drawn at more than this many frame px per pixel of its file looks soft. */
export const STILL_UPSCALE_MAX = 1.5;
/**
 * An image covering less of the frame than this is a mark (a logo, an icon), kept out of UI zones like text; a bigger
 * one is the picture, which runs under them by design.
 */
const MARK_SHARE_MAX = 0.15;
/** A crop's edge band this share of its extent, all one colour, is empty page, not margin. */
const EMPTY_BAND_SHARE = 0.12;
/** How far a row's channels may spread and still read as one colour: a flat page, through PNG and scaling. */
const FLAT_SPREAD = 10;

const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);
const overlap = (a: Rect, b: Rect): Rect => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, w: Math.min(a.x + a.w, b.x + b.w) - x, h: Math.min(a.y + a.h, b.y + b.h) - y };
};
const px = (n: number) => `${Math.round(n)} px`;
const quote = (text: string) => `"${text.length > 40 ? `${text.slice(0, 39).trimEnd()}…` : text}"`;

/** WCAG 2's relative luminance of an sRGB colour, 0–255 per channel. */
export function relativeLuminance([r, g, b]: readonly number[]) {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrastRatio(a: readonly number[], b: readonly number[]) {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Display size, which needs only 3:1: WCAG's large text (24 px, or 18.7 px bold) as a share of a desktop view's
 * shorter side, since a still is seen at the size it's shown, not its pixels. 4% of the frame's shorter side, or 3% bold.
 */
const isDisplay = (t: StillTextMark, frame: { w: number; h: number }) => {
  const u = Math.min(frame.w, frame.h) / 100;
  return t.size >= 4 * u || (t.size >= 3 * u && t.weight >= 700);
};

/**
 * Text's contrast over the ground under it, read at a grid across its whole shown box, edges included: the ratio 90%
 * of the box beats, so a speck of stray ground doesn't fail it and a light patch under a tenth of it does.
 */
export function textGroundContrast(t: StillTextMark, ground: StillPixels): number {
  const box = t.shown, ratios: number[] = [];
  const [r, g, b, a] = t.color;
  for (let j = 0; j <= 4; j++) {
    for (let i = 0; i <= 24; i++) {
      const x = Math.min(ground.w - 1, Math.max(0, Math.round(box.x + (i / 24) * box.w)));
      const y = Math.min(ground.h - 1, Math.max(0, Math.round(box.y + (j / 4) * box.h)));
      const o = (y * ground.w + x) * 3;
      const under = [ground.rgb[o], ground.rgb[o + 1], ground.rgb[o + 2]];
      // Translucent text is its colour over this ground.
      const ink = [r, g, b].map((c, k) => a * c + (1 - a) * under[k]);
      ratios.push(contrastRatio(ink, under));
    }
  }
  ratios.sort((x, y) => x - y);
  return ratios[Math.floor(ratios.length * 0.1)];
}

/** How deep a band of one colour runs in from each edge of `box`, in frame px. */
export function flatEdgeBands(box: Rect, pixels: StillPixels): { top: number; bottom: number; left: number; right: number } {
  const x0 = Math.max(0, Math.ceil(box.x)), x1 = Math.min(pixels.w, Math.floor(box.x + box.w));
  const y0 = Math.max(0, Math.ceil(box.y)), y1 = Math.min(pixels.h, Math.floor(box.y + box.h));
  const flat = (points: Iterable<[number, number]>) => {
    const lo = [255, 255, 255], hi = [0, 0, 0];
    for (const [x, y] of points) {
      const o = (y * pixels.w + x) * 3;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], pixels.rgb[o + k]);
        hi[k] = Math.max(hi[k], pixels.rgb[o + k]);
      }
    }
    return hi.every((h, k) => h - lo[k] <= FLAT_SPREAD);
  };
  function* row(y: number): Iterable<[number, number]> { for (let x = x0; x < x1; x++) yield [x, y]; }
  function* column(x: number): Iterable<[number, number]> { for (let y = y0; y < y1; y++) yield [x, y]; }
  const depth = (from: number, to: number, step: 1 | -1, line: (at: number) => Iterable<[number, number]>) => {
    let n = 0;
    for (let at = from; step > 0 ? at < to : at >= to; at += step, n++) if (!flat(line(at))) break;
    return n;
  };
  return {
    top: depth(y0, y1, 1, row), bottom: depth(y1 - 1, y0, -1, row),
    left: depth(x0, x1, 1, column), right: depth(x1 - 1, x0, -1, column),
  };
}

/** Everything wrong with one still. `ground` is its ground pass; `zones`, its preset's UI zones. */
export function stillProblems({ measure, fits, ground, zones }: { measure: StillMeasure; fits: readonly StillFitReport[]; ground: StillPixels; zones: readonly StillUiZone[] }): StillProblem[] {
  const problems: StillProblem[] = [];
  const frame = { w: measure.w, h: measure.h };
  const add = (kind: StillCheckKind, problem: string) => problems.push({ kind, problem });

  for (const f of fits) {
    if (f.overflows) add('fit', `fitted "${f.name}" overflows its box even at its floor (${px(f.min)}): shorten the copy or give it a bigger box`);
    else if (f.atFloor) add('fit', `fitted "${f.name}" is at its floor (${px(f.min)}): the copy is too long for this preset's box`);
  }

  for (const t of measure.texts) {
    // The line boxes run past the glyphs by a little, more at a tight line height.
    const slack = Math.max(4, 0.12 * t.size);
    const lost = Math.max(t.shown.x - t.ink.x, t.shown.y - t.ink.y, t.ink.x + t.ink.w - (t.shown.x + t.shown.w), t.ink.y + t.ink.h - (t.shown.y + t.shown.h));
    if (area(t.shown) <= 0) add('clipped', `text ${quote(t.text)} is off the frame`);
    else if (lost > slack) add('clipped', `text ${quote(t.text)} is cut off (${px(lost)} of it lost past its panel or the frame)`);
    if (t.overflowsBox) add('clipped', `text ${quote(t.text)} overflows its box`);
    if (area(t.shown) <= 0) continue;

    for (const z of zones) {
      const o = overlap(t.shown, z.rect);
      if (o.w > 2 && o.h > 2) add('ui-zone', `text ${quote(t.text)} is under ${z.name} (y ${px(z.rect.y)}–${px(z.rect.y + z.rect.h)})`);
    }

    const ratio = textGroundContrast(t, ground);
    const display = isDisplay(t, frame);
    const min = display ? STILL_CONTRAST_MIN.display : STILL_CONTRAST_MIN.body;
    if (ratio < min) add('contrast', `text ${quote(t.text)} is ${ratio.toFixed(1)}:1 against its ground, under the ${min}:1 ${display ? 'display' : 'body'} text needs`);
  }

  for (const img of measure.images) {
    if (area(img.shown) <= 0) continue;
    // The bundle renames files to hashes, so an image goes by where it's drawn.
    const name = `the image at ${px(img.shown.x)}, ${px(img.shown.y)} (${img.src.split('/').at(-1)})`;
    const scale = Math.max(img.rect.w / img.natural.w, img.rect.h / img.natural.h);
    // An SVG (a logo) draws sharp at any size.
    if (!/\.svg$/i.test(img.src) && scale > STILL_UPSCALE_MAX) add('upscaled', `${name} is drawn at ${scale.toFixed(1)}× its pixels (${img.natural.w}×${img.natural.h} shown ${px(img.rect.w)} wide), so it's soft: crop less of it, or capture or generate it bigger`);

    if (area(img.shown) < MARK_SHARE_MAX * frame.w * frame.h) {
      for (const z of zones) {
        const o = overlap(img.shown, z.rect);
        if (o.w > 2 && o.h > 2) add('ui-zone', `${name} is under ${z.name}`);
      }
      continue;
    }
    const bands = flatEdgeBands(img.shown, ground);
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      const extent = edge === 'top' || edge === 'bottom' ? img.shown.h : img.shown.w;
      if (bands[edge] >= EMPTY_BAND_SHARE * extent) add('empty-crop', `the crop of ${name} shows a ${px(bands[edge])} empty band at its ${edge}: move its focus or crop tighter`);
    }
  }
  return problems;
}
