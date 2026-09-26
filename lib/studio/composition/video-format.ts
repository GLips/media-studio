// video-format.ts: the video's format as a piece reads it, from the composition it renders in, so the same piece fits a
// landscape video, a vertical cut and a still.

import { useVideoConfig } from 'remotion';
import type { VideoFormat } from '#models/frame/frame.ts';

export function useVideoFormat(): VideoFormat {
  const { fps, width, height } = useVideoConfig();
  return { fps, width, height };
}
