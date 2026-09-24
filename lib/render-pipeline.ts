// render-pipeline.ts: what the render commands do with a bundled project (lib/render-session.ts): the framing check,
// contact sheets, the mastered mix, the delivered videos and their review, and the repeatability proof.
//
// Progress goes to stderr; each function returns what it made, for the command to print on stdout.
import { serializeSrt } from '@remotion/captions';
import { renderFrames, renderMedia } from '@remotion/renderer';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { framesToMeasure, framingArtifactName, framingProblems, type FramingReport } from './framing-check.ts';
import { measureLoudness } from './loudness.ts';
import { artifactSink, RENDER_CHROMIUM, RENDER_CONCURRENCY, type RenderSession } from './render-session.ts';
import { H, W } from './studio/frame.ts';
import { isVoicedWithDraft } from './voice-project.ts';
import type { TimelineReport } from './studio/Video.tsx';

const outDirFor = (session: RenderSession) => join(session.project, 'out');
const videoFor = (session: RenderSession, captions: boolean) => join(outDirFor(session), captions ? 'video.mp4' : 'video-plain.mp4');
const masterWavFor = (session: RenderSession) => join(outDirFor(session), 'mix.wav');

// ---------- framing check ----------

export type FramingCheck = { ok: boolean; timeline: TimelineReport; report: string[] };

/**
 * Measures every `every`th frame, plus every frame a scene's `expect` covers, and reports each problem as a stretch
 * of time (see lib/framing-check.ts).
 */
export async function checkProjectFraming(session: RenderSession, every: number): Promise<FramingCheck> {
  const { serveUrl, props, compositionFor } = session;
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
  const report = problems.map((p) => `  ✗ ${p.from.toFixed(2)}–${p.to.toFixed(2)}s  ${p.scene ? `[${p.scene}] ` : ''}${p.problem}`);
  const sampled = every === 1 ? 'every frame' : `one frame in ${every}${timeline.expectations.length ? ', plus the frames expectations cover' : ''}`;
  const expected = timeline.expectations.length ? `, ${timeline.expectations.length} expectation${timeline.expectations.length > 1 ? 's' : ''}` : '';
  const measured = `${frames.length} of ${composition.durationInFrames} frames: ${sampled}${expected}`;
  report.push(problems.length ? `framing: ${problems.length} problem${problems.length > 1 ? 's' : ''} (${measured})` : `framing ✓ (${measured})`);
  return { ok: problems.length === 0, timeline, report };
}

