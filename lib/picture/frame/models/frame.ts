// frame.ts: a video's format, its frame rate and size. The caption band scenes keep clear of is its caption style's
// (lib/picture/captions/models/caption-band.ts).

import type { Rect } from './geometry.ts';

/**
 * A video's frame rate, frame size and whether it's transparent. `defineVideo({ format })` sets it, a timed video's
 * rate coming from its timeline (`defineTimeline({ fps })`); every composition, piece and render reads it from there.
 */
export type VideoFormat = {
  fps: number;
  width: number;
  height: number;
  /**
   * Nothing paints behind the scenes, and the video delivers with an alpha channel (WebM and HEVC .mov, not MP4), for
   * an overlay, lower-third or hero animation that sits on a page's own background.
   */
  transparent: boolean;
};
export type FrameSize = Pick<VideoFormat, 'width' | 'height'>;

/** 30 fps at 1920×1080, opaque: what a video is when it names no format. */
export const DEFAULT_VIDEO_FORMAT: VideoFormat = { fps: 30, width: 1920, height: 1080, transparent: false };

export const fullFrameRect = ({ width, height }: FrameSize): Rect => ({ x: 0, y: 0, w: width, h: height });
