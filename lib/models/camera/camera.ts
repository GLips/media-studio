// camera.ts: cameras over captures, as pure math.
//
// A Shot is one capture from lib/capture.ts: a high-DPI screenshot plus the page-space rects of the elements scenes
// point at. Page coordinates are the capture's CSS pixels. A camera is { cx, cy, zoom }: the page point at the centre
// of the view, and a zoom where 1 fits the capture's viewport width to the frame. A panel is a screen box showing a
// capture through its own camera (half of a before/after, a phone screen); the whole frame is the default panel.

import { CAPTION_FREE, FULL_FRAME, W } from '#models/frame/frame.ts';
import { clamp, lerp, seg } from '#models/motion/motion.ts';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
export type Cam = { cx: number; cy: number; zoom: number };
export type Shot = {
  src: string;
  /** Page width and height in CSS pixels. */
  w: number;
  h: number;
  /** Device pixel ratio of the PNG: how far a camera can zoom before text softens. */
  scale: number;
  rects: Readonly<Record<string, Rect | readonly Rect[]>>;
  data?: unknown;
  /** Set on a take's frame (takeShot): its pixels move in ways the motion tracks can't measure. */
  take?: true;
};

export const centerOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const union = (...rects: Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
};
/** A rect grown by `pad` on every side. */
export const inflate = (r: Rect, pad: number): Rect => ({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 });

/** A 2D affine transform in SVG's `matrix(a b c d e f)` order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type AffineMatrix = [number, number, number, number, number, number];
/** `m` after `n`: the one transform that applies `n`, then `m`. */
export const multiplyAffine = ([a, b, c, d, e, f]: AffineMatrix, [g, h, i, j, k, l]: AffineMatrix): AffineMatrix =>
  [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
export const applyAffine = ([a, b, c, d, e, f]: AffineMatrix, p: Point): Point => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f });

/** Screen pixels per page pixel. */
export const scaleFor = (shot: Shot, zoom: number) => (W / shot.w) * zoom;

/** The camera that shows the top of a capture at zoom 1: the page as a visitor first sees it. */
export function camTop(shot: Shot, box: Rect = FULL_FRAME): Cam {
  const zoom = box.w / W;
  return { cx: shot.w / 2, cy: box.h / scaleFor(shot, zoom) / 2, zoom };
}

/** The camera that shows a whole viewport-sized capture in `box`: phones and other fixed-size screens. */
export const camWhole = (shot: Shot, box: Rect): Cam => ({ cx: shot.w / 2, cy: shot.h / 2, zoom: box.w / W });

type FitOptions = {
  /** Page pixels kept around the rect. */
  pad?: number;
  /** Captures are 2× device pixels, so past ~1.6 text starts to soften. */
  maxZoom?: number;
  /** Page-pixel nudge after fitting. */
  dx?: number;
  dy?: number;
};

/**
 * The camera that frames page `rect` in screen `box` (the whole frame by default), as large as fits and capped at
 * `maxZoom`, never zoomed out past the box's share of the page. The rect is centred in the part of the box above the
 * caption band, so whatever the voice is describing is never under a caption.
 */
export function camFit(shot: Shot, rect: Rect, { pad = 40, maxZoom = 1.6, dx = 0, dy = 0 }: FitOptions = {}, box: Rect = FULL_FRAME): Cam {
  const area = { ...box, h: Math.min(box.h, CAPTION_FREE.y + CAPTION_FREE.h - box.y) };
  const k1 = scaleFor(shot, 1);
  const zoom = Math.max(box.w / W, Math.min(maxZoom, area.w / ((rect.w + pad * 2) * k1), area.h / ((rect.h + pad * 2) * k1)));
  const k = scaleFor(shot, zoom);
  const { x, y } = centerOf(rect);
  const shiftX = (area.x + area.w / 2 - (box.x + box.w / 2)) / k, shiftY = (area.y + area.h / 2 - (box.y + box.h / 2)) / k;
  return clampCam(shot, { cx: x + dx - shiftX, cy: y + dy - shiftY, zoom }, box);
}

/**
 * Keeps the view inside the capture so the box never shows past its edges. A short capture (a take's viewport frame)
 * in a tall box is zoomed in until it covers the box.
 */
