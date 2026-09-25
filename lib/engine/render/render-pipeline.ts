// render-pipeline.ts: what the render commands do with a bundled project (lib/engine/render/render-session.ts): the framing check,
// contact sheets and motion graphs, the mastered mix, the delivered videos and their review, and the repeatability proof.
//
// Progress goes to stderr; each function returns what it made, for the command to print on stdout.
import { serializeSrt } from '@remotion/captions';
import { renderFrames } from '@remotion/renderer';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { rasterizeSvgs } from '../capture/html-raster.ts';
import { framingArtifactName, framingProblems, takeFitWarnings, type FramingReport } from '#models/frame/framing-check.ts';
import { holdProblems } from '#models/motion/hold-check.ts';
import { buildMotionGraph, motionGraphBackdropFrame, type MotionGraphSpace } from '#models/motion/motion-graph.ts';
import { assembleMotionTracks, formatMotionReport, motionArtifactName, type FrameMotion, type MotionTracks } from '#models/motion/motion-tracks.ts';
import { measureLoudness } from '../ffmpeg/loudness.ts';
import { artifactSink, DELIVERY_AUDIO_CODEC, RENDER_CHROMIUM, RENDER_CONCURRENCY, TIMELINE_REPORT_NAME, type RenderSession } from './render-session.ts';
import { loadRenderSnapshot, writeRenderSnapshot } from '../snapshot/render-snapshot.ts';
import { sfxEventsFrom, sfxMarkArtifactName, type SfxEvent, type SfxMark } from '../../sfx/cue-events.ts';
import { sfxCueListReport } from '../../sfx/project-cue-list.ts';
import { W } from '#models/frame/frame.ts';
import { isVoicedWithDraft } from '../voice/voice-project.ts';
import type { TimelineReport } from '../../studio/Video.tsx';
import { countVideoFrames, measureWithFfmpeg, runFfmpeg, runFfprobe } from '../ffmpeg/ffmpeg.ts';

const outDirFor = (session: RenderSession) => join(session.project, 'out');
const videoFor = (session: RenderSession, captions: boolean) => join(outDirFor(session), captions ? 'video.mp4' : 'video-plain.mp4');
const masterWavFor = (session: RenderSession, auditionSfxCueList = false) => join(outDirFor(session), auditionSfxCueList ? 'mix-sfx-cues.wav' : 'mix.wav');

// ---------- the check ----------

/** What `studio check` looks at: the whole video, one scene (with its crossfades), or a stretch of seconds. */
export type CheckScope = { scene?: string; at?: readonly [number, number] };

/** The frames a scope covers, inclusive. */
export function checkedFrames(timeline: TimelineReport, { scene, at }: CheckScope): { first: number; last: number } {
  const { fps, durationInFrames } = timeline;
  let from = 0, to = durationInFrames / fps;
  if (scene !== undefined) {
    const s = timeline.scenes.find((x) => x.id === scene);
    if (!s) throw new Error(`there's no scene "${scene}": ${timeline.scenes.map((x) => x.id).join(', ')}`);
    from = timeline.crossfades.find((c) => c.to === scene)?.start ?? s.start;
    to = timeline.crossfades.find((c) => c.from === scene)?.end ?? s.start + s.dur;
  }
  if (at) [from, to] = [Math.max(from, at[0]), Math.min(to, at[1])];
  // The first frame at or after `from`; the epsilon keeps a scene start that's a whole frame from rounding past it.
  const first = Math.max(0, Math.ceil(from * fps - 1e-6)), last = Math.min(durationInFrames - 1, Math.ceil(to * fps) - 1);
  if (last < first) throw new Error(`${from.toFixed(2)}–${to.toFixed(2)}s holds no frames of the video`);
  return { first, last };
}

export type ProjectCheck = { ok: boolean; timeline: TimelineReport; motion: MotionTracks; sfxEvents: SfxEvent[]; report: string[] };

/**
 * Measures every frame of `scope` (the whole video by default) and reports framing problems as stretches of time (see
 * lib/models/frame/framing-check.ts), then strained take fits, which don't fail it, then what motion it tracked (see
 * lib/models/motion/motion-tracks.ts), whose instrumentation errors do.
 */
