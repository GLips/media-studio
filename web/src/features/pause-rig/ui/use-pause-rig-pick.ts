// use-pause-rig-pick.ts: the "1 or 2?" session, kept across reloads: the tuner, the turn it asks, playing that turn's
// two versions back to back, the answer chosen (once both have played), how the picked one felt and a note, all taken
// together on Next, and then a pass confirming whole lines at the values it settled on. Every answer is appended to
// picks.jsonl, a note to notes.jsonl as well.
import { useLocalStorage } from '@mantine/hooks';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { LibraryFootage } from '#lib/footage/library/models/library-footage.ts';
import { spokenStretchSeconds, type RecordedSpeech } from '#lib/timing/voice/models/recorded-speech.ts';
import { appendPauseRigLogFn, type PauseRigLogEntry } from '../controllers/pause-rig-log.ts';
import { PAUSE_RIG_CONFIRM_LINES, PAUSE_RIG_LINES, pauseRigLeadStart, pauseRigLineTimeOf, pauseRigWithLeadIn, type PauseRigClip } from './pause-rig-lines.ts';
import { createPauseRigPlayer } from './pause-rig-player.ts';
import {
  nextPauseRigTrial, pauseRigTunedValues, pauseRigUnshownKnobs, pickPauseRigTrial, skipPauseRigTrial, startPauseRigTuner,
  type PauseRigFeel, type PauseRigMeasure, type PauseRigPick, type PauseRigTrial, type PauseRigTunedValues, type PauseRigTuner,
} from './pause-rig-tuner.ts';

/** Which of a turn's two versions plays, or the confirmation pass's line. */
export type PauseRigVersion = 'first' | 'second' | 'line';

// Silence between the two versions, so each lands as its own.
const BETWEEN_VERSIONS_MS = 700;
// A version counts as heard once it has played its clip or this long, whichever comes first, so a playback that
// stalls never locks the answers; and it is stopped this long past its clip's end.
const HEARD_AFTER_MS = 8000, OVERRUN_MS = 1500;
// Seconds of the line as played a clip leads into its pause with, as offered and at first.
export const PAUSE_RIG_LEAD_INS: readonly number[] = [2, 4, 6];
const LEAD_IN_KEY = 'pause-rig-lead-in';
// Bumped whenever a session saved before would mislead: a reload then starts afresh.
const SESSION_KEY = 'pause-rig-pick-v4';

type PauseRigConfirmation = { line: number; natural: boolean; note: string };
type PauseRigSession = { tuner: PauseRigTuner; trial?: PauseRigTrial; history: PauseRigTuner[]; confirming: boolean; confirmed: PauseRigConfirmation[] };
/** What's said about the turn on show before Next takes it: the answer, how the picked one felt, a note. */
type PauseRigDraft = { asking: string; pick?: PauseRigPick; feel?: PauseRigFeel; note: string };

type PauseRigPickInput = {
  active: boolean;
  /** Every clip the tuner may ask about. */
  clips: readonly PauseRigClip[];
  /** A line cut under `values`, or why it can't be. */
  cut: (line: number, values: PauseRigTunedValues) => RecordedSpeech | string;
  /** The take of `line` from `from` to `to` as recorded, its pauses untreated, or why it can't be. */
  cutAsRecorded: (line: number, from: number, to: number) => RecordedSpeech | string;
  takeOf: (line: number) => LibraryFootage | undefined;
  video: RefObject<HTMLVideoElement | null>;
  /** What a restarted session starts from. */
  start: PauseRigTunedValues;
};

const logPauseRigPick = (entry: PauseRigLogEntry, log: 'picks' | 'notes' = 'picks') => void appendPauseRigLogFn({ data: { log, entry: JSON.stringify({ at: new Date().toISOString(), ...entry }) } });
const clipOfLog = (trial: PauseRigTrial) => {
  const spec = PAUSE_RIG_LINES[trial.clip.line];
  return { item: spec.item, from: trial.clip.from, to: trial.clip.to, about: trial.clip.about };
};

