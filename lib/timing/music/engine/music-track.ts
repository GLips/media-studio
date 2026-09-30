// music-track.ts: adds a music track to a project, supplied or generated with Lyria, measured for the mix and
// beat-tracked, and fits one to a length. `studio music add`, `gen` and `fit` run it.
//
// `add` copies the track to <project>/music/ and writes music/index.ts, which the video imports:
//   import { music } from './music/index.ts';
//   defineVideo({ …, music: { track: music.bed } })
// Each track carries its loudness (the mix levels it against the voice), its tempo, and its beat times in the track,
// for placing accents or cuts on the beat by hand. `fit` cuts a new track from one of them (lib/timing/music/models/music-fit.ts) and adds
// it beside the original, with the spans it was cut from.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { measureAudibleLoudness } from '#lib/platform/ffmpeg/engine/loudness.ts';
import { probeMediaSeconds, runFfmpeg, runFfprobe } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { generatePaidMedia } from '#lib/platform/paid-generation/engine/paid-generation.ts';
import { detectMusicBeats } from '../models/music-beats.ts';
import { planMusicArrangement, planMusicFit, spliceMusicSpans } from '../models/music-fit.ts';
import type { MusicTrack } from '#lib/timing/sound/models/mix.ts';

type Entry = Omit<MusicTrack, 'src'> & { file: string };

// Beats are tracked, and fits planned, on mono at this rate; the fitted file keeps the source's own rate and channels.
const ANALYSIS_RATE = 22050;

/** The Lyria models `studio music gen` uses: a 30 s clip by default, a full-length track for music that has to go somewhere. */
export const LYRIA_CLIP_MODEL = 'google/lyria-3-clip-preview';
export const LYRIA_PRO_MODEL = 'google/lyria-3-pro-preview';

/**
 * Generates a track with Lyria (cached like every paid generation, in generated/) and adds it as `name`, recording
 * the model and prompt. Returns the path of the music/index.ts it rewrote.
 */
export async function generateProjectMusicTrack(project: string, { prompt, name, full }: { prompt: string; name: string; full: boolean }): Promise<string> {
  const model = full ? LYRIA_PRO_MODEL : LYRIA_CLIP_MODEL;
  const [file] = await generatePaidMedia(project, { kind: 'audio', model, name: `music-${name}`, prompt });
  return addProjectMusicTrack(project, file, name, { model, prompt });
}

/** Adds `source` to the project's music as `name`, and returns the path of the music/index.ts it rewrote. */
export function addProjectMusicTrack(project: string, source: string, name: string, generated?: MusicTrack['generated']): string {
  if (!existsSync(source)) throw new Error(`no track at ${source}`);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`--name must be lowercase words joined by dashes, not ${name}`);

  const dir = join(project, 'music');
  mkdirSync(dir, { recursive: true });
  const file = `${name}${extname(source).toLowerCase()}`;
  const path = join(dir, file);
  copyFileSync(source, path);

  const duration = probeMediaSeconds(path);
  const { lufs } = measureAudibleLoudness(path);
  const { bpm, beats } = detectMusicBeats(decodeAudio(path, 1, ANALYSIS_RATE)[0], ANALYSIS_RATE);
  // A fit cut from the audio this replaces would keep playing it: drop it, so a video still using it fails to typecheck.
  const manifest = readMusicManifest(dir);
  const staleFits = Object.keys(manifest).filter((n) => manifest[n].fit?.source === name);
  for (const n of staleFits) delete manifest[n];
  if (staleFits.length) console.error(`dropped ${staleFits.map((n) => `music.${n}`).join(', ')}, fit from the old music.${name}; fit again`);
  const index = writeMusicManifest(dir, { ...manifest, [name]: { file, duration: Math.round(duration * 1000) / 1000, lufs, bpm, beats, ...(generated && { generated }) } });
  console.error(`${name}: ${basename(source)}, ${duration.toFixed(1)}s, ${lufs} LUFS, ${bpm} BPM, first beats ${beats.slice(0, 4).join(', ')}s`);
  return index;
}

export type MusicFitResult = { file: string; index: string; track: Entry & { fit: NonNullable<MusicTrack['fit']> }; seamDb: number[]; worstSeamDb: number };

/**
 * How a fit gets its length: cut to exactly `seconds`, the seams wherever the bars sound most alike; or played as the
 * source's `bars` in that order (bar 1 on its first downbeat), then `tailSeconds` of silence, for a picture that needs
 * the time in particular places.
 */
export type MusicFitShape = { seconds: number } | { bars: readonly number[]; tailSeconds?: number };

/**
 * Cuts `music.<name>` to a new length, ending on its own ending, and adds it as `music.<as>`, keeping the original.
 * Deterministic: the same track and shape always give the same spans.
 */