export async function checkProject(session: RenderSession, scope: CheckScope = {}): Promise<ProjectCheck> {
  const { serveUrl, props, compositionFor } = session;
  // Captions on, so the caption is measured where it would show: a hidden one counts as faded out and covers nothing.
  const inputProps = props({ probe: true, captions: true });
  const composition = await compositionFor(inputProps);
  const { fps } = composition;
  const sink = artifactSink();
  const tmp = mkdtempSync(join(tmpdir(), 'check-'));
  const measure = (frames: number[]) => renderFrames({
    composition, serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps, outputDir: tmp, imageFormat: 'none', frames,
    onArtifact: sink.onArtifact, onStart: () => {}, onFrameUpdate: () => {},
  });
  // Frame 0 carries the timeline, which says where a scene is.
  await measure([0]);
  const timeline = sink.json<TimelineReport>(TIMELINE_REPORT_NAME);
  const span = checkedFrames(timeline, scope);
  const frames = Array.from({ length: span.last - span.first + 1 }, (_, i) => span.first + i);
  await measure(frames.filter((f) => f !== 0));
  rmSync(tmp, { recursive: true, force: true });

  const reports = frames.map((f) => sink.json<FramingReport>(framingArtifactName(f)));
  const sees = timeline.expectations.filter((e) => 'see' in e), holds = timeline.expectations.filter((e) => 'hold' in e);
  const problems = framingProblems(reports, sees, fps, span);
  const problemLine = (p: { from: number; to: number; scene?: string; problem: string }) => `  ✗ ${p.from.toFixed(2)}–${p.to.toFixed(2)}s  ${p.scene ? `[${p.scene}] ` : ''}${p.problem}`;
  const report = [...problems.map(problemLine), ...takeFitWarnings(reports).map((w) => `  ! [${w.scene}] ${w.warning}`)];
  const expected = sees.length ? `, ${sees.length} expectation${sees.length > 1 ? 's' : ''}` : '';
  const measured = `${(span.first / fps).toFixed(2)}–${((span.last + 1) / fps).toFixed(2)}s, every frame${expected}`;
  report.push(problems.length ? `framing: ${problems.length} problem${problems.length > 1 ? 's' : ''} (${measured})` : `framing ✓ (${measured})`);

  const motion = assembleMotionTracks(frames.map((f) => sink.json<FrameMotion>(motionArtifactName(f))), { fps, ...span });
  const motionReport = formatMotionReport(motion);
  report.push(...motionReport.lines);

  const held = holdProblems(motion, timeline, holds, basename(session.project));
  report.push(...held.problems.map(problemLine), ...held.unchecked.map((u) => `  – not checked: ${u}`));
  if (holds.length) {
    report.push(held.problems.length ? `holds: ${held.problems.length} of ${held.checked} not kept`
      : held.checked ? `holds ✓ (${held.checked} steady and visible)` : 'holds: none in the checked frames');
  }

  const sfxEvents = sfxEventsFrom({ timeline, motion, marks: frames.flatMap((f) => sink.json<SfxMark[]>(sfxMarkArtifactName(f))) });
  const sfx = sfxCueListReport(session.project, timeline, sfxEvents, span);
  report.push(...sfx.lines);
  return { ok: problems.length === 0 && motionReport.ok && held.problems.length === 0 && sfx.ok, timeline, motion, sfxEvents, report };
}

/**
 * Writes out/check/timeline.json (when each scene, line and word lands, and where scenes crossfade, for aiming sheets
 * and strips) and the motion tracks: out/check/motion.json for the whole video, and a scoped check's beside it
 * (motion-<scene>.json, motion-<from>-<to>.json), so it never replaces the whole one. Returns both paths. They're the
 * latest check's, for reading now; a render's own timeline and motion are in its snapshot.
 */