export function usePauseRigPick({ active, clips, cut, cutAsRecorded, takeOf, video, start }: PauseRigPickInput) {
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
  const [draftState, setDraft] = useState<PauseRigDraft>({ asking: '', note: '' });
  const draft = draftState.asking === asking ? draftState : { asking, note: '' };
  const amend = (change: Partial<PauseRigDraft>) => setDraft(Object.assign({}, draft, change));

  // A session with no turn asked draws one, and once none is left, moves on to confirming. The turn is kept, so a
  // reload asks the same.
  const measure: PauseRigMeasure = (knob, clip, value) => {
    const speech = cut(clip.line, { ...best, [knob]: value });
    const pause = typeof speech === 'string' ? undefined : speech.pauses.find((p) => p.from === clip.pause?.from);
    return pause && { plays: pause.plays, speed: pause.speed };
  };
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- measure reads only clips' cuts at the tuner's values
  const unshown = useMemo(() => (clips.length ? pauseRigUnshownKnobs(session.tuner, clips, measure) : []), [session.tuner, clips]);
  useEffect(() => {
    if (trial || session.confirming || clips.length === 0) return;
    const next = nextPauseRigTrial(session.tuner, clips, measure, Math.random(), Math.random());
    setSession((s) => (next ? { ...s, trial: next } : { ...s, confirming: true }));
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- measure reads only clips' cuts at the tuner's values
  }, [trial, session.confirming, clips, session.tuner, setSession]);

  const [leadIn, storeLeadIn] = useLocalStorage({ key: LEAD_IN_KEY, defaultValue: 4, getInitialValueInEffect: false });
  // Read when a clip plays, so a lead-in just chosen applies to the replay it starts.
  const leadInNow = useRef(leadIn);
  leadInNow.current = leadIn;
  const [leadGot, setLeadGot] = useState<number | undefined>();
  const watch = useRef<{ heard?: ReturnType<typeof setTimeout>; overrun?: ReturnType<typeof setTimeout> }>({});
  const playStretch = (version: PauseRigVersion, line: number, values: PauseRigTunedValues, range: (speech: RecordedSpeech) => [RecordedSpeech, number, number], then?: () => void) => {
    const take = takeOf(line), cutSpeech = cut(line, values);
    if (!take || !video.current || typeof cutSpeech === 'string') return;
    setPlaying(version);
    setLastPlayed(version);
    const [speech, from, to] = range(cutSpeech);
    const heardAs = asking;
    const markHeard = () => setHeard((h) => {
      if (h.asking !== heardAs) return { asking: heardAs, versions: [version] };
      return h.versions.includes(version) ? h : { asking: heardAs, versions: [...h.versions, version] };
    });
    clearTimeout(watch.current.heard);
    clearTimeout(watch.current.overrun);
    const ended = () => {
      clearTimeout(watch.current.heard);
      clearTimeout(watch.current.overrun);
      setPlaying(undefined);
      markHeard();
      then?.();
    };
    watch.current.heard = setTimeout(markHeard, Math.min(HEARD_AFTER_MS, (to - from) * 1000));
    watch.current.overrun = setTimeout(() => {
      player.stop();
      ended();
    }, (to - from) * 1000 + OVERRUN_MS);
    void player.play(take.item, speech, from, to, video.current, ended);
  };
  const play = (version: PauseRigVersion, then?: () => void) => {
    if (version === 'line' && confirmLine !== undefined) playStretch('line', confirmLine, best, (s) => [s, 0, spokenStretchSeconds(s)]);
    if (version !== 'line' && trial) {
      const { clip } = trial, take = takeOf(clip.line), pauseFrom = clip.pause?.from ?? clip.from;
      playStretch(version, clip.line, { ...best, [trial.knob]: trial[version] }, (line) => {
        const from = pauseRigLeadStart(take?.words ?? [], line, pauseFrom, leadInNow.current);
        const lead = from < line.from ? cutAsRecorded(clip.line, from, line.from) : undefined;
        const speech = lead && typeof lead !== 'string' ? pauseRigWithLeadIn(lead, line) : line;
        const at = pauseRigLineTimeOf(speech, from);
        setLeadGot(pauseRigLineTimeOf(speech, pauseFrom) - at);
        return [speech, at, pauseRigLineTimeOf(speech, clip.to)];
      }, then);
    }
  };
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stop = () => {
    clearTimeout(timer.current);
    clearTimeout(watch.current.heard);
    clearTimeout(watch.current.overrun);
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

  /** Takes the turn on show as drafted: the answer, moved by how the picked one felt, and its note. */
  const next = () => {
    const { pick: choice, feel, note } = draft;
    if (!trial || !ready || !choice) return;
    stop();
    const felt = choice === 'same' ? undefined : feel;
    const tuner = pickPauseRigTrial(session.tuner, trial, choice, felt);
    const about = { knob: trial.knob, clip: clipOfLog(trial), version1: trial.first, version2: trial.second, pick: choice };
    logPauseRigPick({
      type: trial.repeatOf === undefined ? 'pick' : 'repeat', ...about, ...(felt && { feel: felt }), ...(note.trim() && { note: note.trim() }),
      before: best, after: pauseRigTunedValues(tuner), ...(trial.repeatOf !== undefined && { firstTime: session.tuner.answers[trial.repeatOf].chose }),
    });
    if (note.trim()) logPauseRigPick({ mode: '1 or 2', ...about, ...(felt && { feel: felt }), values: best, text: note.trim() }, 'notes');
    setSession((s) => ({ ...s, tuner, trial: undefined, history: [...s.history, s.tuner] }));
  };
  const confirm = (natural: boolean, note: string) => {
    if (confirmLine === undefined || !ready) return;
    stop();
    const spec = PAUSE_RIG_LINES[confirmLine];
    logPauseRigPick({ type: 'confirm', line: { item: spec.item, from: spec.from, to: spec.to, about: spec.about }, values: best, natural, note });
    setSession((s) => ({ ...s, confirmed: [...s.confirmed, { line: confirmLine, natural, note }] }));
  };

  return {
    session, best, trial, unshown, playing, leadIn, leadGot,
    /** Moves on from the pair on show without answering it: logged, and no knob moves. */
    skip: () => {
      if (!trial) return;
      stop();
      logPauseRigPick({ type: 'skip', knob: trial.knob, clip: clipOfLog(trial), version1: trial.first, version2: trial.second });
      setSession((s) => ({ ...s, tuner: skipPauseRigTrial(s.tuner, trial), trial: undefined }));
    },
    /** Leads clips in with `seconds`, replaying the pair on show with it. */
    setLeadIn: (seconds: number) => {
      storeLeadIn(seconds);
      leadInNow.current = seconds;
      if (trial) playBoth();
    }, ready, heard: heardNow, confirmLine, stop, confirm, playBoth, next, draft,
    /** Chooses an answer once both have played; choosing it again, or another, changes it until Next. */
    choose: (choice: PauseRigPick) => {
      if (ready && trial) amend({ pick: choice });
    },
    /** How the picked one felt; the same again takes it back. */
    feel: (felt: PauseRigFeel) => amend({ feel: draft.feel === felt ? undefined : felt }),
    writeNote: (note: string) => amend({ note }),
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
    undo: () => setSession((s) => (s.history.length ? { ...s, tuner: s.history.at(-1)!, trial: undefined, history: s.history.slice(0, -1), confirming: false, confirmed: [] } : s)),
    confirmNow: () => setSession((s) => ({ ...s, trial: undefined, confirming: true, confirmed: [] })),
    restart: () => setSession(fresh()),
  };
}
