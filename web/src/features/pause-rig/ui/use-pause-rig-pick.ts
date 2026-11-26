// use-pause-rig-pick.ts: the "1 or 2?" session, kept across reloads: the tuner, the turn it asks, playing that turn's
// two versions back to back, the pick (taken only once both have played), how the picked one felt, and then a pass
// confirming whole lines at the values it settled on. Every answer is appended to picks.jsonl.
import { useLocalStorage } from '@mantine/hooks';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { LibraryFootage } from '#lib/footage/library/models/library-footage.ts';
import { spokenStretchSeconds, type RecordedSpeech } from '#lib/timing/voice/models/recorded-speech.ts';
import { appendPauseRigLogFn, type PauseRigLogEntry } from '../controllers/pause-rig-log.ts';
import { PAUSE_RIG_CONFIRM_LINES, PAUSE_RIG_LINES, pauseRigLineTimeOf, type PauseRigClip } from './pause-rig-lines.ts';
import { createPauseRigPlayer } from './pause-rig-player.ts';
import {
  nextPauseRigTrial, pauseRigTunedValues, pickPauseRigTrial, startPauseRigTuner,
  type PauseRigFeel, type PauseRigPick, type PauseRigTrial, type PauseRigTunedValues, type PauseRigTuner,
} from './pause-rig-tuner.ts';

/** Which of a turn's two versions plays, or the confirmation pass's line. */
export type PauseRigVersion = 'first' | 'second' | 'line';

// Silence between the two versions, so each lands as its own.
const BETWEEN_VERSIONS_MS = 700;
// Bumped whenever a session saved before would mislead: a reload then starts afresh.
const SESSION_KEY = 'pause-rig-pick-v2';

type PauseRigConfirmation = { line: number; natural: boolean; note: string };
/** The turn just answered, so how the picked version felt can still be said once the next is drawn. */
type PauseRigLastAnswer = { before: PauseRigTuner; trial: PauseRigTrial; pick: PauseRigPick; feel?: PauseRigFeel };
type PauseRigSession = {
  tuner: PauseRigTuner; trial?: PauseRigTrial; last?: PauseRigLastAnswer; history: PauseRigTuner[];
  confirming: boolean; confirmed: PauseRigConfirmation[];
};

type PauseRigPickInput = {
  active: boolean;
  /** Every clip the tuner may ask about. */
  clips: readonly PauseRigClip[];
  /** A line cut under `values`, or why it can't be. */
  cut: (line: number, values: PauseRigTunedValues) => RecordedSpeech | string;
  takeOf: (line: number) => LibraryFootage | undefined;
  video: RefObject<HTMLVideoElement | null>;
  /** What a restarted session starts from. */
  start: PauseRigTunedValues;
};

const logPauseRigPick = (entry: PauseRigLogEntry) => void appendPauseRigLogFn({ data: { log: 'picks', entry: JSON.stringify({ at: new Date().toISOString(), ...entry }) } });
const clipOfLog = (trial: PauseRigTrial) => {
  const spec = PAUSE_RIG_LINES[trial.clip.line];
  return { item: spec.item, from: trial.clip.from, to: trial.clip.to, about: trial.clip.about };
};