export function writeCheckReports(session: RenderSession, { timeline, motion }: Pick<ProjectCheck, 'timeline' | 'motion'>, { scene, at }: CheckScope = {}): string[] {
  const dir = join(outDirFor(session), 'check');
  mkdirSync(dir, { recursive: true });
  const scope = [scene, at && at.join('-')].filter(Boolean).join('-');
  const files = [[join(dir, TIMELINE_REPORT_NAME), JSON.stringify(timeline, null, 2)], [join(dir, scope ? `motion-${scope}.json` : 'motion.json'), JSON.stringify(motion)]] as const;
  for (const [file, content] of files) writeFileSync(file, content);
  return files.map(([file]) => file);
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

// ---------- motion graphs ----------

/**
 * Measures the motion of `at` (seconds) and draws it (see lib/models/motion/motion-graph.ts) over one of its frames, as a PNG
 * at `out` with the number summary beside it (`.txt`). Measuring here rather than reading out/check/motion.json means
 * a graph is never of an older render. Returns the summary and both files.
 */
export async function renderMotionGraph(session: RenderSession, { at, tracks, space, trailStep, captions, out }: {
  at: readonly [number, number]; tracks?: string[]; space: MotionGraphSpace; trailStep: number; captions: boolean; out: string;
}) {
  const { timeline, motion } = await checkProject(session, { at });
  const { first, last } = motion.frames, frame = motionGraphBackdropFrame(motion, timeline, { first, last, tracks });
  const stills = await session.renderStills([frame], { w: 1280, captions });
  const href = `data:image/jpeg;base64,${readFileSync(stills.fileFor(frame)).toString('base64')}`;
  rmSync(stills.dir, { recursive: true, force: true });
  const graph = buildMotionGraph(motion, timeline, { first, last, space, tracks, trailStep, backdrop: { frame, href } });

  await rasterizeSvgs([{ svg: graph.svg, width: graph.width, height: graph.height, out }]);
  const summaryFile = out.replace(/\.[^./]+$/, '') + '.txt';
  writeFileSync(summaryFile, `${graph.summary.join('\n')}\n`);
  return { summary: graph.summary, files: [out, summaryFile] };
}

// ---------- the mix ----------

// Delivery loudness, as YouTube and most players normalise to. Mastering limits 1 dB under the true-peak ceiling the
// delivery check holds it to, because AAC encoding adds overshoot.
const DELIVERY_LUFS = -14, DELIVERY_TRUE_PEAK = -1, MASTER_TRUE_PEAK = -2;

/**
 * Renders the soundtrack once, uncompressed, and masters it to out/mix.wav: one gain to delivery loudness, then a
 * limiter for the peaks. Not loudnorm: when its linear mode can't reach the target it becomes an AGC, which fills in
 * the music's ducks. With `auditionSfxCueList`, the project's cue list plays whether or not the video plays it, into
 * out/mix-sfx-cues.wav, to audition it beside the video's mix.
 */
export async function renderMasteredMix(session: RenderSession, { auditionSfxCueList = false }: { auditionSfxCueList?: boolean } = {}): Promise<string> {
  const masterWav = masterWavFor(session, auditionSfxCueList);
  const tmp = mkdtempSync(join(tmpdir(), 'mix-'));
  const raw = await session.renderAudio({ out: join(tmp, 'raw.wav'), inputProps: session.props({ auditionSfxCueList }) });
  mkdirSync(outDirFor(session), { recursive: true });
  const before = measureLoudness(raw);
  // Limiting at 4× the sample rate catches the peaks between samples too, which is what "true peak" counts.
  const master = (gainDb: number, ceilingDb: number) => runFfmpeg(['-y', '-v', 'error', '-i', raw, '-af',
    `volume=${gainDb}dB,aresample=192000,alimiter=limit=${10 ** (ceilingDb / 20)}:attack=1:release=60:level=false:latency=true,aresample=48000`,
    '-c:a', 'pcm_s24le', masterWav]);
  const encoded = join(tmp, 'encoded.m4a');
  let gain = DELIVERY_LUFS - before.lufs, ceiling = MASTER_TRUE_PEAK, encodedPeak = Infinity;
  // AAC overshoots sharp transients by more than MASTER_TRUE_PEAK's 1 dB allows (a tattoo needle's bite came out 2.3 dB
  // over its master), so the ceiling comes down by what the encoded master still peaks over delivery's.
  for (let pass = 0; pass < 4 && encodedPeak > DELIVERY_TRUE_PEAK; pass++) {
    if (pass > 0) ceiling -= encodedPeak - DELIVERY_TRUE_PEAK + 0.2;
    // The limiter shaves a little loudness off the peaks it catches, so a second pass makes that back.
    master(gain, ceiling);
    gain += DELIVERY_LUFS - measureLoudness(masterWav).lufs;
    master(gain, ceiling);
    runFfmpeg(['-y', '-v', 'error', '-i', masterWav, ...DELIVERY_AUDIO_CODEC, encoded]);
    encodedPeak = measureLoudness(encoded).truePeak;
  }
  const after = measureLoudness(masterWav);
  rmSync(tmp, { recursive: true, force: true });
  console.error(`mix: ${before.lufs} LUFS, ${before.truePeak} dBTP → +${gain.toFixed(1)} dB and limited at ${ceiling.toFixed(1)} → ${after.lufs} LUFS, ${after.truePeak} dBTP (${encodedPeak} encoded)`);
  return masterWav;
}

// ---------- the videos ----------

/** A render's progress on stderr, every tenth. */
function renderProgress(out: string) {
  let shown = -1;
  return ({ progress }: { progress: number }) => {
    const pct = Math.floor(progress * 10) * 10;
    if (pct !== shown) { shown = pct; console.error(`  ${out}: ${pct}%`); }
  };
}

/** The delivered video, under the mastered mix, its snapshot carrying the check's timeline and motion. */
async function renderVideo(session: RenderSession, captions: boolean, { timeline, motion }: Pick<ProjectCheck, 'timeline' | 'motion'>) {
  const out = videoFor(session, captions);
  const started = Date.now();
  await session.renderVideo({
    out, inputProps: session.props({ captions }), soundtrack: masterWavFor(session), timeline, motion,
    crf: 18, x264Preset: 'slow', pixelFormat: 'yuv420p', imageFormat: 'jpeg', jpegQuality: 94, onProgress: renderProgress(out),
  });
  console.error(`rendered ${out} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

const srtFrom = (timeline: TimelineReport) =>
  serializeSrt({ lines: timeline.cues.map((q) => [{ text: q.text, startMs: q.start * 1000, endMs: q.captionEnd * 1000, timestampMs: null, confidence: 1 }]) });

// Checks the delivered file, not the frames: right length, has sound at delivery loudness without clipping, and a
// tiled sheet of it to look at.
function reviewDelivery(session: RenderSession, captions: boolean, timeline: TimelineReport) {
  const video = videoFor(session, captions);
  const probe = JSON.parse(runFfprobe(['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', video]).toString());
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
  runFfmpeg(['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=${tiles}/${actual},scale=480:-1,tile=4x4`, '-frames:v', '1', out]);
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
  const check = await checkProject(session);
  const { ok, timeline, report } = check;
  for (const line of report) console.error(line);
  writeCheckReports(session, check);
  if (!ok) throw new Error('fix the problems above before rendering (look at a stretch with studio look <project> --strip=a:b)');
  const estimated = timeline.cues.filter((q) => !q.voiced).map((q) => q.id);
  if (estimated.length) throw new Error(`${estimated.join(', ')} ${estimated.length > 1 ? 'are' : 'is'} estimated, not voiced: run studio voice <project> before rendering the video`);
  const draft = isVoicedWithDraft(session.project);
  if (draft) console.error(draftVoiceWarning(session));
  await renderMasteredMix(session);
  // An old plain video would no longer match; the watch page offers it only if it's there.
  if (!plain) rmSync(videoFor(session, false), { force: true });
  const variants = plain ? [true, false] : [true];
  for (const captions of variants) {
    await renderVideo(session, captions, check);
    reviewDelivery(session, captions, timeline);
  }
  const srt = join(outDirFor(session), 'video.srt');
  writeFileSync(srt, srtFrom(timeline));
  const delivered = [...variants.map((captions) => videoFor(session, captions)), srt, writeWatchPage(session, timeline.title, draft)];
  // Again at the end, where it can't scroll away under the render's progress.
  if (draft) console.error(draftVoiceWarning(session));
  return delivered;
}

