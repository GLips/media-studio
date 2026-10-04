// video-format.ts: the video's format as a piece reads it, from the composition it renders in, so the same piece fits a
// landscape video, a vertical cut and a still.

import { createContext, useContext } from 'react';
import { useVideoConfig } from 'remotion';
import type { VideoFormat } from '../models/frame.ts';

/** Whether the video renders transparent. Remotion's config has no such field, so Video.tsx provides it; a still is opaque. */
export const VideoTransparentContext = createContext(false);

export function useVideoFormat(): VideoFormat {
  const { fps, width, height } = useVideoConfig();
  return { fps, width, height, transparent: useContext(VideoTransparentContext) };
}

/**
 * Whether this pass draws the picture. A pass that only measures frames or gathers their sound draws none, so what
 * paints on the GPU checks its props and paints nothing. Video.tsx provides it; anywhere else draws.
 */
export const PictureDrawnContext = createContext(true);

export const usePictureDrawn = (): boolean => useContext(PictureDrawnContext);
