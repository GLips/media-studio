// transcribe-footage.ts: what whisper.cpp hears in any audio or video file, word by word, with times, cached. Node only.
//
// Whisper over a whole long file drifts by seconds across pauses and folds a repeated phrase into one, so the audio is
// split at its pauses into pieces whisper hears one at a time (planTranscriptPieces), in one run that loads the model
// once. Whisper says which words it heard and roughly where; the audio's pauses place their edges (wordsTimedAtPauses).
// whisper.cpp and its model live outside the repo, in the studio's user cache (~/.cache/media-studio), so worktrees
// share one ~1.5 GB model and one build. The first call installs both.
import { downloadWhisperModel, installWhisperCpp } from '@remotion/install-whisper-cpp';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { FootageTranscript } from '../models/footage-transcript.ts';
import { audioFrameLevels, audioPauses, fileTimeInPiece, planTranscriptPieces, quietAudioLevel, wordsTimedAtPauses, type HeardWord, type TranscriptPiece } from '../models/transcript-audio.ts';
import { runFfmpeg } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { replaceFileWhole } from '#lib/platform/files/engine/replace-file-whole.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';
import { samplesFromWav, wavFromSamples } from '#lib/platform/wav/models/wav.ts';

const WHISPER_CPP_VERSION = '1.8.6';
// On a 21-minute raw mic recording, medium.en's words, edged by the pauses, start and end within 0.1 s of the pauses
// around them at 85% of pauses (median 0); it hears the file in about a twelfth of its length on an M-series GPU.
const WHISPER_MODEL = 'medium.en';
const WHISPER_DIR = studioUserCacheDir(`whisper.cpp-${WHISPER_CPP_VERSION}`);
// Names everything a cached transcript depends on besides the file: bump the last part when how it's made changes.
const TRANSCRIBER = `whisper.cpp-${WHISPER_CPP_VERSION}/${WHISPER_MODEL}/pieces-1`;
const TRANSCRIPT_CACHE = studioUserCacheDir('transcripts');
// whisper.cpp only reads 16 kHz mono.
const WHISPER_RATE = 16000;

let ready: Promise<unknown> | null = null;
const ensureWhisper = () => (ready ??= installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_CPP_VERSION, printOutput: false })
  .then(() => downloadWhisperModel({ model: WHISPER_MODEL, folder: WHISPER_DIR, printOutput: false })));

/**
 * What's said in `path` (any file ffmpeg reads with an audio track) and when. Asking again for the same file answers
 * from the user cache, keyed by the file's size, modified time and sampled bytes, so a multi-GB file costs a few reads. Whisper's
 * spelling is not a script's; see alignSpokenWords.
 */
export async function transcribeFootage(path: string): Promise<FootageTranscript> {
  const cached = join(TRANSCRIPT_CACHE, `${transcriptCacheKey(path)}.json`);
  // SAFETY: only this function writes the cache, and a change to what it writes changes TRANSCRIBER, so the key.
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8')) as FootageTranscript;
  await ensureWhisper();
  const transcript = await withStudioTemp('transcribe', async (tmp) => {
    const audio = join(tmp, 'audio.wav');
    runFfmpeg(['-v', 'error', '-y', '-i', path, '-vn', '-ar', String(WHISPER_RATE), '-ac', '1', '-c:a', 'pcm_s16le', audio]);
    const { samples, rate } = samplesFromWav(readFileSync(audio));
    const levels = audioFrameLevels(samples, rate), quiet = quietAudioLevel(levels);
    const pieces = planTranscriptPieces(levels, quiet);
    const files = pieces.map((piece, i) => {
      const file = join(tmp, `piece-${i}.wav`);
      const heard = piece.kept.map((span) => samples.subarray(Math.round(span.start * rate), Math.round(span.end * rate)));
      const joined = new Int16Array(heard.reduce((sum, span) => sum + span.length, 0));
      heard.reduce((at, span) => (joined.set(span, at), at + span.length), 0);
      writeFileSync(file, wavFromSamples(joined, rate));
      return file;
    });
    const heard = await whisperHears(files);
    const pauses = audioPauses(levels, quiet), duration = samples.length / rate;
    const words = wordsTimedAtPauses(pieces.flatMap((piece, i) => heardInFile(heard[i], piece)), pauses, duration);
    return { duration, words, pauses };
  });
  replaceFileWhole(cached, JSON.stringify(transcript));
  return transcript;
}

