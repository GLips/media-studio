// voice-drift.ts: whether two takes joined in a comp would be heard as two performances: their pitch and pace on the
// same line. Pure; lib/timing/voice/engine/voice-project.ts warns with it after a comp is cut.
//
// Two lines of one take differ by far more than a join is heard by (a question rises, a list speeds up), so a clip is
// never compared to its neighbour, only a line to itself as each take reads it.
//
// Negative space: no level. The video plays every line at VOICE_LUFS by its manifest `lufs`, so a louder take is
// levelled before anyone hears it.

/** A clip as drift compares it: its median pitch over voiced frames, and syllables per second of speech; null unmeasurable. */
export type VoiceClipMeasure = { pitchHz: number | null; syllablesPerSecond: number | null };

// What a listener notices across a join between takes, tuned on 2026-10-fodmap-app-preview's takes.
const NOTICED_SEMITONES = 1.5;
const NOTICED_PACE = 0.15;

// Pitch frames: long enough for two periods of the lowest voice, a frame every 20 ms.
const PITCH_FRAME = 0.04;
const PITCH_HOP = 0.02;
const LOWEST_HZ = 60;
const HIGHEST_HZ = 400;
// A frame's autocorrelation peak under this is noise or breath, not voice.
const VOICED_CORRELATION = 0.6;
// Of the lags correlating nearly as well as the best, the shortest is the period: its multiples correlate too.
const OCTAVE_TOLERANCE = 0.9;
// Speech frames: 10 ms, louder than a tenth of the loudest frame's level (−20 dB) and than the quiet ceiling.
const SPEECH_FRAME = 0.01;
const SPEECH_FRACTION = 0.1;
const SPEECH_FLOOR = 300;

const rms = (samples: Int16Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

function frameLevels(samples: Int16Array, rate: number, frame: number, hop: number) {
  const size = Math.round(frame * rate), step = Math.round(hop * rate), levels: { at: number; level: number }[] = [];
  for (let at = 0; at + size <= samples.length; at += step) levels.push({ at, level: rms(samples, at, at + size) });
  return { size, levels };
}

const loudEnough = (levels: readonly { level: number }[]) => {
  const loudest = Math.max(0, ...levels.map((l) => l.level));
  return Math.max(SPEECH_FLOOR, loudest * SPEECH_FRACTION);
};

/** The period of one frame by normalized autocorrelation, in samples, or null when it isn't voiced. */
function framePeriod(samples: Int16Array, at: number, size: number, rate: number): number | null {
  const shortest = Math.floor(rate / HIGHEST_HZ), longest = Math.min(Math.ceil(rate / LOWEST_HZ), size - 1);
  const correlation = new Float64Array(longest + 2);
  for (let lag = shortest - 1; lag <= longest + 1; lag++) {
    let cross = 0, a = 0, b = 0;
    for (let i = at; i + lag < at + size; i++) {
      cross += samples[i] * samples[i + lag];
      a += samples[i] * samples[i];
      b += samples[i + lag] * samples[i + lag];
    }
    correlation[lag] = a && b ? cross / Math.sqrt(a * b) : 0;
  }
  let best = 0;
  for (let lag = shortest; lag <= longest; lag++) best = Math.max(best, correlation[lag]);
  if (best < VOICED_CORRELATION) return null;
  for (let lag = shortest; lag <= longest; lag++) {
    if (correlation[lag] < best * OCTAVE_TOLERANCE || correlation[lag] < correlation[lag - 1] || correlation[lag] < correlation[lag + 1]) continue;
    // The peak between samples, from the parabola through it and its neighbours.
    const [l, c, r] = [correlation[lag - 1], correlation[lag], correlation[lag + 1]], bend = l - 2 * c + r;
    return bend ? lag + (l - r) / (2 * bend) : lag;
  }
  return null;
}

const median = (values: readonly number[]) => {
  if (!values.length) return null;
  const sorted = values.toSorted((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The median pitch over a clip's voiced frames, in Hz; null with none voiced. */
export function medianVoicePitchHz(samples: Int16Array, rate: number): number | null {
  const { size, levels } = frameLevels(samples, rate, PITCH_FRAME, PITCH_HOP), floor = loudEnough(levels);
  const pitches = levels.filter((l) => l.level >= floor).flatMap(({ at }) => {
    const period = framePeriod(samples, at, size, rate);
    return period ? [rate / period] : [];
  });
  return median(pitches);
}

/** Seconds of a clip that are speech: its pauses, and the quiet before and after, left out. */
export function voiceSpeechSeconds(samples: Int16Array, rate: number): number {
  const { levels } = frameLevels(samples, rate, SPEECH_FRAME, SPEECH_FRAME), floor = loudEnough(levels);
  return levels.filter((l) => l.level >= floor).length * SPEECH_FRAME;
}

/** A guess at the syllables in `text` (a line as spokenText gives it): a run of vowels each, a final silent e not one. */
export const spokenSyllables = (text: string) =>
  text.toLowerCase().split(/[^a-z']+/).filter(Boolean)
    .reduce((sum, word) => sum + Math.max(1, (word.replace(/(?<=[^aeiouy])e$/, '').match(/[aeiouy]+/g) ?? []).length), 0);

/** `text`'s clip, measured. */
export function measureVoiceClip(text: string, samples: Int16Array, rate: number): VoiceClipMeasure {
  const speech = voiceSpeechSeconds(samples, rate);
  return { pitchHz: medianVoicePitchHz(samples, rate), syllablesPerSecond: speech ? spokenSyllables(text) / speech : null };
}

/**
 * How a take's read of a line differs from another take's read of the same line, where a listener would hear it:
 * "4.0 semitones higher", "22% faster". None when they'd sound alike. Same words, so pitch and pace differ only by
 * performance, never by what's said.
 */
export function voiceDrift(read: VoiceClipMeasure, other: VoiceClipMeasure): string[] {
  const out: string[] = [];
  if (read.pitchHz && other.pitchHz) {
    const semitones = 12 * Math.log2(read.pitchHz / other.pitchHz);
    if (Math.abs(semitones) >= NOTICED_SEMITONES) out.push(`${Math.abs(semitones).toFixed(1)} semitones ${semitones > 0 ? 'higher' : 'lower'}`);
  }
  if (read.syllablesPerSecond && other.syllablesPerSecond) {
    const pace = read.syllablesPerSecond / other.syllablesPerSecond - 1;
    if (Math.abs(pace) >= NOTICED_PACE) out.push(`${Math.round(Math.abs(pace) * 100)}% ${pace > 0 ? 'faster' : 'slower'}`);
  }
  return out;
}
