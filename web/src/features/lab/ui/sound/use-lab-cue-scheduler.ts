import { useEffect, type RefObject } from 'react';
import { sfxCuePlays, type SfxCueList } from '#sfx/cues.ts';
import { labAudio } from './lab-audio.ts';
import { renderLabCueSound } from './lab-cue-sounds.ts';

/** How far ahead of the video's playhead cue sounds are handed to Web Audio. */
const SCHEDULE_AHEAD = 0.3;

/**
 * Plays the list's sounds in step with the video, which doesn't carry them: sounds due within SCHEDULE_AHEAD are started
 * on the audio clock. A seek, pause or edit stops them all and starts over, joining any sound under way part-way, so
 * the clocks never drift apart for long. Placed cues are in the video's own audio already, so never scheduled.
 */
export function useLabCueScheduler(videoRef: RefObject<HTMLVideoElement | null>, list: SfxCueList, enabled: boolean) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !enabled) return undefined;
    const plays = sfxCuePlays(list).filter((p) => !p.inline);
    const ctx = labAudio();
    let live: AudioBufferSourceNode[] = [], started = new Set<string>();
    const stopAll = () => {
      live.forEach((s) => s.stop());
      live = [];
      started = new Set();
    };
    const tick = () => {
      if (video.paused || video.seeking) return;
      void ctx.resume();
      const now = video.currentTime;
      for (const play of plays) {
        if (started.has(play.id)) continue;
        const { buffer, landsAt } = renderLabCueSound(play.sound), start = play.at - landsAt;
        if (start > now + SCHEDULE_AHEAD || start + buffer.duration < now) continue;
        // A few ticks late plays whole (a clipped attack sounds worse than 50 ms late); after a seek, join part-way.
        const late = now - start, offset = late > 0.08 ? late : 0;
        const source = ctx.createBufferSource(), gain = ctx.createGain();
        source.buffer = buffer;
        gain.gain.value = play.volume;
        source.connect(gain).connect(ctx.destination);
        source.start(ctx.currentTime + Math.max(0, -late), offset);
        live.push(source);
        started.add(play.id);
      }
    };
    const timer = setInterval(tick, 40);
    const restart = () => {
      stopAll();
      tick();
    };
    video.addEventListener('playing', restart);
    video.addEventListener('seeked', restart);
    video.addEventListener('pause', stopAll);
    video.addEventListener('seeking', stopAll);
    tick();
    return () => {
      clearInterval(timer);
      stopAll();
      video.removeEventListener('playing', restart);
      video.removeEventListener('seeked', restart);
      video.removeEventListener('pause', stopAll);
      video.removeEventListener('seeking', stopAll);
    };
  }, [videoRef, list, enabled]);
}
