// camera.ts: cameras over captures, as pure math.
//
// A Shot is one capture from lib/footage/capture/engine/capture.ts: a high-DPI screenshot plus the page-space rects of the elements scenes
// point at. Page coordinates are the capture's CSS pixels. A camera is { cx, cy, zoom }: the page point at the centre
// of the view, and a zoom where 1 fits the capture's viewport width to the frame's width (`frameSize`, the video's). A
// panel is a screen box showing a capture through its own camera (half of a before/after, a phone screen); the whole
// frame is the default panel.

import { captionFreeRect, type CaptionBandRule } from '#lib/picture/captions/models/caption-band.ts';
import { fullFrameRect, type FrameSize } from '#lib/picture/frame/models/frame.ts';
import { centerOf, type Point, type Rect } from '#lib/picture/frame/models/geometry.ts';
import { clamp, lerp, seg } from '#lib/picture/motion/models/motion.ts';

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

/** Screen pixels per page pixel, on a frame `frameSize` big. */
export const scaleFor = (shot: Shot, zoom: number, frameSize: FrameSize) => (frameSize.width / shot.w) * zoom;

/** The camera that shows the top of a capture at zoom 1: the page as a visitor first sees it. */
export function camTop(shot: Shot, frameSize: FrameSize, box: Rect = fullFrameRect(frameSize)): Cam {
  const zoom = box.w / frameSize.width;
  return { cx: shot.w / 2, cy: box.h / scaleFor(shot, zoom, frameSize) / 2, zoom };
}

/** The camera that shows a whole viewport-sized capture in `box`: phones and other fixed-size screens. */
export const camWhole = (shot: Shot, box: Rect, frameSize: FrameSize): Cam => ({ cx: shot.w / 2, cy: shot.h / 2, zoom: box.w / frameSize.width });

type FitOptions = {
  /** Page pixels kept around the rect. */
  pad?: number;
  /** Captures are 2× device pixels, so past ~1.6 text starts to soften. */
  maxZoom?: number;
  /** Page-pixel nudge after fitting. */
  dx?: number;
  dy?: number;
  /** The video's caption style's band (`style.band`), when it isn't the pill's. */
  captionBand?: CaptionBandRule;
};

/**
 * The camera that frames page `rect` in screen `box` (the whole frame by default), as large as fits and capped at
 * `maxZoom`, never zoomed out past the box's share of the page. The rect is centred in the part of the box above the
 * caption band, so whatever the voice is describing is never under a caption.
 */
export function camFit(shot: Shot, rect: Rect, frameSize: FrameSize, { pad = 40, maxZoom = 1.6, dx = 0, dy = 0, captionBand }: FitOptions = {}, box: Rect = fullFrameRect(frameSize)): Cam {
  const free = captionFreeRect(frameSize, captionBand);
  const area = { ...box, h: Math.min(box.h, free.y + free.h - box.y) };
  const k1 = scaleFor(shot, 1, frameSize);
  const zoom = Math.max(box.w / frameSize.width, Math.min(maxZoom, area.w / ((rect.w + pad * 2) * k1), area.h / ((rect.h + pad * 2) * k1)));
  const k = scaleFor(shot, zoom, frameSize);
  const { x, y } = centerOf(rect);
  const shiftX = (area.x + area.w / 2 - (box.x + box.w / 2)) / k, shiftY = (area.y + area.h / 2 - (box.y + box.h / 2)) / k;
  return clampCam(shot, { cx: x + dx - shiftX, cy: y + dy - shiftY, zoom }, frameSize, box);
}

/**
 * Keeps the view inside the capture so the box never shows past its edges. A short capture (a take's viewport frame)
 * in a tall box is zoomed in until it covers the box.
 */
export function clampCam(shot: Shot, cam: Cam, frameSize: FrameSize, box: Rect = fullFrameRect(frameSize)): Cam {
  const zoom = Math.max(cam.zoom, (box.h / shot.h) * (shot.w / frameSize.width));
  const k = scaleFor(shot, zoom, frameSize);
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

// ---------- views ----------
// A view is one capture seen through one camera in one screen box of a frame: everything a <Capture>, a highlight on it
// and a cursor over it must agree on. Build it once per shot and pass it around, so the three can never disagree.

export type View = { shot: Shot; cam: Cam; box: Rect; frameSize: FrameSize };
export const view = (shot: Shot, cam: Cam, frameSize: FrameSize, box: Rect = fullFrameRect(frameSize)): View => ({ shot, cam, box, frameSize });
/** Screen pixels per page pixel through the view. */
export const viewScale = (v: View) => scaleFor(v.shot, v.cam.zoom, v.frameSize);

/** A page point of the view's capture, on screen. */
export function screenPoint(v: View, p: Point): Point {
  const k = viewScale(v);
  return { x: (p.x - v.cam.cx) * k + v.box.x + v.box.w / 2, y: (p.y - v.cam.cy) * k + v.box.y + v.box.h / 2 };
}

/** A page rect on screen, through the view. Untracked: `screenRect` is the one a highlight can trace to its view. */
export function rectToScreen(v: View, r: Rect): Rect {
  const a = screenPoint(v, r), k = viewScale(v);
  return { x: a.x, y: a.y, w: r.w * k, h: r.h * k };
}

/** A screen point back in the view's page space: for starting a cursor off-screen, or anywhere picked by eye in the frame. */
export function pagePoint(v: View, p: Point): Point {
  const k = viewScale(v);
  return { x: (p.x - v.box.x - v.box.w / 2) / k + v.cam.cx, y: (p.y - v.box.y - v.box.h / 2) / k + v.cam.cy };
}

/** The same camera and box over another capture of the same page: a later state of it. */
export const viewOf = (v: View, shot: Shot): View => ({ ...v, shot });
// The view each screen rect was aimed through, so a Highlight handed one records the camera it moves with (motion-tag.ts)
// without taking the view as well. A rect it can't trace is attribution unknown, never guessed.
const aimedThrough = new WeakMap<Rect, View>();

/** A page rect of the view's capture, on screen. */
export function screenRect(v: View, r: Rect): Rect {
  const rect = rectToScreen(v, r);
  aimedThrough.set(rect, v);
  return rect;
}
/** The view `screenRect` aimed this very rect through; undefined for any other rect, a copy of one included. */
export const viewOfScreenRect = (r: Rect): View | undefined => aimedThrough.get(r);
