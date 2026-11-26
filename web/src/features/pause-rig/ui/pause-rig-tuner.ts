// pause-rig-tuner.ts: "1 or 2?", the way an optometrist finds a prescription. Each turn plays one short clip around one
// pause twice, a knob a step either side of its best, in random order, on a clip where the two measurably differ. A
// staircase per knob starts on a plain difference: the pick becomes its best, a felt direction ("rushed", "draggy")
// nudges it half a step, a reversal or "can't tell" halves the step, and a knob settles once its step passes the
// finest a listener notices or its turns run out. Now and then an earlier pair repeats, to measure consistency. Pure.
import type { LibraryPausePacing } from '#lib/footage/library/models/library-pause-pacing.ts';
import type { PauseRigClip } from './pause-rig-lines.ts';

/** A knob the tuner sets. */
export type PauseRigTunedKnob = 'hesitation' | 'boundary' | 'boundaryExcess' | 'topSpeed' | 'ramp' | 'longest';
export type PauseRigTunedValues = Pick<LibraryPausePacing, PauseRigTunedKnob>;

/** One turn: `knob` at `first` then `second` over `clip`; a repeat names the earlier answer it asks again. */
export type PauseRigTrial = { knob: PauseRigTunedKnob; clip: PauseRigClip; first: number; second: number; repeatOf?: number };
export type PauseRigPick = 'first' | 'second' | 'same';
/** How the listener says the version they picked felt. */
export type PauseRigFeel = 'rushed' | 'draggy' | 'choppy' | 'fine';
export const PAUSE_RIG_FEELS: readonly PauseRigFeel[] = ['rushed', 'draggy', 'choppy', 'fine'];

/** A knob's best value, its step, and which way it last moved (-1, 0 for not yet, 1). */
type Stair = { value: number; step: number; last: number };
/** An answered turn: the value picked, or `same` when the listener couldn't tell. */
type PauseRigAnswer = { trial: PauseRigTrial; chose: number | 'same' };
/** Where tuning stands: each knob's staircase and turns, every answer, and how often repeats agreed. */
export type PauseRigTuner = {
  stairs: Record<PauseRigTunedKnob, Stair>;
  turns: Record<PauseRigTunedKnob, number>;
  answers: PauseRigAnswer[];
  repeats: { asked: number; agreed: number };
};

// Each knob's first step (a pair a step either side of its best differs plainly), the finest step a listener notices
// (about 45 ms of pause), its range, and the kind of pause it acts on. `seconds` marks a knob set in seconds of pause.
// `slower` is the way the knob moves to leave more of a pause.
const KNOBS: Record<PauseRigTunedKnob, { step: number; finest: number; min: number; max: number; seconds: boolean; slower: 1 | -1; kind?: 'hesitation' | 'boundary' }> = {
  hesitation: { step: 0.225, finest: 0.045, min: 0.05, max: 1.5, seconds: true, slower: 1, kind: 'hesitation' },
  boundary: { step: 0.325, finest: 0.045, min: 0.1, max: 2, seconds: true, slower: 1, kind: 'boundary' },
  boundaryExcess: { step: 0.25, finest: 0.05, min: 0, max: 1, seconds: false, slower: 1, kind: 'boundary' },
  topSpeed: { step: 1.25, finest: 0.2, min: 1.2, max: 8, seconds: false, slower: -1 },
  ramp: { step: 0.2, finest: 0.04, min: 0, max: 0.6, seconds: true, slower: 1 },
  longest: { step: 0.8, finest: 0.1, min: 0.5, max: 5, seconds: true, slower: 1 },
};

/** How a clip's pause plays at one value of a knob: seconds it lasts, and its face's top speed. */
export type PauseRigPausePlayed = { plays: number; speed: number };
/** How `clip`'s pause plays with `knob` at `value` and every other knob at its best, or undefined when it doesn't. */
export type PauseRigMeasure = (knob: PauseRigTunedKnob, clip: PauseRigClip, value: number) => PauseRigPausePlayed | undefined;

// Two versions differ enough to ask about when their pause lengths part by this much (and a third of a step in
// seconds), or their faces' top speeds by this much.
const PLAYED_APART = 0.06, SPEED_APART = 0.5;

