import { useEffect, useState } from 'react';
import { labPlayheadOf, onLabAudioChange } from './lab-audio.ts';

/** Seconds into the buffer playing as `id`, updated every animation frame, or null when it isn't playing. */
export function useLabPlayhead(id: string): number | null {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const now = labPlayheadOf(id);
      setAt(now);
      if (now !== null) frame = requestAnimationFrame(tick);
    };
    const unsubscribe = onLabAudioChange(() => {
      cancelAnimationFrame(frame);
      tick();
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [id]);
  return at;
}
