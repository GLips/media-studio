// render.ts: checks, renders and reviews a project's video with Remotion's renderer.
//
//   The whole thing:
//     npm run video -- projects/<p> [--plain]   framing check (every frame) → the mix, mastered to −14 LUFS →
//                                               video.mp4, with captions (--plain adds video-plain.mp4, without) →
//                                               delivery checks and review sheets → video.srt → out/watch.html
//   Look at it (open the images with an image viewer or the Read tool):
//     node scripts/render.ts projects/<p> --sheet=0.5,4,9 [--cols=3] [--w=640] [--out=out/check/a.jpg]   chosen times
//     node scripts/render.ts projects/<p> --strip=4:5 [--step=0.1]                                       a stretch, for motion
//     Add --captions to either to burn captions in.
//   One step at a time:
//     node scripts/render.ts projects/<p> --check [--every=5]   the framing check alone: highlights under tags/captions.
//                                                               Also writes out/check/timeline.json: when each scene
//                                                               and line lands, for aiming sheets and strips.
//     node scripts/render.ts projects/<p> --audio               just the mastered mix, out/mix.wav, to hear the levels
//     node scripts/render.ts projects/<p> --repeatable=2,8.5    renders those times alone, in other orders and among
//                                                               other frames, and fails if any differ. Run it on a new
//                                                               painted style (lib/paint): its randomness must be seeded.
import { serializeSrt } from '@remotion/captions';
import { renderFrames, renderMedia } from '@remotion/renderer';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { framesToMeasure, framingArtifactName, framingProblems, type FramingReport } from '../lib/framing-check.ts';
import { measureLoudness } from '../lib/loudness.ts';
import { artifactSink, openRenderSession, RENDER_CHROMIUM, RENDER_CONCURRENCY } from '../lib/render-session.ts';
import { H, W } from '../lib/studio/frame.ts';
import type { TimelineReport } from '../lib/studio/Video.tsx';

const argv = process.argv.slice(2);
const project = argv.find((a) => !a.startsWith('--'));
if (!project) {
  console.error('usage: node scripts/render.ts <project dir> --video | --sheet=… | --strip=a:b | --check');
  process.exit(1);
}
const args: Record<string, string | true> = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.slice(2).split('=');
  return [k, v ?? true];
}));
const outDir = join(project, 'out');
const at = (p: string) => (p.startsWith('/') ? p : join(project, p));
const videoFor = (captions: boolean) => join(outDir, captions ? 'video.mp4' : 'video-plain.mp4');

const run = (cmd: string, a: string[]) => new Promise<void>((ok, bad) => {
  spawn(cmd, a, { stdio: 'inherit' }).on('close', (code) => (code ? bad(new Error(`${cmd} exited ${code}`)) : ok()));
});

const every = Number(args.every ?? (args.video ? 1 : 5)), step = Number(args.step ?? 0.1);
if (!Number.isInteger(every) || every < 1) throw new Error(`--every must be a whole number of frames, at least 1, not ${args.every}`);
if (!(step > 0 && Number.isFinite(step))) throw new Error(`--step must be a positive number of seconds, not ${args.step}`);

const session = await openRenderSession(project);
const { serveUrl, props, compositionFor } = session;

// ---------- framing check ----------

/**
 * Measures every `every`th frame, plus every frame a scene's `expect` covers, and prints each problem as a stretch of
 * time (see lib/framing-check.ts). `--video` measures every frame.
 */