/** Whether `a` and `b` played differ enough for a listener to choose between them at `step` of `knob`. */
function pauseRigVersionsDiffer(knob: PauseRigTunedKnob, step: number, a: PauseRigPausePlayed | undefined, b: PauseRigPausePlayed | undefined): boolean {
  if (!a || !b) return false;
  const apart = Math.max(PLAYED_APART, KNOBS[knob].seconds ? step / 3 : 0);
  return Math.abs(a.plays - b.plays) >= apart || Math.abs(a.speed - b.speed) >= SPEED_APART;
}
export const PAUSE_RIG_TUNED_KNOBS: readonly PauseRigTunedKnob[] = ['hesitation', 'boundary', 'boundaryExcess', 'topSpeed', 'ramp', 'longest'];

// A knob is settled after this many turns, however fine its step: a session should end.
const TURNS_PER_KNOB = 8;
// Every this many turns, one repeats an earlier pair.
const REPEAT_EVERY = 6;

const round = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (knob: PauseRigTunedKnob, value: number) => round(Math.min(KNOBS[knob].max, Math.max(KNOBS[knob].min, value)));

/** Which way `feel` says `knob` should move: rushed wants more pause left, draggy less, choppy a gentler ramp and top. */
function feltDirection(knob: PauseRigTunedKnob, feel: PauseRigFeel | undefined): number {
  if (feel === 'rushed') return KNOBS[knob].slower;
  if (feel === 'draggy') return -KNOBS[knob].slower;
  if (feel === 'choppy' && (knob === 'topSpeed' || knob === 'ramp')) return KNOBS[knob].slower;
  return 0;
}

/** `of` for every knob. */
function eachPauseRigKnob<T>(of: (knob: PauseRigTunedKnob) => T): Record<PauseRigTunedKnob, T> {
  return { hesitation: of('hesitation'), boundary: of('boundary'), boundaryExcess: of('boundaryExcess'), topSpeed: of('topSpeed'), ramp: of('ramp'), longest: of('longest') };
}

export function startPauseRigTuner(from: PauseRigTunedValues): PauseRigTuner {
  return { stairs: eachPauseRigKnob((k) => ({ value: clamp(k, from[k]), step: KNOBS[k].step, last: 0 })), turns: eachPauseRigKnob(() => 0), answers: [], repeats: { asked: 0, agreed: 0 } };
}

export const pauseRigTunedValues = (tuner: PauseRigTuner): PauseRigTunedValues => eachPauseRigKnob((k) => tuner.stairs[k].value);

export const pauseRigKnobSettled = (tuner: PauseRigTuner, knob: PauseRigTunedKnob) =>
  tuner.stairs[knob].step < KNOBS[knob].finest || tuner.turns[knob] >= TURNS_PER_KNOB;

/** The pair `knob` asks next: a step either side of its best. */
const pairOf = (tuner: PauseRigTuner, knob: PauseRigTunedKnob): [number, number] => {
  const { value, step } = tuner.stairs[knob];
  return [clamp(knob, value - step), clamp(knob, value + step)];
};

/** The clips on which `knob`'s next pair plays measurably differently, moving to another take each time. */
function pauseRigClipsShowing(tuner: PauseRigTuner, knob: PauseRigTunedKnob, clips: readonly PauseRigClip[], measure: PauseRigMeasure): PauseRigClip[] {
  const [low, high] = pairOf(tuner, knob), { kind } = KNOBS[knob];
  return acrossTakes(clips.filter((c) => c.pause && (!kind || c.pause.kind === kind)))
    .filter((c) => pauseRigVersionsDiffer(knob, tuner.stairs[knob].step, measure(knob, c, low), measure(knob, c, high)));
}

/** Unsettled knobs no clip in the playlist can show a difference in at their step: the tuner skips them. */
export const pauseRigUnshownKnobs = (tuner: PauseRigTuner, clips: readonly PauseRigClip[], measure: PauseRigMeasure) =>
  PAUSE_RIG_TUNED_KNOBS.filter((k) => !pauseRigKnobSettled(tuner, k) && pauseRigClipsShowing(tuner, k, clips, measure).length === 0);

/** Clips in an order that moves to another take each time: each line's first clip, then each line's second, and so on. */
function acrossTakes(clips: readonly PauseRigClip[]): PauseRigClip[] {
  const seen = new Map<number, number>();
  const ranked = clips.map((clip) => {
    const rank = seen.get(clip.line) ?? 0;
    seen.set(clip.line, rank + 1);
    return { clip, rank };
  });
  return ranked.toSorted((a, b) => a.rank - b.rank || a.clip.line - b.clip.line).map((r) => r.clip);
}

