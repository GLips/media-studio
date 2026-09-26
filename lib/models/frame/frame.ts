// frame.ts: a video's format (its frame rate and size) and the zones scenes keep clear of, which follow the size.

import type { Rect } from '#models/camera/camera.ts';

/**
 * A video's frame rate and frame size. `defineVideo({ format })` sets it, a timed video's rate coming from its
 * timeline (`defineTimeline({ fps })`); every composition, piece and render reads it from there.
 */
export type VideoFormat = { fps: number; width: number; height: number };
export type FrameSize = Pick<VideoFormat, 'width' | 'height'>;

/** 30 fps at 1920×1080: what a video is when it names no format. */
export const DEFAULT_VIDEO_FORMAT: VideoFormat = { fps: 30, width: 1920, height: 1080 };

export const FONT = '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';

export const fullFrameRect = ({ width, height }: FrameSize): Rect => ({ x: 0, y: 0, w: width, h: height });

/**
 * Where burned-in captions sit on a frame of this size. Sized to the frame's short side (1 at 1080 px), so a caption
 * reads the same on a landscape, square or vertical frame. A vertical frame lifts it clear of the reply bar and
 * buttons a phone's feed draws over the bottom fifth.
 */
export function captionSafeArea({ width, height }: FrameSize) {
  const scale = Math.min(width, height) / 1080;
  const bottom = Math.round(height > width ? height * 0.2 : 70 * scale);
  return {
    scale,
    /** px from the frame's bottom to the caption's. */
    bottom,
    maxWidth: Math.min(Math.round(1388 * scale), width - Math.round(120 * scale)),
    /** A two-line caption's top edge, with room to spare. Scene text stays above it so captions never cover it. */
    top: height - bottom - Math.round(160 * scale),
  };
}

/** Where cameras put their subject by default: the whole frame above the caption band. */
export const captionFreeRect = (size: FrameSize): Rect => ({ x: 0, y: 0, w: size.width, h: captionSafeArea(size).top - 20 });
