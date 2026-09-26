import { useEffect, useRef } from 'react';
import type { SfxCue } from '#sfx/cues.ts';
import type { LabSfxCuePayload } from '#models/lab/lab-catalog.ts';
import { useLabWholeVideo } from '../use-lab-whole-video.ts';
import { labAudio } from './lab-audio.ts';
import { firstLabCue } from './lab-cue-state.ts';

/** A moment played from a marker: this long before the cue, and this long in all. */
const MOMENT_LEAD = 1.5;
const MOMENT_LENGTH = 3;

/**
 * The cue editor's video: opened on the first cue once it knows its length, seeked by the timeline, and played a
 * moment at a time from a marker, which stops itself.
 */
export function useLabCueVideo(payload: LabSfxCuePayload) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoSrc = useLabWholeVideo(payload.video);
  const momentEnd = useRef<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const first = firstLabCue(payload.list);
    const openOnFirstCue = () => {
      if (first && video.currentTime === 0) video.currentTime = first.event.at;
    };
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) openOnFirstCue();
    else video.addEventListener('loadedmetadata', openOnFirstCue, { once: true });
    return () => video.removeEventListener('loadedmetadata', openOnFirstCue);
  }, [payload]);

  // A moment played from a marker stops itself; a seek away from it (the video's own controls) lets the video run on.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let frame = 0;
    const check = () => {
      const end = momentEnd.current;
      if (end !== null && !video.paused && video.currentTime >= end) {
        momentEnd.current = null;
        if (video.currentTime < end + 0.5) video.pause();
      }
    };
    const watch = () => {
      check();
      frame = requestAnimationFrame(watch);
    };
    // timeupdate too: a hidden tab gets no animation frames, and the moment would play on.
    video.addEventListener('timeupdate', check);
    watch();
    return () => {
      cancelAnimationFrame(frame);
      video.removeEventListener('timeupdate', check);
    };
  }, []);

  const seekVideo = (at: number) => {
    const video = videoRef.current;
    if (!video) return;
    momentEnd.current = null;
    video.currentTime = Math.max(0, Math.min(payload.duration, at));
  };
  const playMoment = (cue: SfxCue) => {
    const video = videoRef.current;
    if (!video) return;
    void labAudio().resume();
    const at = cue.event.at + (cue.nudge ?? 0);
    video.currentTime = Math.max(0, at - MOMENT_LEAD);
    momentEnd.current = Math.max(0, at - MOMENT_LEAD) + MOMENT_LENGTH;
    void video.play();
  };
  return { videoRef, videoSrc, seekVideo, playMoment };
}