/**
 * The next turn: every REPEAT_EVERY turns an earlier pair again, its order drawn anew; otherwise the next unsettled knob
 * on its next clip where the pair measurably differs. `coin` and `draw` are in [0, 1). Undefined once every knob is
 * settled or can't be shown.
 */
export function nextPauseRigTrial(tuner: PauseRigTuner, clips: readonly PauseRigClip[], measure: PauseRigMeasure, coin: number, draw: number): PauseRigTrial | undefined {
  const order = (trial: Omit<PauseRigTrial, 'first' | 'second'>, a: number, b: number): PauseRigTrial =>
    (coin < 0.5 ? { ...trial, first: a, second: b } : { ...trial, first: b, second: a });
  const asked = tuner.answers.length + tuner.repeats.asked;
  const fresh = tuner.answers.flatMap((a, k) => (a.trial.repeatOf === undefined ? [k] : []));
  if (asked % REPEAT_EVERY === REPEAT_EVERY - 1 && fresh.length) {
    const k = fresh[Math.floor(draw * fresh.length)], { trial } = tuner.answers[k];
    return order({ knob: trial.knob, clip: trial.clip, repeatOf: k }, trial.first, trial.second);
  }
  const last = tuner.answers.at(-1)?.trial.knob;
  const start = last ? PAUSE_RIG_TUNED_KNOBS.indexOf(last) + 1 : 0;
  for (let k = 0; k < PAUSE_RIG_TUNED_KNOBS.length; k++) {
    const knob = PAUSE_RIG_TUNED_KNOBS[(start + k) % PAUSE_RIG_TUNED_KNOBS.length];
    if (pauseRigKnobSettled(tuner, knob)) continue;
    const showing = pauseRigClipsShowing(tuner, knob, clips, measure);
    if (showing.length === 0) continue;
    // Offset by the knob, so knobs asked in a row play different clips.
    return order({ knob, clip: showing[(tuner.turns[knob] + PAUSE_RIG_TUNED_KNOBS.indexOf(knob)) % showing.length] }, ...pairOf(tuner, knob));
  }
  return undefined;
}

/** The tuner once the listener has picked from `trial`, saying how the version they picked felt if they did. */
export function pickPauseRigTrial(tuner: PauseRigTuner, trial: PauseRigTrial, pick: PauseRigPick, feel?: PauseRigFeel): PauseRigTuner {
  const chose = pick === 'same' ? 'same' : trial[pick];
  if (trial.repeatOf !== undefined) {
    const agreed = tuner.answers[trial.repeatOf].chose === chose ? 1 : 0;
    return { ...tuner, repeats: { asked: tuner.repeats.asked + 1, agreed: tuner.repeats.agreed + agreed } };
  }
  const { knob } = trial, stair = tuner.stairs[knob];
  const moved = chose === 'same' ? 0 : Math.sign(chose - stair.value);
  const felt = feltDirection(knob, feel);
  // Which way the evidence points this turn: the pick, else how it felt.
  const way: number = moved || felt;
  const reversed = way !== 0 && stair.last !== 0 && way !== stair.last;
  const step = chose === 'same' || reversed || feel === 'fine' ? stair.step / 2 : stair.step;
  const value = clamp(knob, (chose === 'same' ? stair.value : chose) + (felt * stair.step) / 2);
  return {
    stairs: { ...tuner.stairs, [knob]: { value, step, last: way || stair.last } },
    turns: { ...tuner.turns, [knob]: tuner.turns[knob] + 1 },
    answers: [...tuner.answers, { trial, chose }],
    repeats: tuner.repeats,
  };
}

/**
 * Turns answered, and about how many a session takes in all: every unsettled knob's turns left but those `unshown`,
 * and their repeats.
 */
export function pauseRigTunerProgress(tuner: PauseRigTuner, unshown: readonly PauseRigTunedKnob[]): { done: number; about: number } {
  const done = tuner.answers.length + tuner.repeats.asked;
  const left = PAUSE_RIG_TUNED_KNOBS.reduce((sum, k) => sum + (pauseRigKnobSettled(tuner, k) || unshown.includes(k) ? 0 : TURNS_PER_KNOB - tuner.turns[k]), 0);
  return { done, about: done + left + Math.ceil(left / (REPEAT_EVERY - 1)) };
}