/** Writes out/check/timeline.json: when each scene and line lands, for aiming sheets and strips. */
export function writeTimelineReport(session: RenderSession, timeline: TimelineReport): string {
  const file = join(outDirFor(session), 'check', 'timeline.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(timeline, null, 2));
  return file;
}

/** Each scene with its lines under it, and when each starts and ends in video seconds, for aiming `studio look`. */
export function formatTimelineTable(timeline: TimelineReport): string[] {
  const rows = timeline.scenes.flatMap((scene) => [
    [scene.id, scene.start, scene.start + scene.dur, ''],
    ...timeline.cues.filter((c) => scene.lines.includes(c.id)).map((c) => [`  ${c.id}`, c.start, c.end, c.voiced ? '' : 'estimated'] as const),
  ] as const);
  const width = Math.max('scene / line'.length, ...rows.map(([id]) => id.length));
  const row = (id: string, start: string, end: string, note: string) => `${id.padEnd(width)}  ${start.padStart(7)}  ${end.padStart(7)}  ${note}`.trimEnd();
  return [row('scene / line', 'start', 'end', ''), ...rows.map(([id, start, end, note]) => row(id, start.toFixed(2), end.toFixed(2), note))];
}

// ---------- sheets ----------

/** Seconds from `from` to `to` inclusive, `step` (positive, or this never ends) apart: the times a strip shows. */
export function stripTimes(from: number, to: number, step: number): number[] {
  const times = [];
  for (let t = from; t <= to + 1e-6; t += step) times.push(Number(t.toFixed(3)));
  return times;
}

/** Renders frames at chosen times, small, and tiles them into one labelled image at `out`. */
export async function renderContactSheet(session: RenderSession, times: number[], out: string, { cols, w, captions }: { cols: number; w: number; captions: boolean }) {
  if (!times.length || times.some((t) => !Number.isFinite(t))) throw new Error('give times in seconds: --sheet=0.5,4,9 or --strip=4:5');
  const composition = await session.compositionFor(session.props({ captions }));
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
  console.error(`${frames.length} frames, ${cols}×${rows}`);
  return out;
}

// ---------- the mix ----------

// Delivery loudness, as YouTube and most players normalise to. Mastering limits 1 dB under the true-peak ceiling the
// delivery check holds it to, because AAC encoding adds overshoot.
const DELIVERY_LUFS = -14, DELIVERY_TRUE_PEAK = -1, MASTER_TRUE_PEAK = -2;

/**
 * Renders the soundtrack once, uncompressed, and masters it to out/mix.wav: one gain to delivery loudness, then a
 * limiter for the peaks. Not loudnorm: when its linear mode can't reach the target it becomes an AGC, which fills in
 * the music's ducks.
 */
export async function renderMasteredMix(session: RenderSession): Promise<string> {
  const { serveUrl, props, compositionFor } = session;
  const masterWav = masterWavFor(session);
  const inputProps = props();
  const composition = await compositionFor(inputProps);
  const tmp = mkdtempSync(join(tmpdir(), 'mix-'));
  const raw = join(tmp, 'raw.wav');
  await renderMedia({ composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps, codec: 'wav', outputLocation: raw });
  mkdirSync(outDirFor(session), { recursive: true });
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
  console.error(`mix: ${before.lufs} LUFS, ${before.truePeak} dBTP → +${gain.toFixed(1)} dB and limited → ${after.lufs} LUFS, ${after.truePeak} dBTP`);
  return masterWav;
}

// ---------- the videos ----------

async function renderVideo(session: RenderSession, captions: boolean) {
  const { serveUrl, props, compositionFor } = session;
  const inputProps = props({ captions });
  const composition = await compositionFor(inputProps);
  const out = videoFor(session, captions);
  const tmp = mkdtempSync(join(tmpdir(), 'video-'));
  const silent = join(tmp, 'silent.mp4');
  let shown = -1;
  const started = Date.now();
  await renderMedia({
    composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps, codec: 'h264', outputLocation: silent, muted: true,
    crf: 18, x264Preset: 'slow', pixelFormat: 'yuv420p', imageFormat: 'jpeg', jpegQuality: 94,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== shown) { shown = pct; console.error(`  ${out}: ${pct}%`); }
    },
  });
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', silent, '-i', masterWavFor(session), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
  rmSync(tmp, { recursive: true, force: true });
  console.error(`rendered ${out} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

const srtFrom = (timeline: TimelineReport) =>
  serializeSrt({ lines: timeline.cues.map((q) => [{ text: q.text, startMs: q.start * 1000, endMs: q.end * 1000, timestampMs: null, confidence: 1 }]) });

// Checks the delivered file, not the frames: right length, has sound at delivery loudness without clipping, and a
// tiled sheet of it to look at.
function reviewDelivery(session: RenderSession, captions: boolean, timeline: TimelineReport) {
  const video = videoFor(session, captions);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', video]).toString());
  const actual = Number(probe.format.duration);
  const problems = [];
  if (Math.abs(actual - timeline.duration) > 0.1) problems.push(`is ${actual.toFixed(2)}s, the timeline is ${timeline.duration.toFixed(2)}s`);
  if (!probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')) problems.push('has no audio stream');
  const { lufs, truePeak } = measureLoudness(video);
  if (Math.abs(lufs - DELIVERY_LUFS) > 1) problems.push(`measures ${lufs} LUFS, not ${DELIVERY_LUFS} ± 1`);
  if (truePeak > DELIVERY_TRUE_PEAK) problems.push(`peaks at ${truePeak} dBTP, over ${DELIVERY_TRUE_PEAK}`);
  if (problems.length) throw new Error(`${video} ${problems.join(' and ')}`);

  const tiles = 16, out = join(outDirFor(session), 'check', captions ? 'review-captions.jpg' : 'review.jpg');
  mkdirSync(dirname(out), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=${tiles}/${actual},scale=480:-1,tile=4x4`, '-frames:v', '1', out]);
  console.error(`${video}: ${actual.toFixed(2)}s, ${lufs} LUFS, ${truePeak} dBTP ✓  sheet → ${out}`);
}

