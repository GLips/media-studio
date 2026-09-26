// render-pipeline.ts: what the render commands do with a bundled project (lib/engine/render/render-session.ts): the framing check,
// contact sheets and motion graphs, the mastered mix, the delivered videos and their review, and the repeatability proof.
// A silent project (project.ts's capability) has no mix: its videos deliver with no audio track. A transparent one
// (VideoFormat.transparent) delivers as WebM and HEVC with alpha instead of MP4.
//
// Progress goes to stderr; each function returns what it made, for the command to print on stdout.
import { serializeSrt } from '@remotion/captions';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { rasterizeSvgs } from '../capture/html-raster.ts';
import { framingArtifactName, framingProblems, takeFitWarnings, type FramingReport } from '#models/frame/framing-check.ts';
import { holdProblems } from '#models/motion/hold-check.ts';
import { buildMotionGraph, motionGraphBackdropFrame, type MotionGraphSpace } from '#models/motion/motion-graph.ts';
import { assembleMotionTracks, formatMotionReport, motionArtifactName, type FrameMotion, type MotionTracks } from '#models/motion/motion-tracks.ts';
import { measureLoudness } from '../ffmpeg/loudness.ts';
import { withStudioTemp } from '../temp/studio-temp.ts';
import { artifactSink, DELIVERY_AUDIO_CODEC, formatRenderPasses, TIMELINE_REPORT_NAME, type RenderSession } from './render-session.ts';
import { loadRenderSnapshot, renderSnapshotPath, writeRenderSnapshot } from '../snapshot/render-snapshot.ts';
import { sfxEventsFrom, sfxMarkArtifactName, type SfxEvent, type SfxMark } from '#sfx/cue-events.ts';
import { sfxCueListReport } from '#sfx/project-cue-list.ts';
import { readSfxCueList } from '#sfx/cue-module.ts';
import { isVoicedWithDraft } from '../voice/voice-project.ts';
import type { OnArtifact } from '@remotion/renderer';
import type { TimelineReport, VideoProps } from '#studio/composition/Video.tsx';
import { countVideoFrames, measureWithFfmpeg, runFfmpeg, runFfprobe } from '../ffmpeg/ffmpeg.ts';

const outDirFor = (session: RenderSession) => join(session.project, 'out');
const videoFor = (session: RenderSession, captions: boolean) => join(outDirFor(session), captions ? 'video.mp4' : 'video-plain.mp4');
// Named apart, not video.webm and video.mov, so each has a snapshot of its own (render-snapshot.ts names it by basename).
const transparentVideosFor = (session: RenderSession) => ({ webm: join(outDirFor(session), 'video.webm'), mov: join(outDirFor(session), 'video-hevc.mov') });
/** Removes a render that no longer matches the project, and its snapshot. */
const removeRender = (video: string) => { for (const file of [video, renderSnapshotPath(video)]) rmSync(file, { force: true }); };
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
  const inputProps = checkedProps(session);
  const sink = artifactSink();
  // Frame 0 carries the timeline, which says where a scene is.
  await session.measureFrames('check frame 0', [0], inputProps, sink.onArtifact);
  const timeline = sink.json<TimelineReport>(TIMELINE_REPORT_NAME);
  const span = checkedFrames(timeline, scope);
  const frames = Array.from({ length: span.last - span.first + 1 }, (_, i) => span.first + i).filter((f) => f !== 0);
  if (frames.length) await session.measureFrames('check', frames, inputProps, sink.onArtifact);
  return judgeCheckedFrames(session, sink, timeline, span);
}

/** Captions on, so the caption is measured where it would show: a hidden one counts as faded out and covers nothing. */
const checkedProps = (session: RenderSession) => session.props({ probe: true, captions: true });

