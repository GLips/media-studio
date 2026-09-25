// ab-hits.ts: the showcase's hits, old against new, as the delivered video plays them. The whole soundtrack renders
// twice, with the hits saved in out/ab/before/ and with the hits as placed now, each through `studio render`'s own
// master (renderMasteredMix). out/ab/hits-ab.wav plays, in the cut's order, 1.2 s around each hit from the old mix
// (the last hit's to the end, to hear what it holds), a short gap, the same from the new one, and a longer gap. A table
// (also out/ab/hits-ab.txt) says what each measures. A hit is a sound from the impact or buzz recipe; a saved one
// stands in for the placed sound with its id (its bar and its role there), wherever the cut has moved it.
//   node projects/2026-09-motion-showcase/tools/ab-hits.ts --save     snapshot the placed hits into out/ab/before/
//   node projects/2026-09-motion-showcase/tools/ab-hits.ts [--after=<dir>]
// --after tries sounds before placing them: each hit's sound from <dir>/<its name>.ts where `studio sfx render --out
// <dir>/<its name>.wav` wrote one, and its volume from <dir>/volumes.json ({ "<id>": volume }) if that names it.
import '../../../lib/studio/tsx-test-hooks.ts';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderMasteredMix } from '#engine/render/render-pipeline.ts';
import { openRenderSession } from '#engine/render/render-session.ts';
import { sfxSeedFromId } from '../../../lib/sfx/dsp.ts';
import { FPS } from '../../../lib/studio/frame.ts';
import type { SfxSound } from '../../../lib/studio/sfx.tsx';
import { layoutVideo, totalFrames, type VideoDef } from '../../../lib/studio/timeline.ts';
import { timeline } from '../timeline.ts';
import { measureWithFfmpeg, runFfmpeg } from '#engine/ffmpeg/ffmpeg.ts';

const PROJECT = resolve(import.meta.dirname, '..');
const STUDIO = resolve(PROJECT, '../..');
const AB = join(PROJECT, 'out/ab'), BEFORE = join(AB, 'before');
const RATE = 48000;
const HIT_RECIPES = new Set(['impact', 'buzz']);
/** Around each hit in hits-ab.wav: from before it, to after it, and the silences between A and B, and between hits. */
const EXCERPT = { before: 0.4, after: 0.8, gap: 0.35, between: 1 };

/** One of the video's sounds, with the take `<Sfx>` picks for its id, and that take's file. */
type Placed = { id: string; at: number; volume: number; file: string; take: Omit<SfxSound, 'src'> };
type SavedHit = { id: string; file: string; volume: number } & Omit<SfxSound, 'src'>;

const args = process.argv.slice(2);
const video: VideoDef = (await import('../video.tsx')).default;
const frames = totalFrames(layoutVideo(video), FPS);
const placed: Placed[] = (video.sounds ?? []).map((s, i) => {
  const takes: readonly SfxSound[] = Array.isArray(s.sound) ? s.sound : [s.sound as SfxSound];
  const { src, ...take } = takes[sfxSeedFromId(s.id ?? i) % takes.length];
  return { id: String(s.id ?? i), at: s.at, volume: s.volume ?? 1, file: fileURLToPath(src), take };
});
const isHit = (p: Placed) => HIT_RECIPES.has(p.take.request.sound.split('.')[0]);

if (args.includes('--save')) {
  mkdirSync(BEFORE, { recursive: true });
  const hits: SavedHit[] = placed.filter(isHit).map((p) => {
    for (const file of [p.file, p.file.replace(/\.wav$/, '.ts')]) copyFileSync(file, join(BEFORE, basename(file)));
    return { id: p.id, file: basename(p.file), volume: p.volume, ...p.take };
  });
  writeFileSync(join(BEFORE, 'placed.json'), `${JSON.stringify({ hits }, null, 2)}\n`);
  console.log(`${BEFORE}: ${hits.map((h) => `${h.id} (${h.file} at ${h.volume})`).join(', ')}`);
  process.exit(0);
}

// ---------- the two soundtracks ----------

const saved: SavedHit[] = JSON.parse(readFileSync(join(BEFORE, 'placed.json'), 'utf8')).hits;
const afterDir = args.find((a) => a.startsWith('--after='))?.slice('--after='.length);
const afterVolumes: Record<string, number> = afterDir && existsSync(join(afterDir, 'volumes.json')) ? JSON.parse(readFileSync(join(afterDir, 'volumes.json'), 'utf8')) : {};

