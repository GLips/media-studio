import { useCallback, useEffect, useRef, useState } from 'react';
import { reviewFrameAt } from '#lib/output/review/models/review-notes.ts';

/**
 * The review's clock: the frame on screen, read from each presented frame's own timestamp while playing, and the moves
 * the transport, scrubber, storyboard and keys make. Without a snapshot the length comes from the file.
 */
export function useReviewPlayback({ fps, durationInFrames }: { fps: number; durationInFrames: number | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const [fileFrames, setFileFrames] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const total = durationInFrames ?? fileFrames ?? 1;

  useEffect(() => {
    const v = video.current;
    if (!v) return undefined;
    let handle = v.requestVideoFrameCallback(function onFrame(_, meta) {
      setFrame(reviewFrameAt(meta.mediaTime, fps));
      handle = v.requestVideoFrameCallback(onFrame);
    });
    const sync = () => {
      setPlaying(!v.paused);
      if (v.paused) setFrame(reviewFrameAt(v.currentTime, fps));
    };
    const events = ['play', 'pause', 'seeked'] as const;
    for (const e of events) v.addEventListener(e, sync);
    return () => {
      v.cancelVideoFrameCallback(handle);
      for (const e of events) v.removeEventListener(e, sync);
    };
  }, [fps]);

  // Pauses, then seeks to the frame's middle, so the decoder can't land on its neighbour.
  const seekToFrame = useCallback((f: number) => {
    const clamped = Math.max(0, Math.min(total - 1, Math.round(f)));
    video.current?.pause();
    if (video.current) video.current.currentTime = (clamped + 0.5) / fps;
    setFrame(clamped);
  }, [fps, total]);

  const togglePlaying = useCallback(() => {
    const v = video.current;
    if (v?.paused) void v.play();
    else v?.pause();
  }, []);

  const measureVideo = useCallback((v: HTMLVideoElement) => setFileFrames(Math.round(v.duration * fps)), [fps]);

  return { video, frame, total, playing, seekToFrame, togglePlaying, measureVideo };
}

export type ReviewPlayback = ReturnType<typeof useReviewPlayback>;