/** The check of frames `span`, from what a render with checkedProps' probe emitted into `sink`. */
function judgeCheckedFrames(session: RenderSession, sink: ReturnType<typeof artifactSink>, timeline: TimelineReport, span: { first: number; last: number }): ProjectCheck {
  const { fps } = timeline;
  const frames = Array.from({ length: span.last - span.first + 1 }, (_, i) => span.first + i);
  const reports = frames.map((f) => sink.json<FramingReport>(framingArtifactName(f)));
  const sees = timeline.expectations.filter((e) => 'see' in e), holds = timeline.expectations.filter((e) => 'hold' in e);
  const problems = framingProblems(reports, sees, fps, timeline, span);
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
  const href = await withStudioTemp('graph-backdrop', async (dir) => {
    const stills = await session.renderStills(dir, [frame], { w: 1280, captions });
    return `data:image/jpeg;base64,${readFileSync(stills.fileFor(frame)).toString('base64')}`;
  });
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
 * out/mix-sfx-cues.wav, to audition it beside the video's mix. Refuses a silent project, which has no mix, and fails
 * on a mix that renders silent, since a voice, music or sound it plays didn't sound.
 */
export async function renderMasteredMix(session: RenderSession, { auditionSfxCueList = false }: { auditionSfxCueList?: boolean } = {}): Promise<string> {
  if (session.silent) throw new Error(`${basename(session.project)} is silent (project.ts): it plays no voice, music or sound, so it has no mix`);
  return withStudioTemp('mix', async (tmp) => {
    const raw = await session.renderAudio({ out: join(tmp, 'raw.wav'), inputProps: session.props({ auditionSfxCueList }) });
    return masterMix(session, raw, masterWavFor(session, auditionSfxCueList));
  });
}

/** Masters `raw`, the video's sound as rendered, to `masterWav` (see renderMasteredMix). */
function masterMix(session: RenderSession, raw: string, masterWav: string): string {
  const mastering = performance.now();
  mkdirSync(outDirFor(session), { recursive: true });
  const before = measureLoudness(raw);
  if (before.lufs === -Infinity) {
    throw new Error("the mix renders silent: a voice, music or sound the video plays didn't sound. A video with no sound at all declares `capability: 'silent'` in project.ts");
  }
  return withStudioTemp('mastering', (tmp) => {
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
    console.error(`mix: ${before.lufs} LUFS, ${before.truePeak} dBTP → +${gain.toFixed(1)} dB and limited at ${ceiling.toFixed(1)} → ${after.lufs} LUFS, ${after.truePeak} dBTP (${encodedPeak} encoded)`);
    session.passes.push({ pass: 'mastering', seconds: (performance.now() - mastering) / 1000 });
    return masterWav;
  });
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

/**
 * A delivered video, under the mastered mix (see renderDeliveredVideo). A silent one keeps the composition's own
 * sound, which is none, so Remotion writes no audio track: a sound playing in it after all shows up as a track its
 * review refuses. `approve` is session.renderVideo's; the soundtrack is the mix it names.
 */
async function renderDeliveryVideo(session: RenderSession, { out, inputProps, timeline, separateSound = false, onArtifact, approve }: {
  out: string; inputProps: VideoProps; timeline: TimelineReport; separateSound?: boolean; onArtifact?: OnArtifact;
  approve: (rendered: { sound?: string }) => Promise<{ soundtrack?: string; motion: MotionTracks }>;
}) {
  await session.renderVideo({
    out, inputProps, muted: !session.silent && !separateSound, separateSound, timeline, approve, ...(onArtifact && { onArtifact }),
    crf: 18, x264Preset: 'slow', pixelFormat: 'yuv420p', imageFormat: 'jpeg', jpegQuality: 94, onProgress: renderProgress(out),
  });
}

const srtFrom = (timeline: TimelineReport) =>
  serializeSrt({ lines: timeline.cues.map((q) => [{ text: q.text, startMs: q.start * 1000, endMs: q.captionEnd * 1000, timestampMs: null, confidence: 1 }]) });

// Checks the delivered file, not the frames: right length, has sound at delivery loudness without clipping (a
// silent project's has no audio track at all), and a tiled sheet of it to look at.
function reviewDelivery(session: RenderSession, captions: boolean, timeline: TimelineReport) {
  const video = videoFor(session, captions);
  const probe = JSON.parse(runFfprobe(['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', video]).toString());
  const actual = Number(probe.format.duration);
  const hasAudio = probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio');
  const problems = [];
  if (Math.abs(actual - timeline.duration) > 0.1) problems.push(`is ${actual.toFixed(2)}s, the timeline is ${timeline.duration.toFixed(2)}s`);
  let sound = 'no audio track';
  if (session.silent) {
    if (hasAudio) problems.push('has an audio stream, though project.ts declares it silent: a voice, music or sound plays in it');
  } else if (!hasAudio) {
    problems.push('has no audio stream');
  } else {
    const { lufs, truePeak } = measureLoudness(video);
    if (Math.abs(lufs - DELIVERY_LUFS) > 1) problems.push(`measures ${lufs} LUFS, not ${DELIVERY_LUFS} ± 1`);
    if (truePeak > DELIVERY_TRUE_PEAK) problems.push(`peaks at ${truePeak} dBTP, over ${DELIVERY_TRUE_PEAK}`);
    sound = `${lufs} LUFS, ${truePeak} dBTP`;
  }
  if (problems.length) throw new Error(`${video} ${problems.join(' and ')}`);

  const tiles = 16, out = join(outDirFor(session), 'check', captions ? 'review-captions.jpg' : 'review.jpg');
  mkdirSync(dirname(out), { recursive: true });
  // Each tile fits a 480 px square, so a vertical video's sheet is no taller than a landscape one's is wide.
  runFfmpeg(['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=${tiles}/${actual},scale=480:480:force_original_aspect_ratio=decrease:force_divisible_by=2,tile=4x4`, '-frames:v', '1', out]);
  console.error(`${video}: ${actual.toFixed(2)}s, ${sound} ✓  sheet → ${out}`);
}

/**
 * Checks a transparent video's files: right length, no audio track, and an alpha plane that lets the page through
 * somewhere and shows something somewhere, decoded from each file (the VP9 through libvpx, since ffmpeg's own decoder
 * drops its alpha). Then a tiled sheet of the WebM over a checkerboard, so the transparency shows in it.
 */
function reviewTransparentDelivery(session: RenderSession, timeline: TimelineReport) {
  const { webm, mov } = transparentVideosFor(session);
  const lines = [webm, mov].map((video) => {
    const decoder = video === webm ? ['-c:v', 'libvpx-vp9'] : [];
    const probe = JSON.parse(runFfprobe(['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', video]).toString());
    const actual = Number(probe.format.duration);
    const problems = [];
    if (Math.abs(actual - timeline.duration) > 0.1) problems.push(`is ${actual.toFixed(2)}s, the timeline is ${timeline.duration.toFixed(2)}s`);
    if (probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')) problems.push('has an audio stream, though a transparent video is silent');
    const { stderr, status } = measureWithFfmpeg([...decoder, '-i', video, '-vf', 'alphaextract,signalstats,metadata=print', '-f', 'null', '-']);
    const levels = (key: string) => [...stderr.matchAll(new RegExp(`signalstats\\.${key}=(\\d+)`, 'g'))].map((m) => Number(m[1]));
    const [least, most] = [Math.min(...levels('YMIN')), Math.max(...levels('YMAX'))];
    if (status !== 0 || !Number.isFinite(least)) problems.push('has no alpha plane ffmpeg can decode');
    else if (least === 255) problems.push('is opaque in every frame: something paints the whole frame, so the page never shows through');
    else if (most === 0) problems.push('is transparent in every frame: it shows nothing');
    if (problems.length) throw new Error(`${video} ${problems.join(' and ')}`);
    return `${video}: ${actual.toFixed(2)}s, alpha ${least}–${most}, no audio track ✓`;
  });

  const tiles = 16, out = join(outDirFor(session), 'check', 'review-captions.jpg');
  mkdirSync(dirname(out), { recursive: true });
  const checker = `geq=lum='if(mod(floor(X/32)+floor(Y/32),2),204,255)':cb=128:cr=128:a=255`;
  runFfmpeg(['-y', '-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', webm, '-filter_complex',
    `fps=${tiles}/${timeline.duration},format=yuva420p,split[fg][bg];[bg]${checker}[checker];[checker][fg]overlay,scale=480:480:force_original_aspect_ratio=decrease:force_divisible_by=2,tile=4x4`,
    '-frames:v', '1', out]);
  for (const line of lines) console.error(line);
  console.error(`  sheet → ${out}`);
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
  <video id="v" src="video.mp4" controls autoplay${session.silent ? ' muted' : ''}></video>${session.silent ? `
  <p>A silent video: it has no sound.</p>` : ''}
  <nav>
    <a href="video.mp4" download>Download</a>${existsSync(videoFor(session, false)) ? `
    <a href="#" onclick="v.src='video-plain.mp4';return false">Without captions</a>
    <a href="video-plain.mp4" download>Download without captions</a>` : ''}
${session.silent ? '' : `    <a href="video.srt" download>Captions (.srt)</a>
`}  </nav>
</main>
`);
  return page;
}

/**
 * A transparent video's page: the video over a checkerboard, or over a colour to try it on. Safari takes the HEVC,
 * typed video/quicktime so Chrome, which plays HEVC but not its alpha, passes it by for the WebM.
 */
function writeTransparentWatchPage(session: RenderSession, title: string) {
  const page = join(outDirFor(session), 'watch.html');
  const { webm, mov } = transparentVideosFor(session);
  const grounds = [['Checkerboard', 'checker'], ['Coral', '#ff6f59'], ['Navy', '#1d2b53'], ['White', '#fff'], ['Black', '#000']];
  writeFileSync(page, `<!doctype html>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body { margin: 0; background: #16181c; color: #ddd; font: 15px -apple-system, system-ui, sans-serif; }
  main { max-width: 1280px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 22px; margin: 0 0 16px; }
  #stage { border-radius: 10px; overflow: hidden; line-height: 0; }
  #stage.checker { background: repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 32px 32px; }
  video { width: 100%; }
  nav { display: flex; flex-wrap: wrap; gap: 16px; margin: 14px 0 0; }
  a { color: #8fb4ff; }
</style>
<main>
  <h1>${title}</h1>
  <div id="stage" class="checker">
    <video id="v" controls autoplay loop muted playsinline>
      <source src="${basename(mov)}" type="video/quicktime">
      <source src="${basename(webm)}" type="video/webm">
    </video>
  </div>
  <p>A transparent video: it plays over the page behind it. <span id="playing"></span></p>
  <nav>
${grounds.map(([name, ground]) => `    <a href="#" onclick="stage.className='${ground === 'checker' ? 'checker' : ''}';stage.style.background='${ground === 'checker' ? '' : ground}';return false">${name}</a>`).join('\n')}
    <a href="${basename(webm)}" download>Download WebM (Chrome, Firefox)</a>
    <a href="${basename(mov)}" download>Download HEVC .mov (Safari)</a>
  </nav>
</main>
<script>v.addEventListener('loadedmetadata', () => { playing.textContent = 'Playing ' + v.currentSrc.split('/').pop() + '.'; });</script>
`);
  return page;
}

const draftVoiceWarning = (session: RenderSession) => `
!!!! DRAFT VOICE: macOS say read this video (studio voice --read=draft). It's for timing, not for sharing.
!!!! Voice it for real first: studio voice ${basename(session.project)}
`;

/**
 * The whole pipeline: refusing a line that's still estimated; video.mp4 with captions, whose frames the framing check
 * measures as they're drawn, delivered only if it passes; the mastered mix under it; video-plain.mp4 without
 * captions, if `plain`; each checked for delivery; video.srt; out/watch.html; and where the time went. A silent
 * project has no mix and no .srt; a transparent one delivers as renderTransparentDelivery says. Returns what it
 * delivered.
 *
 * The check rides on the captioned render rather than running first, so every frame is drawn once, not twice: a
 * failing check costs a render's encode more than it would alone, and `studio check` is still the quick way to one.
 */
export async function renderDeliveredVideo(session: RenderSession, { plain }: { plain: boolean }): Promise<string[]> {
  const timeline = await session.readTimeline();
  const estimated = timeline.cues.filter((q) => !q.voiced).map((q) => q.id);
  if (estimated.length) throw new Error(`${estimated.join(', ')} ${estimated.length > 1 ? 'are' : 'is'} estimated, not voiced: run studio voice <project> before rendering the video`);
  const draft = isVoicedWithDraft(session.project);
  if (draft) console.error(draftVoiceWarning(session));
  if (timeline.transparent) return renderTransparentDelivery(session, timeline, { plain });
  // An old plain video would no longer match; the watch page offers it only if it's there.
  if (!plain) removeRender(videoFor(session, false));
  for (const old of Object.values(transparentVideosFor(session))) removeRender(old);

  // The probe lets a video that plays its cue list render without one (a check measures the events it's drafted
  // from), so the refusal the unprobed composition makes is made here.
  if (timeline.sfxCueList && !readSfxCueList(session.project)) throw new Error('this project has no sfx/cues.json: run studio sfx draft first');

  const sink = artifactSink();
  let delivery: { soundtrack?: string; motion: MotionTracks } | undefined;
  await renderDeliveryVideo(session, {
    out: videoFor(session, true), inputProps: checkedProps(session), timeline, separateSound: !session.silent, onArtifact: sink.onArtifact,
    approve: async ({ sound }) => {
      delivery = { soundtrack: deliveredSoundtrack(session, sound), motion: approveCheckedRender(session, sink, timeline).motion };
      return delivery;
    },
  });
  await session.timed('video.mp4 review', () => reviewDelivery(session, true, timeline));
  if (plain) {
    await renderDeliveryVideo(session, { out: videoFor(session, false), inputProps: session.props(), timeline, approve: async () => delivery! });
    await session.timed('video-plain.mp4 review', () => reviewDelivery(session, false, timeline));
  }
  // A silent video speaks no lines, so it has no captions.
  const srt = join(outDirFor(session), 'video.srt');
  if (session.silent) rmSync(srt, { force: true });
  else writeFileSync(srt, srtFrom(timeline));
  const variants = plain ? [true, false] : [true];
  const delivered = [...variants.map((captions) => videoFor(session, captions)), ...(session.silent ? [] : [srt]), writeWatchPage(session, timeline.title, draft)];
  for (const line of formatRenderPasses(session)) console.error(line);
  // Again at the end, where it can't scroll away under the render's progress.
  if (draft) console.error(draftVoiceWarning(session));
  return delivered;
}

/**
 * The framing check of a delivery render, from the artifacts its probe emitted into `sink`: printed, written to
 * out/check/, and refused on a problem.
 */
function approveCheckedRender(session: RenderSession, sink: ReturnType<typeof artifactSink>, timeline: TimelineReport): ProjectCheck {
  const check = judgeCheckedFrames(session, sink, timeline, checkedFrames(timeline, {}));
  for (const line of check.report) console.error(line);
  writeCheckReports(session, check);
  if (!check.ok) throw new Error('fix the problems above before rendering (look at a stretch with studio look <project> --strip=a:b)');
  return check;
}

/**
 * A transparent video's delivery: video.webm and video-hevc.mov, whose frames the framing check measures as they're
 * drawn, each checked for its alpha, and the watch page. It's silent, so it has no mix, no .srt and no plain cut, and
 * the project must say so, since a sound it plays would be lost.
 */
async function renderTransparentDelivery(session: RenderSession, timeline: TimelineReport, { plain }: { plain: boolean }): Promise<string[]> {
  const name = basename(session.project);
  if (!session.silent) throw new Error(`${name} is transparent (its format), and a transparent video delivers with no sound: declare \`capability: 'silent'\` in project.ts`);
  if (plain) throw new Error(`${name} is transparent and silent, so it has no captions to leave out: drop --plain`);
  // Files of an opaque render would read as this one's.
  for (const old of [videoFor(session, true), videoFor(session, false)]) removeRender(old);
  for (const old of [masterWavFor(session), join(outDirFor(session), 'video.srt'), join(outDirFor(session), 'check', 'review.jpg')]) rmSync(old, { force: true });
  const { webm, mov } = transparentVideosFor(session);
  const sink = artifactSink();
  await session.renderTransparentVideo({
    webm, mov, inputProps: checkedProps(session), timeline, onArtifact: sink.onArtifact, onProgress: renderProgress(webm),
    approve: async () => ({ motion: approveCheckedRender(session, sink, timeline).motion }),
  });
  await session.timed('review', () => reviewTransparentDelivery(session, timeline));
  const delivered = [webm, mov, writeTransparentWatchPage(session, timeline.title)];
  for (const line of formatRenderPasses(session)) console.error(line);
  return delivered;
}

/** The delivered videos' soundtrack: `sound`, the captioned render's, mastered to out/mix.wav, or none for a silent project. */
function deliveredSoundtrack(session: RenderSession, sound: string | undefined): string | undefined {
  if (!session.silent) return masterMix(session, sound!, masterWavFor(session));
  // An old mix would read as this video's.
  rmSync(masterWavFor(session), { force: true });
  console.error('silent (project.ts): no voice, music or sound, so no mix, mastering or loudness review; the video has no audio track');
  return undefined;
}

// ---------- the animatic ----------

/**
 * The whole video at `out` as it plays now, for `studio review`: whatever sound the composition has (none, a tempo
 * guess's silence, a draft voice, the fitted music), captions on, with no framing check, no mix and no refusal of an
 * estimated line, so a video of blocked scenes can be approved before it's voiced or finished.
 */
export async function renderAnimatic(session: RenderSession, { out }: { out: string }): Promise<string> {
  mkdirSync(dirname(out), { recursive: true });
  const rendered = await session.renderVideo({
    out, inputProps: session.props({ captions: true }), crf: 26, x264Preset: 'veryfast', imageFormat: 'jpeg', jpegQuality: 85, onProgress: renderProgress(out),
  });
  if (isVoicedWithDraft(session.project)) console.error(draftVoiceWarning(session));
  return rendered;
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
 *
 * Negative space: a silent project's join has no sound and doesn't check that none plays, since its slices are
 * muted; the delivered render's review is what refuses a sound in a silent project.
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

  const mix = session.silent ? undefined : await renderMasteredMix(session);
  mkdirSync(dirname(out), { recursive: true });
  withStudioTemp('join', (tmp) => {
    const list = join(tmp, 'slices.txt');
    writeFileSync(list, slices.map((s) => `file '${s.file.replaceAll("'", "'\\''")}'`).join('\n'));
    // The mix is padded past the picture and cut half a frame after it, so the last frame keeps its sound.
    const sound = mix ? ['-i', mix, '-map', '0:v', '-map', '1:a', ...DELIVERY_AUDIO_CODEC, '-af', 'apad'] : ['-map', '0:v'];
    runFfmpeg(['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, ...sound,
      '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p',
      '-t', String((timeline.durationInFrames + 0.5) / timeline.fps), '-movflags', '+faststart', out]);
  });
  const counted = countVideoFrames(out);
  if (counted !== timeline.durationInFrames) throw new Error(`${out} holds ${counted} frames, not the video's ${timeline.durationInFrames}`);
  writeRenderSnapshot(out, { frames: { from: 0, end: timeline.durationInFrames }, timeline, clock: session.clock });
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
  const worst = await withStudioTemp('repeatable', async (dir) => {
    const fresh = new Map<number, Awaited<ReturnType<typeof session.renderStills>>>();
    for (const [i, f] of frames.entries()) fresh.set(f, await session.renderStills(join(dir, `fresh-${i}`), [f]));
    const order = [
      ...frames, ...[...frames].reverse(),
      ...frames.flatMap((f) => [Math.min(durationInFrames - 1, f + 7), f, Math.max(0, f - 11), f]),
    ];
    const replay = await session.renderReplay(join(dir, 'replay'), order);
    const worst = new Map<number, number>();
    for (const [i, f] of order.entries()) {
      if (!fresh.has(f)) continue;
      const { stderr } = measureWithFfmpeg(['-i', fresh.get(f)!.fileFor(f), '-i', replay.fileFor(i), '-lavfi', 'psnr', '-f', 'null', '-']);
      const psnr = Number(/average:(\S+)/.exec(stderr)![1].replace('inf', 'Infinity'));
      worst.set(f, Math.min(worst.get(f) ?? Infinity, psnr));
    }
    return worst;
  });
  const report = frames.map((f) => {
    const db = worst.get(f)!;
    return `  ${db > 50 ? '✓' : '✗'} ${(f / fps).toFixed(2)}s  ${Number.isFinite(db) ? `${db.toFixed(1)} dB at worst` : 'identical'}`;
  });
  const ok = frames.every((f) => worst.get(f)! > 50);
  report.push(ok ? 'repeatable ✓' : 'not repeatable: something in those frames depends on what the tab drew before');
  return { ok, report };
}
