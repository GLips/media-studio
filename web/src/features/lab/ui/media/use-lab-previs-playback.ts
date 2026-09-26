import { useEffect, useRef, useState } from 'react';

// play() rejects whenever a pause interrupts it, which is expected here. `playing` is what the viewer asked for, not
// the element's state: Chrome pauses an autoplay-attribute video while it's scrolled offscreen, and mirroring that
// pause left the clips stopped once they scrolled into view. So play() is called from code, never autoPlay.
const playPrevisVideo = (v: HTMLVideoElement) => void v.play().catch(() => undefined);

export type LabPrevisPlayback = ReturnType<typeof useLabPrevisPlayback>;

/**
 * A previs render and its blockout on one clock. The render is the clock; the blockout is nudged back onto it only
 * when it drifts, since seeking every frame stutters.
 */
export function useLabPrevisPlayback(speed: number) {
  const renderRef = useRef<HTMLVideoElement>(null);
  const blockoutRef = useRef<HTMLVideoElement>(null);
  const wantsPlayRef = useRef(true);
  const [playing, setPlaying] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(5);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const m = renderRef.current;
      const f = blockoutRef.current;
      if (m && f) {
        // Chrome pauses muted video in a background tab and doesn't always resume it, so hold it to what was asked.
        if (wantsPlayRef.current && m.paused && !document.hidden) playPrevisVideo(m);
        if (Math.abs(f.currentTime - m.currentTime) > 0.08) f.currentTime = Math.min(m.currentTime, f.duration || m.currentTime);
        if (m.paused && !f.paused) f.pause();
        if (!m.paused && f.paused) playPrevisVideo(f);
        setTime(m.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    for (const v of [renderRef.current, blockoutRef.current]) if (v) v.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    wantsPlayRef.current = playing;
    if (!playing) renderRef.current?.pause();
  }, [playing]);

  const seek = (t: number) => {
    for (const v of [renderRef.current, blockoutRef.current]) if (v) v.currentTime = t;
    setTime(t);
  };

  /** A shot's new elements come in at 1×, so each takes the chosen speed as it loads; the render also sets the length. */
  const onBlockoutMetadata = (v: HTMLVideoElement) => {
    v.playbackRate = speed;
  };
  const onRenderMetadata = (v: HTMLVideoElement) => {
    setDuration(v.duration);
    v.playbackRate = speed;
  };

  return { renderRef, blockoutRef, playing, setPlaying, time, duration, seek, onBlockoutMetadata, onRenderMetadata };
}
