// library-pause-pacing.ts: how a recorded line plays a long pause faster instead of cutting it, so the face filmed
// with it never jumps. The pause's quiet speeds up on a ramp, holds, and slows back to the speaker's own pace before
// the next word; sound and picture follow one time map, and a screen beside them keeps its own clock.
//
// Prior art: auto-editor's and Jumpcutter's `--silent-speed` (silence at one speed, speech at another, with no ramp),
// Audacity's Truncate Silence compressing what passes a threshold, Descript's "Shorten word gaps" (a target length).
// Unlike them, a pause's target depends on what it's for (spoken-pauses.ts): Adobe warns that removing pauses in bulk
// flattens the ones held for effect.
import type { SpokenPauseClassifier, SpokenPauseKind } from '#lib/footage/transcript/models/spoken-pauses.ts';
import type { SpokenWord } from '#lib/footage/transcript/models/spoken-word.ts';

/**
 * How a line paces its pauses. Seconds are for a speaker at LIBRARY_REFERENCE_SYLLABLE_RATE: a slower one's targets
 * stretch, a faster one's shrink, within a third either way.
 */
export type LibraryPausePacing = {
  /** How long a pause mid-phrase plays at most, word to word, in seconds. */
  hesitation: number;
  /** How long a pause where a sentence or clause ends plays at least once shortened, in seconds. */
  boundary: number;
  /** The share of a boundary pause past `boundary` it keeps (0 to 1), so one held for effect stays longer than a plain one. */
  boundaryExcess: number;
  /** The fastest a pause plays, as a multiple of its recorded speed, unless it would then play longer than `longest`. */
  topSpeed: number;
  /** Seconds a pause takes to reach its speed after the word before it, and to come back before the next. */
  ramp: number;
  /** The longest a pause plays once sped up, in seconds: one longer at `topSpeed` goes faster still. */
  longest: number;
  /** What each pause is for. Default spokenPauseKindOf. */
  classify?: SpokenPauseClassifier;
};

/** The pacing a line gets unless its cleanup says otherwise: conservative, so a pause that carries meaning still reads. */
export const LIBRARY_PAUSE_PACING: LibraryPausePacing = { hesitation: 0.3, boundary: 0.6, boundaryExcess: 0.25, topSpeed: 3, ramp: 0.2, longest: 1.6 };

/**
 * Syllables a second, pauses left out, of the speaker pacing's seconds are written for. Conversational English runs
 * 4.5 to 6 (articulation rate); this studio's own takes measure about 5.
 */
export const LIBRARY_REFERENCE_SYLLABLE_RATE = 5;
// A speaker this far from the reference still gets targets near it: whisper's word timings measure the rate roughly.
const RATE_SCALE_MIN = 0.75, RATE_SCALE_MAX = 1.33;

// Vowel groups, less a silent final e: a count within a syllable of a dictionary's on most English words.
const syllablesIn = (text: string) => {
  const word = text.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  return Math.max(1, (word.replace(/(?<=[^aeiouy])e$/, '').match(/[aeiouy]+/g) ?? []).length);
};

/**
 * The speaker's articulation rate over `words`, in syllables a second: their syllables over the time they sound, with
 * the `quiet` whisper stretched a word across left out. Undefined with too few words to say.
 */
export function librarySyllableRate(words: readonly SpokenWord[], quiet: readonly { start: number; end: number }[]): number | undefined {
  let syllables = 0, sounding = 0, q = 0;
  for (const word of words) {
    while (q < quiet.length && quiet[q].end <= word.start) q++;
    let silent = 0;
    for (let k = q; k < quiet.length && quiet[k].start < word.end; k++) silent += Math.min(word.end, quiet[k].end) - Math.max(word.start, quiet[k].start);
    syllables += syllablesIn(word.text);
    sounding += Math.max(0, word.end - word.start - silent);
  }
  return syllables >= 20 && sounding > 0 ? syllables / sounding : undefined;
}

/** How much a speaker at `rate` syllables a second stretches pacing's seconds. */
export const libraryPaceScale = (rate: number | undefined) =>
  rate === undefined ? 1 : Math.min(RATE_SCALE_MAX, Math.max(RATE_SCALE_MIN, LIBRARY_REFERENCE_SYLLABLE_RATE / rate));

/** How long a pause of `kind` heard for `heard` seconds plays, word to word, under `pacing` scaled by `scale`. */
export function libraryPauseTarget(kind: SpokenPauseKind, heard: number, pacing: LibraryPausePacing, scale: number): number {
  const target = (kind === 'boundary' ? pacing.boundary : pacing.hesitation) * scale;
  if (heard <= target) return heard;
  return kind === 'boundary' ? target + (heard - target) * pacing.boundaryExcess : target;
}

/** A stretch of a pause's quiet played at one speed: `length` item seconds at `speed`. */
export type LibraryPauseStep = { length: number; speed: number };

// A ramp moves in steps about this long: each is a piece of its own, and a preview places a piece to the frame.
const RAMP_STEP = 1 / 30;

/**
 * Quiet `length` item seconds long, played in about `plays` seconds: rising from speed 1 on a straight ramp of `ramp`
 * seconds, holding, and falling back, as steps whose lengths sum to `length`. A top speed it can't pass makes it play
 * longer; a span too short for both ramps peaks below the top. None when it already plays in time.
 */
export function libraryPauseSteps(length: number, plays: number, { topSpeed, ramp }: Pick<LibraryPausePacing, 'topSpeed' | 'ramp'>): LibraryPauseStep[] {
  if (length <= plays + 1e-6) return [];
  let r = Math.min(ramp, plays / 2), peak = (length - r) / Math.max(1e-6, plays - r), hold = plays - 2 * r;
  if (peak > topSpeed) {
    peak = topSpeed;
    // Item seconds both full ramps cover; a shorter span ramps up and straight back down, never holding.
    if (length >= ramp * (1 + topSpeed)) [r, hold] = [ramp, (length - ramp * (1 + topSpeed)) / topSpeed];
    else [r, hold] = [length / (1 + topSpeed), 0];
  }
  const n = Math.max(1, Math.round(r / RAMP_STEP)), stepLine = r / n;
  const up = Array.from({ length: n }, (_, k) => 1 + ((peak - 1) * (k + 0.5)) / n);
  const speeds = [...up.map((speed) => ({ line: stepLine, speed })), ...(hold > 1e-6 ? [{ line: hold, speed: peak }] : []), ...up.toReversed().map((speed) => ({ line: stepLine, speed }))];
  const steps = speeds.map(({ line, speed }) => ({ length: line * speed, speed }));
  // Rounding in the ramp's sums lands on the last step, so the steps cover the quiet exactly.
  steps.at(-1)!.length += length - steps.reduce((sum, s) => sum + s.length, 0);
  return steps;
}

/** How long `steps` play, in seconds. */
export const libraryPauseStepsSeconds = (steps: readonly LibraryPauseStep[]) => steps.reduce((sum, s) => sum + s.length / s.speed, 0);
