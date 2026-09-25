// frame.ts: the output frame and the zones scenes keep clear of.

import type { Rect } from '#models/camera/camera.ts';

export const W = 1920;
export const H = 1080;
export { FPS } from '#models/timeline/frame-rate.ts';
export const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';

/** A two-line caption's top edge, with room to spare. Scene text stays above it so captions never cover it. */
export const CAPTION_SAFE_TOP = 850;
/** Where cameras put their subject by default: the whole frame above the caption band. */
export const CAPTION_FREE: Rect = { x: 0, y: 0, w: W, h: CAPTION_SAFE_TOP - 20 };
export const FULL_FRAME: Rect = { x: 0, y: 0, w: W, h: H };