const savedFor = (p: Placed) => saved.find((h) => h.id === p.id);
const before = placed.map((p): Placed => {
  const s = savedFor(p);
  if (!s) return p;
  const { id: _, file, volume, ...take } = s;
  return { id: p.id, at: p.at, volume, file: join(BEFORE, file), take };
});
const after = await Promise.all(placed.map(async (p): Promise<Placed> => {
  if (!afterDir || !savedFor(p)) return p;
  const module = join(resolve(afterDir), basename(p.file).replace(/\.wav$/, '.ts'));
  if (!existsSync(module)) return { ...p, volume: afterVolumes[p.id] ?? p.volume };
  const { default: sound }: { default: SfxSound } = await import(pathToFileURL(module).href);
  const { src, ...take } = sound;
  return { ...p, file: fileURLToPath(src), take, volume: afterVolumes[p.id] ?? p.volume };
}));
const hits = placed.flatMap((p, i) => (savedFor(p) ? [{ id: p.id, at: p.at, a: before[i], b: after[i] }] : [])).sort((x, y) => x.at - y.at);
for (const h of saved) if (!placed.some((p) => p.id === h.id)) console.error(`${h.id} (${h.file}) is no longer placed: skipped`);
for (const p of placed.filter(isHit)) if (!savedFor(p)) console.error(`${p.id} is placed but wasn't saved: rerun --save to compare it`);

/**
 * A project that is the showcase's soundtrack alone: one empty scene the reel's length, its music bed, and `sounds`.
 * Its bundle leaves the bars out, so it renders in seconds, and another builder's half-made bar can't break it.
 */
function writeSoundtrackProject(name: string, sounds: readonly Placed[]): string {
  const dir = join(AB, name), bed = video.music!;
  const { track: { src: music, ...track }, ...bedOptions } = bed;
  const files = [...new Set(sounds.map((s) => s.file))];
  const from = (file: string) => { const r = relative(dir, file); return r.startsWith('.') ? r : `./${r}`; };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'video.tsx'), [
    `// Written by tools/ab-hits.ts on each run: the showcase's soundtrack alone, ${name}. Edits here are lost.`,
    `import { defineScene, defineVideo } from '${from(join(STUDIO, 'lib/studio/api.ts'))}';`,
    `import music from '${from(fileURLToPath(music))}';`,
    ...files.map((f, i) => `import s${i} from '${from(f)}';`),
    '',
    'export default defineVideo({',
    `  title: 'ab-hits ${name}', voice: {},`,
    // Half a frame short, so the layout's ceil lands on the reel's frame count, where the music bed's gain depends on it.
    `  scenes: [defineScene({ id: 'soundtrack', min: ${(frames - 0.5) / FPS}, lead: 0, tail: 0, render: () => null })],`,
    `  music: { ...${JSON.stringify(bedOptions)}, track: { ...${JSON.stringify(track)}, src: music } },`,
    '  sounds: [',
    ...sounds.map((s) => `    { at: ${s.at}, id: ${JSON.stringify(s.id)}, volume: ${s.volume}, sound: { src: s${files.indexOf(s.file)}, ${JSON.stringify(s.take).slice(1, -1)} } },`),
    '  ],',
    '});',
    '',
  ].join('\n'));
  return dir;
}

/** The project's soundtrack as Remotion mixes it (raw.wav), and, if asked, as the real master delivers it. */
async function renderSoundtrack(dir: string, master: boolean): Promise<{ raw: string; mastered?: string }> {
  const session = await openRenderSession(dir);
  const inputProps = session.props();
  const composition = await session.compositionFor(inputProps);
  if (composition.durationInFrames !== frames) throw new Error(`${dir} lays out ${composition.durationInFrames} frames, not the reel's ${frames}`);
  const raw = join(dir, 'out/raw.wav');
  mkdirSync(join(dir, 'out'), { recursive: true });
  await session.renderAudio({ inputProps, out: raw });
  return { raw, mastered: master ? await renderMasteredMix(session) : undefined };
}

const music = await renderSoundtrack(writeSoundtrackProject('music-only', []), false);
const mixA = await renderSoundtrack(writeSoundtrackProject('mix-before', before), true);
const mixB = await renderSoundtrack(writeSoundtrackProject('mix-after', after), true);

// ---------- measuring ----------

