// use-pause-rig-playback.ts: the rig's transport over its playlist: which entry plays, whether it runs on to the next,
// and recutting what plays whenever a knob moves, carrying on from the same moment of the take.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { LibraryFootage } from '#lib/footage/library/models/library-footage.ts';
import { spokenStretchSeconds, type RecordedSpeech } from '#lib/timing/voice/models/recorded-speech.ts';
import { pauseRigLineTimeOf, type PauseRigClip } from './pause-rig-lines.ts';
import { createPauseRigPlayer, type PauseRigPlayhead } from './pause-rig-player.ts';

/** What the rig plays: a clip around one change, or a whole line. */
export type PauseRigEntry = { line: number; clip?: PauseRigClip };

// Seconds between one clip's end and the next one's start, so each lands as its own.
const BETWEEN_CLIPS_MS = 600;
// Knobs settle this long before what plays is cut again.
const RECUT_MS = 120;

type PauseRigPlaybackInput = {
  entries: readonly PauseRigEntry[];
  /** Each line's cut, or why it has none. */
  speeches: readonly (RecordedSpeech | string)[];
  takeOf: (line: number) => LibraryFootage | undefined;
  video: RefObject<HTMLVideoElement | null>;
};

export function usePauseRigPlayback({ entries, speeches, takeOf, video }: PauseRigPlaybackInput) {
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  const [head, setHead] = useState<PauseRigPlayhead>({ playing: false, line: 0, item: 0 });
  const player = useMemo(() => createPauseRigPlayer(), []);
  useEffect(() => {
    const unsubscribe = player.subscribe(setHead);
    return () => {
      unsubscribe();
      player.stop();
    };
  }, [player]);

  const entry: PauseRigEntry | undefined = entries[Math.min(index, entries.length - 1)];
  const speech = entry && speeches[entry.line];
  const take = entry && takeOf(entry.line);
  const runningRef = useRef(running), headRef = useRef(head), playingKey = useRef('');
  useEffect(() => {
    runningRef.current = running;
    headRef.current = head;
  }, [running, head]);

  const start = useCallback((itemAt?: number) => {
    if (!entry || !take || typeof speech !== 'object' || !video.current) return;
    const [from, to] = entry.clip ? [pauseRigLineTimeOf(speech, entry.clip.from), pauseRigLineTimeOf(speech, entry.clip.to)] : [0, spokenStretchSeconds(speech)];
    const at = itemAt === undefined ? from : Math.min(Math.max(from, pauseRigLineTimeOf(speech, itemAt)), to);
    void player.play(take.item, speech, at, to, video.current, () => {
      if (runningRef.current) setTimeout(() => setIndex((i) => (i + 1) % entries.length), BETWEEN_CLIPS_MS);
    });
  }, [entry, take, speech, player, entries.length, video]);

  // The same entry recut resumes where the take was; another entry starts from its beginning.
  const key = entry ? `${entry.line}:${entry.clip?.from ?? 'line'}` : '';
  useEffect(() => {
    if (!running) {
      player.stop();
      return undefined;
    }
    const resumeAt = headRef.current.playing && playingKey.current === key ? headRef.current.item : undefined;
    const timer = setTimeout(() => {
      playingKey.current = key;
      start(resumeAt);
    }, RECUT_MS);
    return () => clearTimeout(timer);
  }, [running, start, key, player]);

  const step = (by: number) => setIndex((i) => (i + by + entries.length) % entries.length);
  return {
    entry, speech, take, head, running, index: Math.min(index, entries.length - 1),
    toggle: () => setRunning((on) => !on),
    replay: () => {
      playingKey.current = key;
      setRunning(true);
      start();
    },
    step,
    jumpTo: setIndex,
  };
}