async function checkFraming(every: number) {
  // Captions on, so the caption is measured where it would show: a hidden one counts as faded out and covers nothing.
  const inputProps = props({ probe: true, captions: true });
  const composition = await compositionFor(inputProps);
  const { fps } = composition;
  const sink = artifactSink();
  const tmp = mkdtempSync(join(tmpdir(), 'framing-'));
  const measure = (frames: number[]) => renderFrames({
    composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps, outputDir: tmp, imageFormat: 'none', frames,
    onArtifact: sink.onArtifact, onStart: () => {}, onFrameUpdate: () => {},
  });
  // Frame 0 carries the timeline, which says which frames the expectations need.
  await measure([0]);
  const timeline = sink.json<TimelineReport>('timeline.json');
  const frames = framesToMeasure(composition.durationInFrames, every, timeline.expectations, fps);
  await measure(frames.filter((f) => f !== 0));
  rmSync(tmp, { recursive: true, force: true });

  const reports = frames.map((f) => sink.json<FramingReport>(framingArtifactName(f)));
  const problems = framingProblems(reports, timeline.expectations, fps, every);
  for (const p of problems) console.log(`  ✗ ${p.from.toFixed(2)}–${p.to.toFixed(2)}s  ${p.scene ? `[${p.scene}] ` : ''}${p.problem}`);
  const expected = timeline.expectations.length ? `, ${timeline.expectations.length} expectations` : '';
  console.log(problems.length ? `framing: ${problems.length} problem${problems.length > 1 ? 's' : ''}` : `framing ✓ (${frames.length} frames${expected})`);
  return { ok: problems.length === 0, timeline };
}

// ---------- sheets ----------