function decode(file: string, channels: 1 | 2): Float32Array {
  const pcm = runFfmpeg(['-v', 'error', '-i', file, '-ac', String(channels), '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
}

/** RBJ's second-order low- or highpass, run over `x` into a copy. */
function biquad(x: Float32Array, kind: 'lp' | 'hp', hz: number): Float32Array {
  const w = (2 * Math.PI * hz) / RATE, cos = Math.cos(w), alpha = Math.sin(w) / Math.SQRT2;
  const b = kind === 'lp' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  const a0 = 1 + alpha, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0, [b0, b1, b2] = b.map((v) => v / a0);
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, x[i], y1, v];
    y[i] = v;
  }
  return y;
}
/** `x` between `lo` and `hi` Hz, 24 dB an octave each side. */
const band = (x: Float32Array, lo: number, hi: number) => biquad(biquad(biquad(biquad(x, 'hp', lo), 'hp', lo), 'lp', hi), 'lp', hi);

/** Mean square of `x` over [from, to) seconds. */
function power(x: Float32Array, from: number, to: number): number {
  const i0 = Math.max(0, Math.round(from * RATE)), i1 = Math.min(x.length, Math.round(to * RATE));
  let sum = 0;
  for (let i = i0; i < i1; i++) sum += x[i] * x[i];
  return sum / Math.max(1, i1 - i0);
}
const db = (ratio: number) => 10 * Math.log10(ratio + 1e-20);

/** The lag in samples, within ±10 ms, at which `y` best lines up with `x`, over their first 4 s. */
function lagOf(x: Float32Array, y: Float32Array): number {
  let best = 0, bestSum = -Infinity;
  for (let lag = -480; lag <= 480; lag++) {
    let sum = 0;
    for (let i = 480; i < 4 * RATE; i++) sum += x[i] * y[i + lag];
    if (sum > bestSum) [best, bestSum] = [lag, sum];
  }
  return best;
}

/**
 * The master's gain over the raw mix: their power ratio (median) over 10 ms windows where the limiter has been idle
 * for 300 ms. It only ever pulls down, and the master only reaches its ceiling where it does, so a stretch peaking
 * well under the ceiling, for longer than the limiter's release, is the gain alone.
 */
function masterGain(raw: Float32Array, master: Float32Array): number {
  const win = RATE / 100, windows = Math.floor(master.length / win);
  const peaks = Array.from({ length: windows }, (_, k) => { let m = 0; for (let i = k * win; i < (k + 1) * win; i++) m = Math.max(m, Math.abs(master[i])); return m; });
  const ceiling = Math.max(...peaks), ratios: number[] = [];
  for (let k = 30; k < windows; k++) {
    if (Math.max(...peaks.slice(k - 30, k + 1)) > 0.85 * ceiling) continue;
    const r = power(raw, k / 100, (k + 1) / 100);
    if (r > 1e-8) ratios.push(power(master, k / 100, (k + 1) / 100) / r);
  }
  if (ratios.length < 20) throw new Error(`only ${ratios.length} windows where the limiter is idle: can't read the master's gain`);
  return Math.sqrt(ratios.sort((p, q) => p - q)[ratios.length >> 1]);
}

type Mix = { raw: Float32Array; master: Float32Array; gain: number; low: Float32Array; aac: string };
function measureMix({ raw, mastered }: { raw: string; mastered?: string }, name: string): Mix {
  const rawSamples = decode(raw, 1), masterSamples = decode(mastered!, 1);
  const lag = lagOf(rawSamples, masterSamples);
  if (lag !== 0) throw new Error(`${name}'s master is ${lag} samples off its raw mix: the gain reduction would be misread`);
  // Encoded as the delivered video's soundtrack is (render-pipeline's DELIVERY_AUDIO_CODEC).
  const aac = mastered!.replace(/\.wav$/, '.m4a');
  runFfmpeg(['-y', '-v', 'error', '-i', mastered!, '-c:a', 'aac', '-b:a', '192k', aac]);
  return { raw: rawSamples, master: masterSamples, gain: masterGain(rawSamples, masterSamples), low: band(masterSamples, 40, 150), aac };
}
const musicRaw = decode(music.raw, 1), musicLow = band(musicRaw, 40, 150);
const A = measureMix(mixA, 'mix-before'), B = measureMix(mixB, 'mix-after');

/** tools/attacks.py's prominence of `frames` in `wav`, by frame. */
function attacks(wav: string, hitFrames: number[]): Map<number, number> {
  const out = execFileSync('python3', [join(PROJECT, 'tools/attacks.py'), wav, ...hitFrames.map(String)], { encoding: 'utf8' });
  return new Map(out.trim().split('\n').slice(1).map((line) => { const [f, , , prominence] = line.trim().split(/\s+/).map(Number); return [f, prominence]; }));
}