export function fitProjectMusicTrack(project: string, { name, as, shape }: { name: string; as: string; shape: MusicFitShape }): MusicFitResult {
  if (!/^[a-z][a-z0-9-]*$/.test(as)) throw new Error(`--as must be lowercase words joined by dashes, not ${as}`);
  if (as === name) throw new Error(`--as must differ from --name, so the original stays to refit from`);
  const dir = join(project, 'music');
  const manifest = readMusicManifest(dir), source = manifest[name];
  if (manifest[as] && !manifest[as].fit) throw new Error(`music.${as} is a track of its own, not a fit; choose another --as`);
  if (!source) throw new Error(`no music.${name} in ${dir}; add it with \`studio music add\``);
  if (source.fit) throw new Error(`music.${name} is itself a fit of music.${source.fit.source}; fit from that`);

  const sourcePath = join(dir, source.file);
  const analysis = { samples: decodeAudio(sourcePath, 1, ANALYSIS_RATE)[0], rate: ANALYSIS_RATE, beats: source.beats };
  const plan = 'bars' in shape
    ? planMusicArrangement({ ...analysis, bars: shape.bars, tailSeconds: shape.tailSeconds })
    : { ...planMusicFit({ ...analysis, targetSeconds: shape.seconds }), seconds: shape.seconds };
  const { seconds } = plan;
  const [stream] = JSON.parse(runFfprobe(['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels,sample_rate', '-of', 'json', sourcePath]).toString()).streams;
  const channels = Number(stream.channels), rate = Number(stream.sample_rate);
  const spliced = spliceMusicSpans(decodeAudio(sourcePath, channels, rate), rate, plan.spans, seconds);

  const file = `${as}.wav`, path = join(dir, file);
  const interleaved = new Float32Array(spliced[0].length * channels);
  for (let i = 0; i < spliced[0].length; i++) for (let c = 0; c < channels; c++) interleaved[i * channels + c] = spliced[c][i];
  runFfmpeg(['-v', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', String(channels), '-i', '-', '-c:a', 'pcm_s16le', path], {
    input: Buffer.from(interleaved.buffer),
  });
  const track = {
    file, duration: Math.round(seconds * 1000) / 1000, lufs: measureAudibleLoudness(path).lufs, bpm: source.bpm, beats: plan.beats,
    fit: { source: name, spans: plan.spans, seams: plan.seams, downbeats: plan.downbeats },
  };
  return { file: path, index: writeMusicManifest(dir, { ...readMusicManifest(dir), [as]: track }), track, seamDb: plan.seamDb, worstSeamDb: plan.worstSeamDb };
}

function readMusicManifest(dir: string): Record<string, Entry> {
  const path = join(dir, 'manifest.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

function writeMusicManifest(dir: string, manifest: Record<string, Entry>): string {
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const index = join(dir, 'index.ts');
  writeFileSync(index, musicModule(manifest));
  return index;
}

/** Each channel's samples, resampled to `rate`. */
function decodeAudio(path: string, channels: number, rate: number): Float32Array[] {
  const pcm = runFfmpeg(['-v', 'error', '-i', path, '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const all = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
  return Array.from({ length: channels }, (_, c) => Float32Array.from({ length: all.length / channels }, (_, i) => all[i * channels + c]));
}

function musicModule(tracks: Record<string, Entry>) {
  const names = Object.keys(tracks);
  const imports = names.map((n, i) => `import track${i} from './${tracks[n].file}';`).join('\n');
  const entries = names.map((n, i) => {
    const { file: _, ...rest } = tracks[n];
    return `  ${JSON.stringify(n)}: { src: track${i}, ${JSON.stringify(rest).slice(1)},`;
  }).join('\n');
  return `// Written by \`studio music\`. Edits here are lost on the next run.
import type { MusicTrack } from '#lib/timing/sound/models/mix.ts';
${imports}

export const music = {
${entries}
} as const satisfies Record<string, MusicTrack>;
`;
}

/**
 * Each moment (a cut, an `expect`) against the fitted track's nearest downbeat, in video time: a minus means it comes
 * before the downbeat. Only a report; nothing is moved.
 */
export function formatMusicFitReport(track: MusicFitResult['track'], moments: readonly { label: string; at: number }[]): string[] {
  const beat = 60 / track.bpm;
  const rows = moments.map(({ label, at }) => {
    const downbeat = track.fit.downbeats.reduce((best, d) => (Math.abs(d - at) < Math.abs(best - at) ? d : best), Infinity);
    const off = at - downbeat, signed = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
    return [label, `${at.toFixed(2)} s`, `${downbeat.toFixed(2)} s`, `${signed(off)} s (${signed(off / beat)} beats)`];
  });
  const table = [['moment', 'at', 'downbeat', 'off'], ...rows];
  const widths = table[0].map((_, c) => Math.max(...table.map((r) => r[c].length)));
  return table.map((r) => '  ' + r.map((cell, c) => cell.padEnd(widths[c])).join('   ').trimEnd());
}