// A page to watch the finished videos, since file:// MP4s have no player of their own worth sharing a link to.
function writeWatchPage(session: RenderSession, title: string, draft: boolean) {
  const page = join(outDirFor(session), 'watch.html');
  writeFileSync(page, `<!doctype html>
<meta charset="utf-8">
<title>${draft ? 'DRAFT VOICE · ' : ''}${title}</title>
<style>
  body { margin: 0; background: #16181c; color: #ddd; font: 15px -apple-system, system-ui, sans-serif; }
  main { max-width: 1280px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 22px; margin: 0 0 16px; }
  video { width: 100%; border-radius: 10px; background: #000; }
  nav { display: flex; gap: 16px; margin: 14px 0 0; }
  a { color: #8fb4ff; }
  .draft { background: #b82b2b; color: #fff; padding: 10px 14px; border-radius: 8px; margin: 0 0 16px; font-weight: 600; }
</style>
<main>
  <h1>${title}</h1>${draft ? `
  <p class="draft">DRAFT VOICE: read by macOS say for timing, not the real voice.</p>` : ''}
  <video id="v" src="video.mp4" controls autoplay></video>
  <nav>
    <a href="video.mp4" download>Download</a>${existsSync(videoFor(session, false)) ? `
    <a href="#" onclick="v.src='video-plain.mp4';return false">Without captions</a>
    <a href="video-plain.mp4" download>Download without captions</a>` : ''}
    <a href="video.srt" download>Captions (.srt)</a>
  </nav>
</main>
`);
  return page;
}

const draftVoiceWarning = (session: RenderSession) => `
!!!! DRAFT VOICE: macOS say read this video (studio voice --read=draft). It's for timing, not for sharing.
!!!! Voice it for real first: studio voice ${basename(session.project)}
`;

/**
 * The whole pipeline: the framing check on every frame, refusing to go on if it fails or a line is still estimated;
 * the mastered mix; video.mp4 with captions (and video-plain.mp4 without, if `plain`), each checked for delivery;
 * video.srt; and out/watch.html. Returns what it delivered.
 */
export async function renderDeliveredVideo(session: RenderSession, { plain }: { plain: boolean }): Promise<string[]> {
  const { ok, timeline, report } = await checkProjectFraming(session, 1);
  for (const line of report) console.error(line);
  if (!ok) throw new Error('fix the framing problems above before rendering (look at a stretch with studio look <project> --strip=a:b)');
  const estimated = timeline.cues.filter((q) => !q.voiced).map((q) => q.id);
  if (estimated.length) throw new Error(`${estimated.join(', ')} ${estimated.length > 1 ? 'are' : 'is'} estimated, not voiced: run studio voice <project> before rendering the video`);
  const draft = isVoicedWithDraft(session.project);
  if (draft) console.error(draftVoiceWarning(session));
  await renderMasteredMix(session);
  // An old plain video would no longer match; the watch page offers it only if it's there.
  if (!plain) rmSync(videoFor(session, false), { force: true });
  const variants = plain ? [true, false] : [true];
  for (const captions of variants) {
    await renderVideo(session, captions);
    reviewDelivery(session, captions, timeline);
  }
  const srt = join(outDirFor(session), 'video.srt');
  writeFileSync(srt, srtFrom(timeline));
  const delivered = [...variants.map((captions) => videoFor(session, captions)), srt, writeWatchPage(session, timeline.title, draft)];
  // Again at the end, where it can't scroll away under the render's progress.
  if (draft) console.error(draftVoiceWarning(session));
  return delivered;
}

// ---------- repeatability ----------

/**
 * Renders each frame at `times` fresh, in a tab of its own, then again in one tab after other frames: the rest in
 * order, the rest reversed, and a later and an earlier neighbour. A tab's history is what leaks into a frame that
 * isn't a pure function of time (an unseeded random stream, drawing deferred to the next frame). GPU rounding leaves
 * renders a few levels apart, so equal means over 50 dB PSNR.
 */
export async function checkFramesRepeatable(session: RenderSession, times: number[]): Promise<{ ok: boolean; report: string[] }> {
  if (!times.length || times.some((t) => !Number.isFinite(t))) throw new Error('give times in seconds, e.g. 2,8.5');
  const { fps, durationInFrames } = await session.compositionFor(session.props());
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
  const report = frames.map((f) => {
    const db = worst.get(f)!;
    return `  ${db > 50 ? '✓' : '✗'} ${(f / fps).toFixed(2)}s  ${Number.isFinite(db) ? `${db.toFixed(1)} dB at worst` : 'identical'}`;
  });
  const ok = frames.every((f) => worst.get(f)! > 50);
  report.push(ok ? 'repeatable ✓' : 'not repeatable: something in those frames depends on what the tab drew before');
  return { ok, report };
}