/** ebur128's true peak of `file` over [from, to) seconds (the whole file if not given), in dBTP. */
function truePeak(file: string, from?: number, to?: number): number {
  const trim = from === undefined ? '' : `atrim=start=${from}:end=${to},`;
  const { stderr } = measureWithFfmpeg(['-nostats', '-hide_banner', '-i', file, '-af', `${trim}ebur128=peak=true`, '-f', 'null', '-']);
  return Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(stderr.slice(stderr.lastIndexOf('Summary:')))?.[1]);
}

/** Where `file` peaks between samples (4× oversampled, as a true-peak meter reads it): its frame at 30 fps. */
function truePeakFrame(file: string): number {
  const pcm = runFfmpeg(['-v', 'error', '-i', file, '-af', 'aresample=192000', '-ac', '2', '-f', 'f32le', '-'], { maxBuffer: 2 ** 31 });
  const x = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  let at = 0;
  for (let i = 1; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[at])) at = i;
  return Math.floor((at / 2 / 192000) * FPS);
}

/** Its spectrum's flatness over [lo, hi] Hz (1 for noise, near 0 for a few tones), from one Hann-windowed FFT. */
function flatness(x: Float32Array, lo: number, hi: number): number {
  const n = 8192, re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < Math.min(n, x.length); i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.min(n, x.length)));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const w = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(w * k), s = Math.sin(w * k), a = i + k, b = a + len / 2;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        [re[b], im[b]] = [re[a] - tr, im[a] - ti];
        re[a] += tr; im[a] += ti;
      }
    }
  }
  const bins: number[] = [];
  for (let k = Math.ceil((lo * n) / RATE); k <= Math.floor((hi * n) / RATE); k++) bins.push(re[k] * re[k] + im[k] * im[k] + 1e-24);
  return Math.exp(bins.reduce((s, p) => s + Math.log(p), 0) / bins.length) / (bins.reduce((s, p) => s + p, 0) / bins.length);
}

/**
 * The sound alone, from its landing: ms until it has fallen 30 dB under its peak for good (5 ms RMS), its energy at
 * 150–1200 Hz after 40 ms against its whole energy (a body that rings keeps it there), that band's flatness over
 * 40–200 ms, and the peak its volume takes it to, which Remotion clips at full scale.
 */
function soundAlone(p: Placed) {
  const x = decode(p.file, 1), land = p.take.landsAt, win = RATE * 0.005;
  const env: number[] = [];
  for (let i = Math.round(land * RATE); i + win <= x.length; i += RATE / 1000) env.push(db(power(x, i / RATE, (i + win) / RATE)));
  const top = Math.max(...env.slice(0, 200));
  const fall30 = env.findLastIndex((e) => e >= top - 30);
  const tail = x.subarray(Math.round((land + 0.04) * RATE));
  const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  return {
    fall30,
    ring: db((power(band(tail, 150, 1200), 0, tail.length / RATE) * tail.length) / (power(x, 0, x.length / RATE) * x.length)),
    flat: flatness(band(tail, 150, 1200).subarray(0, Math.round(0.16 * RATE)), 150, 1200),
    peakDb: 20 * Math.log10(peak * p.volume),
  };
}

/**
 * The hit in the mix: the limiter's deepest pull over the 120 ms from its landing (5 ms windows), the 40–150 Hz band's
 * rise over the music alone at the same gain there, and the delivered AAC's true peak from just before it to 300 ms
 * after (no wider: a beat later is the next hit's).
 */
function inMix(mix: Mix, at: number) {
  let reduction = 0;
  for (let t = at - 0.005; t < at + 0.12; t += 0.005) reduction = Math.max(reduction, db((mix.gain ** 2 * power(mix.raw, t, t + 0.005)) / power(mix.master, t, t + 0.005)));
  return {
    low: db(power(mix.low, at, at + 0.12) / (mix.gain ** 2 * power(musicLow, at, at + 0.12))),
    reduction,
    truePeak: truePeak(mix.aac, at - 0.05, at + 0.3),
  };
}

/** The picture's frame a sound lands with: it plays the timeline's sound lag after it. */
const frameOf = (at: number) => Math.round((at - timeline.soundLagSeconds) * FPS);
const prominenceA = attacks(mixA.mastered!, hits.map((h) => frameOf(h.at))), prominenceB = attacks(mixB.mastered!, hits.map((h) => frameOf(h.at)));

