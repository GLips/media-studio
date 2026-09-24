// music-track.ts: adds a music track to a project, measured for the mix and beat-tracked. `studio music` runs it.
//
// Copies the track to projects/<p>/music/ and writes music/index.ts, which the video imports:
//   import { music } from './music/index.ts';
//   defineVideo({ …, music: { track: music.bed } })
// Each track carries its loudness (the mix levels it against the voice), its tempo, and its beat times in the track,
// for placing accents or cuts on the beat by hand.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { measureLoudness } from './loudness.ts';
import { detectMusicBeats } from './music-beats.ts';
import type { MusicTrack } from './studio/mix.ts';

type Entry = Omit<MusicTrack, 'src'> & { file: string };

/** Adds `source` to the project's music as `name`, and returns the path of the music/index.ts it rewrote. */
export function addProjectMusicTrack(project: string, source: string, name: string): string {
  if (!existsSync(source)) throw new Error(`no track at ${source}`);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`--name must be lowercase words joined by dashes, not ${name}`);

  const dir = join(project, 'music');
  mkdirSync(dir, { recursive: true });
  const file = `${name}${extname(source).toLowerCase()}`;
  const path = join(dir, file);
  copyFileSync(source, path);

  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).toString());
  const { lufs } = measureLoudness(path);
  const rate = 22050;
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  const { bpm, beats } = detectMusicBeats(new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4), rate);

  const manifestPath = join(dir, 'manifest.json');
  const manifest: Record<string, Entry> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  manifest[name] = { file, duration: Math.round(duration * 1000) / 1000, lufs, bpm, beats };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const index = join(dir, 'index.ts');
  writeFileSync(index, musicModule(manifest));
  console.error(`${name}: ${basename(source)}, ${duration.toFixed(1)}s, ${lufs} LUFS, ${bpm} BPM, first beats ${beats.slice(0, 4).join(', ')}s`);
  return index;
}

function musicModule(tracks: Record<string, Entry>) {
  const names = Object.keys(tracks);
  const imports = names.map((n, i) => `import track${i} from './${tracks[n].file}';`).join('\n');
  const entries = names.map((n, i) => {
    const { file: _, ...rest } = tracks[n];
    return `  ${JSON.stringify(n)}: { src: track${i}, ${JSON.stringify(rest).slice(1)},`;
  }).join('\n');
  return `// Written by \`studio music\`. Edits here are lost on the next run.
import type { MusicTrack } from '../../../lib/studio/mix.ts';
${imports}

export const music = {
${entries}
} as const satisfies Record<string, MusicTrack>;
`;
}