// Bytes read from the start, middle and end of a file for its cache key, beside its size and modified time. The time
// catches an edit that keeps the size and misses the samples (a word patched mid-WAV); a copy is transcribed afresh.
const KEY_SAMPLE = 2 ** 20;

/** A key for `path`'s transcript from its size, modified time and three sampled megabytes, not a hash of all of it. */
function transcriptCacheKey(path: string): string {
  const fd = openSync(path, 'r');
  try {
    const { size, mtimeMs } = fstatSync(fd), hash = createHash('sha256').update(`${TRANSCRIBER}\n${size}\n${mtimeMs}\n`);
    const block = Buffer.alloc(KEY_SAMPLE);
    for (const at of new Set([0, Math.max(0, Math.floor(size / 2) - KEY_SAMPLE / 2), Math.max(0, size - KEY_SAMPLE)])) {
      hash.update(block.subarray(0, readSync(fd, block, 0, KEY_SAMPLE, at)));
    }
    return hash.digest('hex').slice(0, 32);
  } finally {
    closeSync(fd);
  }
}

/** One whisper token as whisper.cpp's full JSON gives it. */
type WhisperToken = { text: string; t_dtw: number };
type WhisperJson = { transcription: { tokens: WhisperToken[] }[] };

const execFileAsync = promisify(execFile);

/** Whisper's tokens for each of `files`, in order, from one run that loads the model once. */
async function whisperHears(files: readonly string[]): Promise<WhisperToken[][]> {
  if (!files.length) return [];
  await execFileAsync(join(WHISPER_DIR, 'build', 'bin', 'whisper-cli'), [
    // whisper.cpp skips DTW, and so every token's t_dtw, when flash attention is on, as it is by default.
    '-m', join(WHISPER_DIR, `ggml-${WHISPER_MODEL}.bin`), '--dtw', WHISPER_MODEL, '-nfa',
    // A segment per token, each JSON beside its WAV; -mc 0 keeps one piece's words from steering the next's.
    '-ml', '1', '-oj', '-ojf', '-mc', '0', '-np', ...files,
  ], { maxBuffer: 64 * 2 ** 20 });
  // SAFETY: -ojf writes this shape for the pinned WHISPER_CPP_VERSION.
  return files.map((file) => (JSON.parse(readFileSync(`${file}.json`, 'utf8')) as WhisperJson).transcription.flatMap((item) => item.tokens));
}

/**
 * A piece's tokens as words placed in the whole file, each at the middle of its tokens' DTW times. Tokens are word
 * pieces: one starting with a space begins a word, the rest continue it. Bracketed tokens like [_BEG_] are markers,
 * not speech.
 */
function heardInFile(tokens: readonly WhisperToken[], piece: TranscriptPiece): HeardWord[] {
  const words: { text: string; times: number[] }[] = [];
  for (const token of tokens) {
    if (token.text.startsWith('[_') || !token.text.trim()) continue;
    // Punctuation joins the word before it, and whisper times it where it writes it, often in the quiet after.
    const spoken = /[\p{L}\p{N}]/u.test(token.text), word = words.at(-1);
    if (word && (!spoken || !/^\s/.test(token.text))) word.text += token.text;
    else words.push({ text: token.text.trim(), times: [] });
    // t_dtw is in 10 ms units, and −1 where DTW found no time.
    if (spoken && token.t_dtw >= 0) words.at(-1)!.times.push(token.t_dtw / 100);
  }
  let at = 0;
  // Whisper writes what it hears that isn't speech as a tag: [BLANK_AUDIO], (music), [laughs].
  return words.flatMap(({ text, times }) => {
    if (times.length) at = (times[0] + times.at(-1)!) / 2;
    return /^[[(].*[\])]$/.test(text) ? [] : [{ text, at: fileTimeInPiece(piece, at) }];
  });
}