// ---------- the table and the A/B file ----------

const cols = [['hit', 24], ['', 2], ['attack dB', 9], ['low dB', 7], ['fall30 ms', 9], ['ring dB', 7], ['flat', 5], ['GR dB', 6], ['AAC dBTP', 8], ['peak dBFS', 9]] as const;
const row = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(cols[0][1]) : c.padStart(cols[i][1]))).join('  ');
const lines = [
  'Each hit in the old (A) and new (B) soundtrack, through the real master:',
  '  attack: tools/attacks.py\'s prominence at its frame · low: the 40–150 Hz band over the 120 ms from its landing, over the music alone',
  '  fall30: ms from its landing until the sound alone stays 30 dB under its peak · ring: its 150–1200 Hz energy after 40 ms, against its whole',
  '  flat: that band\'s spectral flatness over 40–200 ms (a ringing tone is near 0) · GR: the limiter\'s deepest pull in the 120 ms',
  '  AAC: the true peak over −50…300 ms after the delivered AAC 192k encode · peak: the sound\'s sample peak at its volume (Remotion clips over 0)',
  ...([['A', A, mixA], ['B', B, mixB]] as const).map(([label, mix, { mastered }]) => `  master ${label}: +${db(mix.gain ** 2).toFixed(2)} dB, limited to ${truePeak(mastered!).toFixed(1)} dBTP; encoded, it peaks at ${truePeak(mix.aac).toFixed(1)} dBTP on frame ${truePeakFrame(mix.aac)}`),
  row(cols.map(([name]) => name)),
];
for (const h of hits) {
  for (const [label, p, mix, prominence] of [['A', h.a, A, prominenceA], ['B', h.b, B, prominenceB]] as const) {
    const alone = soundAlone(p), m = inMix(mix, h.at);
    lines.push(row([label === 'A' ? h.id : '', label, prominence.get(frameOf(h.at))!.toFixed(1), `${m.low >= 0 ? '+' : ''}${m.low.toFixed(1)}`, String(alone.fall30),
      alone.ring.toFixed(1), alone.flat.toFixed(2), m.reduction.toFixed(1), m.truePeak.toFixed(1), alone.peakDb.toFixed(1)]));
  }
}
lines.push('', 'Sounds:', ...hits.flatMap((h) => [`  ${h.id}  A ${JSON.stringify(h.a.take.request)} at ${h.a.volume}`, `  ${' '.repeat(h.id.length)}  B ${JSON.stringify(h.b.take.request)} at ${h.b.volume}`]));

// hits-ab.wav: the mastered mixes' excerpts, stereo, 5 ms fades so no cut clicks.
const stereoA = decode(mixA.mastered!, 2), stereoB = decode(mixB.mastered!, 2);
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE) * 2);
const excerpt = (x: Float32Array, at: number, after: number) => {
  const from = Math.round((at - EXCERPT.before) * RATE), n = Math.round((EXCERPT.before + after) * RATE), fade = RATE * 0.005;
  const out = x.slice(from * 2, (from + n) * 2);
  for (let i = 0; i < n; i++) { const g = Math.min(1, i / fade, (n - 1 - i) / fade); out[2 * i] *= g; out[2 * i + 1] *= g; }
  return out;
};
const parts: Float32Array[] = [];
let clock = 0;
lines.push('', `${join(AB, 'hits-ab.wav')}:`);
for (const h of hits) {
  const after = h === hits.at(-1) ? Math.min(stereoA.length, stereoB.length) / 2 / RATE - h.at : EXCERPT.after;
  lines.push(`  ${h.id.padEnd(24)}  A at ${clock.toFixed(2)} s, B at ${(clock + EXCERPT.before + after + EXCERPT.gap).toFixed(2)} s`);
  parts.push(excerpt(stereoA, h.at, after), silence(EXCERPT.gap), excerpt(stereoB, h.at, after), silence(EXCERPT.between));
  clock += 2 * (EXCERPT.before + after) + EXCERPT.gap + EXCERPT.between;
}
const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
parts.reduce((at, p) => { all.set(p, at); return at + p.length; }, 0);
runFfmpeg(['-y', '-v', 'error', '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-i', '-', '-c:a', 'pcm_s24le', join(AB, 'hits-ab.wav')], { input: Buffer.from(all.buffer) });
writeFileSync(join(AB, 'hits-ab.txt'), `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