// ---------- slices ----------

/**
 * Frames `from`–`end` (exclusive) of the video, silent, at `out`: to re-render just the part a change touched. No
 * framing check and no mix; its snapshot records where in the video it starts.
 */
export async function renderVideoSlice(session: RenderSession, { from, end, out }: { from: number; end: number; out: string }): Promise<string> {
  const timeline = await session.readTimeline();
  if (!(Number.isInteger(from) && Number.isInteger(end) && from >= 0 && end > from && end <= timeline.durationInFrames)) {
    throw new Error(`frames ${from}–${end - 1} aren't within the video's 0–${timeline.durationInFrames - 1}`);
  }
  mkdirSync(dirname(out), { recursive: true });
  return session.renderVideo({ out, frames: { from, end }, muted: true, timeline, crf: 20, onProgress: renderProgress(out) });
}

/**
 * Joins the slices in `dir` (renderVideoSlice's, one file each) into the whole video at `out`, under a fresh mastered
 * mix, so the placed sounds play across the joins. Refuses a slice rendered on another timeline than the video's now,
 * a gap or an overlap between slices, or a file short of the frames its snapshot says it holds: each would put every
 * later frame off its sound.
 */
export async function joinVideoSlices(session: RenderSession, { dir, out }: { dir: string; out: string }): Promise<string> {
  const timeline = await session.readTimeline();
  const now = JSON.stringify(timeline);
  // Not the join itself, when it's written among its slices.
  const slices = readdirSync(dir).filter((name) => extname(name) === '.mp4' && join(dir, name) !== out).map((name) => {
    const file = join(dir, name);
    const loaded = loadRenderSnapshot(file);
    if (loaded.kind === 'none') throw new Error(loaded.reason);
    const { frames } = loaded.snapshot;
    if (JSON.stringify(loaded.snapshot.timeline) !== now) throw new Error(`${name} (frames ${frames.from}–${frames.end - 1}) was rendered on another timeline than the video's now (a retime moves every later bar and cue): render it again`);
    const counted = countVideoFrames(file);
    if (counted !== frames.end - frames.from) throw new Error(`${name} holds ${counted} frames, and its snapshot says ${frames.end - frames.from}`);
    return { file, ...frames };
  }).sort((a, b) => a.from - b.from);
  let reached = 0;
  for (const s of slices) {
    if (s.from !== reached) throw new Error(`${basename(s.file)} starts at frame ${s.from}, but the slices before it reach ${reached}: ${s.from > reached ? 'render the gap' : 'they overlap'}`);
    reached = s.end;
  }
  if (reached !== timeline.durationInFrames) throw new Error(`the slices in ${dir} reach frame ${reached}, short of the video's ${timeline.durationInFrames}`);

  const mix = await renderMasteredMix(session);
  const tmp = mkdtempSync(join(tmpdir(), 'join-'));
  const list = join(tmp, 'slices.txt');
  writeFileSync(list, slices.map((s) => `file '${s.file.replaceAll("'", "'\\''")}'`).join('\n'));
  mkdirSync(dirname(out), { recursive: true });
  // The mix is padded past the picture and cut half a frame after it, so the last frame keeps its sound.
  runFfmpeg(['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', mix, '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', ...DELIVERY_AUDIO_CODEC, '-af', 'apad',
    '-t', String((timeline.durationInFrames + 0.5) / timeline.fps), '-movflags', '+faststart', out]);
  rmSync(tmp, { recursive: true, force: true });
  const counted = countVideoFrames(out);
  if (counted !== timeline.durationInFrames) throw new Error(`${out} holds ${counted} frames, not the video's ${timeline.durationInFrames}`);
  writeRenderSnapshot(out, { frames: { from: 0, end: timeline.durationInFrames }, timeline });
  return out;
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
    const { stderr } = measureWithFfmpeg(['-i', fresh.get(f)!.fileFor(f), '-i', replay.fileFor(i), '-lavfi', 'psnr', '-f', 'null', '-']);
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