/** Renders frames at chosen times, small, and tiles them into one labelled image. */
async function sheet(times: number[], out: string, { cols = 3, w = 640, captions = false } = {}) {
  const composition = await compositionFor(props({ captions }));
  const frameOf = (t: number) => Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(t * composition.fps)));
  const frames = [...new Set(times.map(frameOf))].sort((a, b) => a - b);
  const stills = await session.renderStills(frames, { w, captions });

  // Even sizes: ffmpeg pads JPEG (4:2:0) frames to them anyway, and a mismatch fails the layout.
  const h = 2 * Math.round((w * H) / W / 2), label = 28, rows = Math.ceil(frames.length / cols);
  const cells = frames.map((f, i) => `[${i}:v]scale=${w}:${h},pad=${w}:${h + label}:0:${label}:color=0x222222,` +
    `drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='${(f / composition.fps).toFixed(2)}s':x=8:y=5:fontsize=18:fontcolor=0xeeeeee[c${i}]`);
  const layout = frames.map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * (h + label)}`).join('|');
  const stack = frames.length === 1 ? `[c0]copy[out]` :
    `${frames.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${frames.length}:layout=${layout}:fill=0x222222[out]`;
  mkdirSync(dirname(out), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...frames.flatMap((f) => ['-i', stills.fileFor(f)]),
    '-filter_complex', `${cells.join(';')};${stack}`, '-map', '[out]', '-frames:v', '1', '-q:v', '3', out]);
  rmSync(stills.dir, { recursive: true, force: true });
  console.log(`${out}  (${frames.length} frames, ${cols}×${rows})`);
}

// ---------- the videos ----------

// Delivery loudness, as YouTube and most players normalise to. Mastering limits 1 dB under the true-peak ceiling the
// delivery check holds it to, because AAC encoding adds overshoot.
const DELIVERY_LUFS = -14, DELIVERY_TRUE_PEAK = -1, MASTER_TRUE_PEAK = -2;
const masterWav = join(outDir, 'mix.wav');

/**
 * Renders the soundtrack once, uncompressed, and masters it: one gain to delivery loudness, then a limiter for the
 * peaks. Not loudnorm: when its linear mode can't reach the target it becomes an AGC, which fills in the music's ducks.
 */
async function renderMasteredMix() {
  const inputProps = props();
  const composition = await compositionFor(inputProps);
  const tmp = mkdtempSync(join(tmpdir(), 'mix-'));
  const raw = join(tmp, 'raw.wav');
  await renderMedia({ composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps, codec: 'wav', outputLocation: raw });
  mkdirSync(outDir, { recursive: true });
  const before = measureLoudness(raw);
  // Limiting at 4× the sample rate catches the peaks between samples too, which is what "true peak" counts.
  const master = (gainDb: number) => execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-af',
    `volume=${gainDb}dB,aresample=192000,alimiter=limit=${10 ** (MASTER_TRUE_PEAK / 20)}:attack=1:release=60:level=false:latency=true,aresample=48000`,
    '-c:a', 'pcm_s24le', masterWav]);
  // The limiter shaves a little loudness off the peaks it catches, so a second pass makes that back.
  let gain = DELIVERY_LUFS - before.lufs;
  master(gain);
  gain += DELIVERY_LUFS - measureLoudness(masterWav).lufs;
  master(gain);
  const after = measureLoudness(masterWav);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`mix: ${before.lufs} LUFS, ${before.truePeak} dBTP → +${gain.toFixed(1)} dB and limited → ${after.lufs} LUFS, ${after.truePeak} dBTP → ${masterWav}`);
}

async function renderVideo(captions: boolean) {
  const inputProps = props({ captions });
  const composition = await compositionFor(inputProps);
  const out = videoFor(captions);
  const tmp = mkdtempSync(join(tmpdir(), 'video-'));
  const silent = join(tmp, 'silent.mp4');
  let shown = -1;
  const started = Date.now();
  await renderMedia({
    composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps, codec: 'h264', outputLocation: silent, muted: true,
    crf: 18, x264Preset: 'slow', pixelFormat: 'yuv420p', imageFormat: 'jpeg', jpegQuality: 94,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== shown) { shown = pct; console.log(`  ${out}: ${pct}%`); }
    },
  });
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', silent, '-i', masterWav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`rendered ${out} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

const srtFrom = (timeline: TimelineReport) =>
  serializeSrt({ lines: timeline.cues.map((q) => [{ text: q.text, startMs: q.start * 1000, endMs: q.end * 1000, timestampMs: null, confidence: 1 }]) });

// Checks the delivered file, not the frames: right length, has sound at delivery loudness without clipping, and a
// tiled sheet of it to look at.
async function review(captions: boolean, timeline: TimelineReport) {
  const video = videoFor(captions);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', video]).toString());
  const actual = Number(probe.format.duration);
  const problems = [];
  if (Math.abs(actual - timeline.duration) > 0.1) problems.push(`is ${actual.toFixed(2)}s, the timeline is ${timeline.duration.toFixed(2)}s`);
  if (!probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')) problems.push('has no audio stream');
  const { lufs, truePeak } = measureLoudness(video);
  if (Math.abs(lufs - DELIVERY_LUFS) > 1) problems.push(`measures ${lufs} LUFS, not ${DELIVERY_LUFS} ± 1`);
  if (truePeak > DELIVERY_TRUE_PEAK) problems.push(`peaks at ${truePeak} dBTP, over ${DELIVERY_TRUE_PEAK}`);
  if (problems.length) throw new Error(`${video} ${problems.join(' and ')}`);

  const tiles = 16, out = join(outDir, 'check', captions ? 'review-captions.jpg' : 'review.jpg');
  mkdirSync(dirname(out), { recursive: true });
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=${tiles}/${actual},scale=480:-1,tile=4x4`, '-frames:v', '1', out]);
  console.log(`${video}: ${actual.toFixed(2)}s, ${lufs} LUFS, ${truePeak} dBTP ✓  sheet → ${out}`);
}

// A page to watch the finished videos, since file:// MP4s have no player of their own worth sharing a link to.
function writeWatchPage(title: string) {
  const page = join(outDir, 'watch.html');
  writeFileSync(page, `<!doctype html>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { margin: 0; background: #16181c; color: #ddd; font: 15px -apple-system, system-ui, sans-serif; }
  main { max-width: 1280px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 22px; margin: 0 0 16px; }
  video { width: 100%; border-radius: 10px; background: #000; }
  nav { display: flex; gap: 16px; margin: 14px 0 0; }
  a { color: #8fb4ff; }
</style>
<main>
  <h1>${title}</h1>
  <video id="v" src="video.mp4" controls autoplay></video>
  <nav>
    <a href="video.mp4" download>Download</a>${existsSync(videoFor(false)) ? `
    <a href="#" onclick="v.src='video-plain.mp4';return false">Without captions</a>
    <a href="video-plain.mp4" download>Download without captions</a>` : ''}
    <a href="video.srt" download>Captions (.srt)</a>
  </nav>
</main>
`);
  console.log(`watch → ${page}`);
}

// ---------- dispatch ----------

const captions = Boolean(args.captions);

/**
 * Renders each frame at `times` fresh, in a tab of its own, then again in one tab after other frames: the rest in
 * order, the rest reversed, and a later and an earlier neighbour. A tab's history is what leaks into a frame that
 * isn't a pure function of time (an unseeded random stream, drawing deferred to the next frame). GPU rounding leaves
 * renders a few levels apart, so equal means over 50 dB PSNR.
 */
async function isRepeatable(times: number[]) {
  const { fps, durationInFrames } = await compositionFor(props());
  const frames = times.map((t) => Math.round(t * fps));
  const bad = frames.find((f) => !(f >= 0 && f < durationInFrames));
  if (bad !== undefined) throw new Error(`${bad / fps}s is outside the video`);
  const fresh = new Map<number, Awaited<ReturnType<typeof session.renderStills>>>();
  for (const f of frames) fresh.set(f, await session.renderStills([f], { w: W }));
  const order = [
    ...frames, ...[...frames].reverse(),
    ...frames.flatMap((f) => [Math.min(durationInFrames - 1, f + 7), f, Math.max(0, f - 11), f]),
  ];
  const replay = await session.renderReplay(order, { w: W });
  const worst = new Map<number, number>();
  for (const [i, f] of order.entries()) {
    if (!fresh.has(f)) continue;
    const { stderr } = spawnSync('ffmpeg', ['-i', fresh.get(f)!.fileFor(f), '-i', replay.fileFor(i), '-lavfi', 'psnr', '-f', 'null', '-'], { encoding: 'utf8' });
    const psnr = Number(/average:(\S+)/.exec(stderr)![1].replace('inf', 'Infinity'));
    worst.set(f, Math.min(worst.get(f) ?? Infinity, psnr));
  }
  for (const r of [...fresh.values(), replay]) rmSync(r.dir, { recursive: true, force: true });
  let ok = true;
  for (const f of frames) {
    const db = worst.get(f)!;
    ok &&= db > 50;
    console.log(`  ${db > 50 ? '✓' : '✗'} ${(f / fps).toFixed(2)}s  ${Number.isFinite(db) ? `${db.toFixed(1)} dB at worst` : 'identical'}`);
  }
  console.log(ok ? 'repeatable ✓' : 'not repeatable: something in those frames depends on what the tab drew before');
  return ok;
}
if (args.video) {
  const { ok, timeline } = await checkFraming(every);
  if (!ok) throw new Error('fix the framing problems above before rendering (look at a stretch with --strip=a:b)');
  const estimated = timeline.cues.filter((q) => !q.voiced).map((q) => q.id);
  if (estimated.length) throw new Error(`${estimated.join(', ')} ${estimated.length > 1 ? 'are' : 'is'} estimated, not voiced: run npm run tts before rendering the video`);
  await renderMasteredMix();
  // An old plain video would no longer match; the watch page offers it only if it's there.
  if (!args.plain) rmSync(videoFor(false), { force: true });
  for (const cap of args.plain ? [true, false] : [true]) {
    await renderVideo(cap);
    await review(cap, timeline);
  }
  writeFileSync(join(outDir, 'video.srt'), srtFrom(timeline));
  writeWatchPage(timeline.title);
} else if (args.audio) {
  await renderMasteredMix();
} else if (args.sheet || args.strip) {
  let times: number[];
  if (args.strip) {
    const [a, b] = String(args.strip).split(':').map(Number);
    times = [];
    for (let t = a; t <= b + 1e-6; t += step) times.push(Number(t.toFixed(3)));
  } else times = String(args.sheet).split(',').map(Number);
  if (!times.length || times.some((t) => !Number.isFinite(t))) throw new Error('give times in seconds: --sheet=0.5,4,9 or --strip=4:5');
  await sheet(times, at(typeof args.out === 'string' ? args.out : 'out/check/sheet.jpg'), { cols: Number(args.cols || (args.strip ? 5 : 3)), w: Number(args.w || (args.strip ? 384 : 640)), captions });
} else if (args.repeatable) {
  if (!(await isRepeatable(String(args.repeatable).split(',').map(Number)))) process.exitCode = 1;
} else if (args.check) {
  const { ok, timeline } = await checkFraming(every);
  mkdirSync(join(outDir, 'check'), { recursive: true });
  writeFileSync(join(outDir, 'check', 'timeline.json'), JSON.stringify(timeline, null, 2));
  if (!ok) process.exitCode = 1;
} else {
  console.error('nothing to do: pass --video, --audio, --sheet, --strip or --check');
  process.exitCode = 1;
}
