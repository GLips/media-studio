import { useEffect, useState } from 'react';
import { useReviewPlaybackState, type ReviewPlayback } from '#web/features/review/index.ts';
import { scriptLineIndexAt, type ScriptTimedLine } from './script-read-along.ts';

/**
 * The index of the line being read, -1 before the first. While playing it's checked each frame but changes, and
 * re-renders, only when the read moves on to the next line; the word sweep inside a line is CSS on the frame variable.
 */
export function useScriptCurrentLine(playback: ReviewPlayback, timed: readonly (ScriptTimedLine | null)[]): number {
  const settled = useReviewPlaybackState(playback, (s) => s.frame);
  const playing = useReviewPlaybackState(playback, (s) => s.playing);
  const [live, setLive] = useState(-1);
  useEffect(() => {
    if (!playing) return undefined;
    let raf = requestAnimationFrame(function follow() {
      setLive(scriptLineIndexAt(timed, playback.frameNow()));
      raf = requestAnimationFrame(follow);
    });
    return () => {
      cancelAnimationFrame(raf);
      setLive(-1);
    };
  }, [playing, playback, timed]);
  // The first frame of a play has no live reading yet: the line it started on holds until one arrives.
  return playing && live >= 0 ? live : scriptLineIndexAt(timed, settled);
}
