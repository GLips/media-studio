// review-script-source.ts: a project's script as the read-along shows it: voiceover.json's lines with audio/take.json's
// word times, the takes to switch between, and the hash a script sign-off holds (sha256 of the voice and each line's
// id and text, first 10 hex), computed here so review's models stay free of node:crypto.
//
// Times are on the take (audio/take.wav), the one read `studio voice` cut its lines from, not on any render: a script
// is reviewed before anything is rendered with it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderFileStamp } from '#lib/output/render/engine/render-snapshot.ts';
import type { RenderFileStamp } from '#lib/output/render/models/render-snapshot-model.ts';
import type { Voice } from '#lib/timing/voice/models/voice-manifest.ts';
import type { VoiceTakeFile } from '#lib/timing/voice/models/voice-take.ts';
import { spokenText, type SpokenWord } from '#lib/timing/voice/models/voice-words.ts';
import type { ReviewScriptLine } from '../models/review-script.ts';

/** The take every line is cut from, inside the project. */
const REVIEW_SCRIPT_TAKE_PATH = 'audio/take.wav';

/** A take: its file in the project, stamped as a render is (so its URL pins it), and how it was read. */
export type ReviewScriptTake = RenderFileStamp & { path: string; label: 'paid' | 'draft' | 'recording' };

/** The script: whose voice reads it (null before one is chosen), its lines, the takes recorded, and its hash. */
export type ReviewScript = { voice: string | null; lines: ReviewScriptLine[]; takes: ReviewScriptTake[]; hash: string };

type VoiceoverFile = { voice?: string; lines: { id: string; text: string }[] };

/** The project's voice files, trusted in the shape their one writer gives them: `studio voice`, or the person for voiceover.json. */
type ReviewScriptFiles = { voiceover: VoiceoverFile; take: VoiceTakeFile; manifest: Voice };

function readScriptFile<K extends keyof ReviewScriptFiles>(file: string, _shape: K): ReviewScriptFiles[K] | undefined {
  // SAFETY: each file is read as the shape its writer gives it (ReviewScriptFiles).
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ReviewScriptFiles[K]) : undefined;
}

const TAKE_LABELS = { tts: 'paid', draft: 'draft', recording: 'recording' } as const satisfies Record<VoiceTakeFile['source'], ReviewScriptTake['label']>;

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * Where each voiced line's clip starts in the take. The manifest keeps each clip's length and the quiet before it, so
 * the clips chain from the first; the first's start is where whisper heard the take's first word, less how far into
 * its clip that word falls. An estimated manifest has no clips, and no starts.
 */
function clipStartsInTake(manifest: Voice, takeWords: readonly SpokenWord[] | undefined): Map<string, number> {
  const starts = new Map<string, number>();
  let next: number | null = null;
  for (const [id, line] of Object.entries(manifest)) {
    if (line.src === null) return new Map();
    const from: number = next === null ? Math.max(0, (takeWords?.[0]?.start ?? 0) - (line.words[0]?.start ?? 0)) : next + (line.pauseBefore ?? 0);
    starts.set(id, from);
    next = from + line.duration;
  }
  return starts;
}

/**
 * The project's script, from the folder `projectDir`. A line carries times only when the take was cut from its words
 * as they read now: a line edited since `studio voice` ran shows unvoiced until it runs again.
 */
export function readReviewScript(projectDir: string): ReviewScript {
  const script = readScriptFile(join(projectDir, 'voiceover.json'), 'voiceover');
  if (!script) throw new Error(`${projectDir} has no voiceover.json, so no script to read along`);
  const voice = script.voice ?? null;
  const hash = createHash('sha256').update(JSON.stringify([voice, script.lines.map((l) => [l.id, l.text])])).digest('hex').slice(0, 10);

  const takeFile = join(projectDir, REVIEW_SCRIPT_TAKE_PATH);
  const info = readScriptFile(join(projectDir, 'audio', 'take.json'), 'take');
  const manifest = readScriptFile(join(projectDir, 'audio', 'manifest.json'), 'manifest');
  const take = existsSync(takeFile) && info ? { ...renderFileStamp(takeFile), path: REVIEW_SCRIPT_TAKE_PATH, label: TAKE_LABELS[info.source] } : undefined;
  // take.json keys what whisper heard by each WAV's sha256, of which the stamp's hash is the first 10 hex.
  const takeWords = take && Object.entries(info?.heard ?? {}).find(([key]) => key.startsWith(take.hash))?.[1];
  const starts = take && manifest ? clipStartsInTake(manifest, takeWords) : new Map<string, number>();

  const lines = script.lines.map(({ id, text: written }): ReviewScriptLine => {
    const text = spokenText(written), voiced = manifest?.[id], from = starts.get(id);
    if (!voiced || from === undefined || voiced.text !== text) return { id, text };
    const words = voiced.words.map((w) => ({ text: w.text, start: round(from + w.start), end: round(from + w.end) }));
    return { id, text, start: round(from), end: round(from + voiced.duration), words };
  });
  return { voice, lines, takes: take ? [take] : [], hash };
}