export function clampCam(shot: Shot, cam: Cam, box: Rect = FULL_FRAME): Cam {
  const zoom = Math.max(cam.zoom, (box.h / shot.h) * (shot.w / W));
  const k = scaleFor(shot, zoom);
  const halfW = box.w / k / 2, halfH = box.h / k / 2;
  return { zoom, cx: clamp(cam.cx, halfW, Math.max(halfW, shot.w - halfW)), cy: clamp(cam.cy, halfH, Math.max(halfH, shot.h - halfH)) };
}

/** Interpolates cameras with zoom in log space, so pushes feel constant-speed. */
export const lerpCam = (a: Cam, b: Cam, k: number): Cam => ({
  cx: lerp(a.cx, b.cx, k),
  cy: lerp(a.cy, b.cy, k),
  zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), k)),
});

/**
 * Throws unless key times rise. Keys anchored to words can swap when a line is re-voiced, and an out-of-order key
 * reads as a snap mid-shot; a cut belongs between scenes.
 */
export function assertKeysInOrder(what: string, keys: readonly (readonly [number, ...unknown[]])[]) {
  for (let i = 1; i < keys.length; i++) {
    if (!(keys[i][0] > keys[i - 1][0])) throw new Error(`${what} key ${i} at ${keys[i][0].toFixed(2)}s isn't after key ${i - 1} at ${keys[i - 1][0].toFixed(2)}s`);
  }
}

/** Camera along keyframes [[time, cam], ...], eased between each pair. */
export function camAt(t: number, keys: readonly (readonly [number, Cam])[]): Cam {
  assertKeysInOrder('camAt', keys);
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) return lerpCam(keys[i - 1][1], keys[i][1], seg(t, keys[i - 1][0], keys[i][0]));
  }
  return keys[keys.length - 1][1];
}

/** A page point on screen, through a camera in `box`. */
export function toScreen(shot: Shot, cam: Cam, p: Point, box: Rect = FULL_FRAME): Point {
  const k = scaleFor(shot, cam.zoom);
  return { x: (p.x - cam.cx) * k + box.x + box.w / 2, y: (p.y - cam.cy) * k + box.y + box.h / 2 };
}

/** A page rect on screen, through a camera in `box`. */
export function rectToScreen(shot: Shot, cam: Cam, r: Rect, box: Rect = FULL_FRAME): Rect {
  const a = toScreen(shot, cam, r, box), k = scaleFor(shot, cam.zoom);
  return { x: a.x, y: a.y, w: r.w * k, h: r.h * k };
}

/** A screen point back in page space: for starting a cursor off-screen, or anywhere picked by eye in the frame. */
export function toPage(shot: Shot, cam: Cam, p: Point, box: Rect = FULL_FRAME): Point {
  const k = scaleFor(shot, cam.zoom);
  return { x: (p.x - box.x - box.w / 2) / k + cam.cx, y: (p.y - box.y - box.h / 2) / k + cam.cy };
}

// ---------- views ----------
// A view is one capture seen through one camera in one screen box: everything a <Capture>, a highlight on it and a
// cursor over it must agree on. Build it once per shot and pass it around, so the three can never disagree.

export type View = { shot: Shot; cam: Cam; box: Rect };
export const view = (shot: Shot, cam: Cam, box: Rect = FULL_FRAME): View => ({ shot, cam, box });
/** The same camera and box over another capture of the same page: a later state of it. */
export const viewOf = (v: View, shot: Shot): View => ({ ...v, shot });
// The view each screen rect was aimed through, so a Highlight handed one records the camera it moves with (motion-tag.ts)
// without taking the view as well. A rect it can't trace is attribution unknown, never guessed.
const aimedThrough = new WeakMap<Rect, View>();

/** A page rect of the view's capture, on screen. */
export function screenRect(v: View, r: Rect): Rect {
  const rect = rectToScreen(v.shot, v.cam, r, v.box);
  aimedThrough.set(rect, v);
  return rect;
}
/** The view `screenRect` aimed this very rect through; undefined for any other rect, a copy of one included. */
export const viewOfScreenRect = (r: Rect): View | undefined => aimedThrough.get(r);
/** A page point of the view's capture, on screen. */
export const screenPoint = (v: View, p: Point): Point => toScreen(v.shot, v.cam, p, v.box);
/** A screen point, in the view's page space. */
export const pagePoint = (v: View, p: Point): Point => toPage(v.shot, v.cam, p, v.box);