export function usePauseRigPick({ active, clips, cut, takeOf, video, start }: PauseRigPickInput) {
  const fresh = (): PauseRigSession => ({ tuner: startPauseRigTuner(start), history: [], confirming: false, confirmed: [] });
  const [session, setSession] = useLocalStorage<PauseRigSession>({ key: SESSION_KEY, defaultValue: fresh(), getInitialValueInEffect: false });
  const [playing, setPlaying] = useState<PauseRigVersion | undefined>();
  const [lastPlayed, setLastPlayed] = useState<PauseRigVersion | undefined>();
  const player = useMemo(() => createPauseRigPlayer(), []);
  const best = pauseRigTunedValues(session.tuner);
  const { trial } = session;
  const confirmLine = session.confirming ? PAUSE_RIG_CONFIRM_LINES[session.confirmed.length] : undefined;

  // What's asked now; what has played through of it is kept against it, so a new question starts unheard.
  let asking = '';
  if (confirmLine !== undefined) asking = `line:${confirmLine}`;
  else if (trial) asking = `${trial.knob}:${trial.clip.line}:${trial.clip.from}:${trial.first}:${trial.second}`;
  const [heard, setHeard] = useState<{ asking: string; versions: PauseRigVersion[] }>({ asking: '', versions: [] });
  const heardNow = heard.asking === asking ? heard.versions : [];
  const ready = confirmLine === undefined ? heardNow.includes('first') && heardNow.includes('second') : heardNow.includes('line');

  // A session with no turn asked draws one, and once none is left, moves on to confirming. The turn is kept, so a
  // reload asks the same.
  useEffect(() => {
    if (trial || session.confirming || clips.length === 0) return;
    const next = nextPauseRigTrial(session.tuner, clips, Math.random(), Math.random());
    setSession((s) => (next ? { ...s, trial: next } : { ...s, confirming: true }));
  }, [trial, session.confirming, clips, session.tuner, setSession]);

  const playStretch = (version: PauseRigVersion, line: number, values: PauseRigTunedValues, range: (speech: RecordedSpeech) => [number, number], then?: () => void) => {
    const take = takeOf(line), speech = cut(line, values);
    if (!take || !video.current || typeof speech === 'string') return;
    setPlaying(version);
    setLastPlayed(version);
    const [from, to] = range(speech);
    const heardAs = asking;
    void player.play(take.item, speech, from, to, video.current, () => {
      setPlaying(undefined);
      setHeard((h) => (h.asking === heardAs ? { asking: heardAs, versions: [...h.versions, version] } : { asking: heardAs, versions: [version] }));
      then?.();
    });
  };
  const play = (version: PauseRigVersion, then?: () => void) => {
    if (version === 'line' && confirmLine !== undefined) playStretch('line', confirmLine, best, (s) => [0, spokenStretchSeconds(s)]);
    if (version !== 'line' && trial) {
      const { clip } = trial;
      playStretch(version, clip.line, { ...best, [trial.knob]: trial[version] }, (s) => [pauseRigLineTimeOf(s, clip.from), pauseRigLineTimeOf(s, clip.to)], then);
    }
  };
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stop = () => {
    clearTimeout(timer.current);
    player.stop();
    setPlaying(undefined);
  };
  const playBoth = () => {
    stop();
    if (confirmLine !== undefined) play('line');
    else {
      play('first', () => {
        timer.current = setTimeout(() => play('second'), BETWEEN_VERSIONS_MS);
      });
    }
  };
  useEffect(() => {
    if (!active) stop();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- stop reads only refs and the player
  }, [active]);

  const pick = (choice: PauseRigPick) => {
    if (!trial || !ready) return;
    stop();
    const tuner = pickPauseRigTrial(session.tuner, trial, choice);
    logPauseRigPick({
      type: trial.repeatOf === undefined ? 'pick' : 'repeat', knob: trial.knob, clip: clipOfLog(trial),
      version1: trial.first, version2: trial.second, pick: choice, before: best, after: pauseRigTunedValues(tuner),
      ...(trial.repeatOf !== undefined && { firstTime: session.tuner.answers[trial.repeatOf].chose }),
    });
    setSession((s) => ({ ...s, tuner, trial: undefined, last: { before: s.tuner, trial, pick: choice }, history: [...s.history, s.tuner] }));
  };
  // How the picked version felt moves the answer just given: replayed from before it, with the feel.
  const feel = (felt: PauseRigFeel) => {
    const { last } = session;
    if (!last || last.pick === 'same') return;
    const tuner = pickPauseRigTrial(last.before, last.trial, last.pick, felt);
    logPauseRigPick({ type: 'feel', knob: last.trial.knob, clip: clipOfLog(last.trial), pick: last.pick, feel: felt, after: pauseRigTunedValues(tuner) });
    setSession((s) => ({ ...s, tuner, trial: undefined, last: { ...last, feel: felt } }));
  };
  const confirm = (natural: boolean, note: string) => {
    if (confirmLine === undefined || !ready) return;
    stop();
    const spec = PAUSE_RIG_LINES[confirmLine];
    logPauseRigPick({ type: 'confirm', line: { item: spec.item, from: spec.from, to: spec.to, about: spec.about }, values: best, natural, note });
    setSession((s) => ({ ...s, confirmed: [...s.confirmed, { line: confirmLine, natural, note }] }));
  };

  return {
    session, best, trial, playing, ready, heard: heardNow, confirmLine, stop, pick, feel, confirm, playBoth,
    /** How the picked version felt can be said until the next turn starts playing. */
    feelable: session.last !== undefined && session.last.pick !== 'same' && heardNow.length === 0 && playing === undefined,
    /** The line on show, and the clip of it when a turn is asked. */
    line: confirmLine ?? trial?.clip.line,
    clip: confirmLine === undefined ? trial?.clip : undefined,
    /** What a note written now is about. */
    shown: () => (confirmLine === undefined
      ? trial && { knob: trial.knob, version1: trial.first, version2: trial.second, playing: playing ?? lastPlayed }
      : { confirming: 'the whole line at the values tuned so far' }),
    play: (version: PauseRigVersion) => {
      stop();
      play(version);
    },
    undo: () => setSession((s) => (s.history.length ? { ...s, tuner: s.history.at(-1)!, trial: undefined, last: undefined, history: s.history.slice(0, -1), confirming: false, confirmed: [] } : s)),
    confirmNow: () => setSession((s) => ({ ...s, trial: undefined, last: undefined, confirming: true, confirmed: [] })),
    restart: () => setSession(fresh()),
  };
}
