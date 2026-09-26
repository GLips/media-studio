// whisper-words.ts: what whisper.cpp hears in a voice line, word by word, with times. Node only.
//
// whisper.cpp and its model live outside the repo, in ~/.cache/media-studio, so worktrees share one ~1.5 GB model
// and one build. The first call installs both.
import { downloadWhisperModel, installWhisperCpp, transcribe } from '@remotion/install-whisper-cpp';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpokenWord } from '#models/voice/voice-words.ts';
import { runFfmpeg } from '../ffmpeg/ffmpeg.ts';

const WHISPER_CPP_VERSION = '1.8.6';
// On our TTS lines, medium.en's DTW word times land within about two frames of the pauses ffmpeg's silencedetect
// finds, at under two seconds a line once installed.
const WHISPER_MODEL = 'medium.en';
const WHISPER_DIR = join(homedir(), '.cache', 'media-studio', `whisper.cpp-${WHISPER_CPP_VERSION}`);

let ready: Promise<unknown> | null = null;
const ensureWhisper = () => (ready ??= installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_CPP_VERSION, printOutput: false })
  .then(() => downloadWhisperModel({ model: WHISPER_MODEL, folder: WHISPER_DIR, printOutput: false })));

/** The words whisper hears in a WAV, in seconds. Its spelling is not the script's; see alignSpokenWords. */
export async function heardWords(wavPath: string): Promise<SpokenWord[]> {
  await ensureWhisper();
  // whisper.cpp only reads 16 kHz mono.
  const tmp = mkdtempSync(join(tmpdir(), 'whisper-'));
  const input = join(tmp, 'line.wav');
  runFfmpeg(['-v', 'error', '-y', '-i', wavPath, '-ar', '16000', '-ac', '1', input]);
  const { transcription } = await transcribe({
    inputPath: input, whisperPath: WHISPER_DIR, whisperCppVersion: WHISPER_CPP_VERSION, model: WHISPER_MODEL,
    tokenLevelTimestamps: true, printOutput: false,
  });
  rmSync(tmp, { recursive: true, force: true });

  // Tokens are word pieces: one starting with a space begins a word, the rest (and punctuation) continue it. Bracketed
  // tokens like [_BEG_] are markers, not speech. A token's DTW time is when it's spoken; its offsets are coarser.
  const words: SpokenWord[] = [];
  for (const token of transcription.flatMap((item) => item.tokens)) {
    if (/^\[_/.test(token.text) || !token.text.trim()) continue;
    const start = (token.t_dtw >= 0 ? token.t_dtw * 10 : token.offsets.from) / 1000;
    const end = token.offsets.to / 1000;
    const last = words.at(-1);
    if (last && !/^\s/.test(token.text)) {
      last.text += token.text;
      last.end = Math.max(last.end, end);
    } else {
      if (last) last.end = Math.min(last.end, start);
      words.push({ text: token.text.trim(), start, end: Math.max(start, end) });
    }
  }
  return words;
}
