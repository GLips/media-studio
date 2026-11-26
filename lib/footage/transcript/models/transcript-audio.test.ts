import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioPauses, fileTimeInPiece, planTranscriptPieces, quietAudioLevel, unheardSpeech, wordsTimedAtPauses, type TranscriptPiece } from './transcript-audio.ts';

/** Level frames (10 ms each) for runs of speech (`true`) and quiet, each `seconds` long. */
const heardLength = (piece: TranscriptPiece) => piece.kept.reduce((sum, s) => sum + s.end - s.start, 0);
const levelsOf = (...runs: [boolean, number][]) => runs.flatMap(([loud, seconds]) => Array.from({ length: Math.round(seconds * 100) }, () => (loud ? 400 : 8)));

test('whisper hears every stretch of speech once, a retake after a pause on its own, and no piece past its window', () => {
  // A line, a long pause, the line again, 40 s of speech with only a short pause, then the recording left running. With
  // no long pause in reach, a piece ends at the longest it can reach.
  const levels = levelsOf([false, 2], [true, 3], [false, 1.5], [true, 3], [false, 0.2], [true, 40], [false, 20]);
  const pieces = planTranscriptPieces(levels, quietAudioLevel(levels));
  assert.ok(pieces.every((p) => heardLength(p) <= 25), 'a piece fits in whisper’s 30 s window');
  assert.deepEqual(pieces.slice(0, 2).map((p) => [p.kept[0].start, p.kept.at(-1)!.end].map((x) => Math.round(x * 100) / 100)), [[1.85, 5.6], [6.35, 9.6]]);
  // Every loud frame is heard in exactly one piece; the quiet at the start and end is mostly left out.
  const speechFrames = levels.flatMap((level, f) => (level > 100 ? [f] : []));
  const heardFrames = pieces.flatMap((p) => p.kept.flatMap((s) => Array.from({ length: Math.round((s.end - s.start) * 100) }, (_, k) => Math.round(s.start * 100) + k)));
  assert.deepEqual(speechFrames.filter((f) => heardFrames.filter((h) => h === f).length !== 1), []);
  assert.ok(pieces.reduce((sum, p) => sum + heardLength(p), 0) < 52, 'the long quiet is cut short');
  // A moment whisper hears just after a shortened pause lands after the whole pause in the file.
  const first = planTranscriptPieces(levelsOf([true, 2], [false, 0.45], [true, 1]), 100)[0];
  assert.equal(Math.round(fileTimeInPiece(first, 2.31) * 100) / 100, 2.46);
});

test('silent audio holds nothing for whisper to hear', () => {
  const silent = levelsOf([false, 60]).map(() => 0);
  assert.deepEqual(planTranscriptPieces(silent, quietAudioLevel(silent)), []);
  const gated = [...levelsOf([false, 58]).map(() => 0), ...levelsOf([true, 1.8])];
  assert.equal(planTranscriptPieces(gated, quietAudioLevel(gated)).length, 1);
});

test('a word ends where the quiet after it begins, and words with no quiet between them meet nearer the first', () => {
  const levels = levelsOf([false, 1], [true, 1], [false, 0.6], [true, 0.8], [false, 1]);
  const pauses = audioPauses(levels, quietAudioLevel(levels));
  // Whisper's DTW times sit late in each word, one of them in the quiet after its word.
  const words = wordsTimedAtPauses([{ text: 'one', at: 1.3 }, { text: 'two', at: 1.7 }, { text: 'three', at: 2.1 }, { text: 'four', at: 2.9 }], pauses, 4.4, []);
  assert.deepEqual(words, [
    { text: 'one', start: 1, end: 1.42 },
    { text: 'two', start: 1.42, end: 1.82 },
    { text: 'three', start: 1.82, end: 2 },
    { text: 'four', start: 2.6, end: 3.4 },
  ]);
});

test('speech whisper wrote no word in is unheard, and the word before it stops short of it', () => {
  // "app", a 60 ms stop, its "-lication", 80 ms of quiet, a "So" whisper left out, a long pause, then "Share". DTW times
  // fall late in a word, so "app"'s lies in its second run. A breath (quiet sound) after the pause isn't speech; the word
  // before the So ends in the quiet before it.
  const levels = [
    ...levelsOf([false, 1], [true, 0.2], [false, 0.06], [true, 0.15], [false, 0.08], [true, 0.4], [false, 1]),
    ...levelsOf([true, 0.3]).map(() => 60), ...levelsOf([false, 0.2], [true, 0.5], [false, 0.5]),
  ];
  const quiet = quietAudioLevel(levels), pauses = audioPauses(levels, quiet);
  const heard = [{ text: 'application,', at: 1.35 }, { text: 'Share', at: 3.6 }];
  const unheard = unheardSpeech(levels, quiet, heard);
  assert.deepEqual(unheard, [{ start: 1.49, end: 1.89 }]);
  assert.deepEqual(wordsTimedAtPauses(heard, pauses, levels.length / 100, unheard).map((w) => [w.text, w.end]), [['application,', 1.452], ['Share', 3.89]]);
});
