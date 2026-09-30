// caption-band.ts: the strip of the frame a caption style draws in, which scenes and cameras keep their subject above.
// Each style declares its band as a rule over the frame's size; the pill's is the default.

import type { Rect } from '#lib/picture/frame/models/geometry.ts';
import type { FrameSize } from '#lib/picture/frame/models/frame.ts';

export type CaptionBand = {
  /** 1 at a 1080 px short side: a style sizes its type by it, so a caption reads the same at any frame size. */
  scale: number;
  /** px from the frame's bottom to the caption's. */
  bottom: number;
  maxWidth: number;
  /** The band's top edge, with room to spare. Scene text stays above it so captions never cover it. */
  top: number;
};

export type CaptionBandRule = (size: FrameSize) => CaptionBand;

/**
 * The house band, room for two lines of the pill at the foot of the frame. A vertical frame lifts it clear of the
 * reply bar and buttons a phone's feed draws over the bottom fifth.
 */
export const pillCaptionBand: CaptionBandRule = ({ width, height }) => {
  const scale = Math.min(width, height) / 1080;
  const bottom = Math.round(height > width ? height * 0.2 : 70 * scale);
  return { scale, bottom, maxWidth: Math.min(Math.round(1388 * scale), width - Math.round(120 * scale)), top: height - bottom - Math.round(160 * scale) };
};

/** Where captions sit on a frame of this size, in the band of the video's caption style. */
export const captionSafeArea = (size: FrameSize, band: CaptionBandRule = pillCaptionBand) => band(size);

/** The whole frame above the caption band: where cameras put their subject by default. */
export const captionFreeRect = (size: FrameSize, band: CaptionBandRule = pillCaptionBand): Rect => ({ x: 0, y: 0, w: size.width, h: band(size).top - 20 });
