// render-pipeline.ts: what the render commands do with a bundled project (lib/output/render/engine/render-session.ts): the framing check,
// contact sheets and motion graphs, the mastered mix, the delivered videos and their review, and the repeatability proof.
// A silent project (project.ts's capability) has no mix: its videos deliver with no audio track. A transparent one
// (VideoFormat.transparent) delivers as WebM and HEVC with alpha instead of MP4.
//
// Progress goes to stderr; each function returns what it made, for the command to print on stdout.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { rasterizeSvgs } from '#lib/platform/raster/engine/html-raster.ts';
import { framingProblems, takeFitWarnings } from '#lib/output/picture-checks/models/framing-check.ts';
import { framingArtifactName, type FramingReport } from '#lib/picture/measurement/models/framing-marks.ts';
import { holdProblems } from '#lib/output/picture-checks/models/hold-check.ts';
import { buildMotionGraph, motionGraphBackdropFrame, type MotionGraphSpace } from '#lib/output/picture-checks/models/motion-graph.ts';
import { assembleMotionTracks, formatMotionReport, motionArtifactName, type FrameMotion, type MotionTracks } from '#lib/picture/measurement/models/motion-tracks.ts';
import { measureLoudness } from '#lib/platform/ffmpeg/engine/loudness.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { artifactSink, DELIVERY_AUDIO_CODEC, formatRenderPasses, TIMELINE_REPORT_NAME, type RenderSession } from './render-session.ts';
import { loadRenderSnapshot, renderSnapshotPath, writeRenderSnapshot } from './render-snapshot.ts';
import { sfxEventsFrom, type SfxEvent } from '#lib/output/sfx-cues/models/cue-events.ts';
import { sfxMarkArtifactName, type SfxMark } from '#lib/timing/sound/models/sfx-marks.ts';
import { sfxCueListReport } from '#lib/output/sfx-cues/engine/project-cue-list.ts';
import { readSfxCueList } from '#lib/output/sfx-cues/engine/cue-module.ts';
import { renderVoiceOf } from '#lib/timing/voice/engine/voice-project.ts';
import type { OnArtifact } from '@remotion/renderer';
import type { VideoProps } from '#lib/picture/video/models/composition-props.ts';
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import { countVideoFrames, measureWithFfmpeg, runFfmpeg, runFfprobe } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';

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
 * lib/output/picture-checks/models/framing-check.ts), then strained take fits, which don't fail it, then what motion it tracked (see
 * lib/picture/measurement/models/motion-tracks.ts), whose instrumentation errors do.
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
 * Writes out/check/timeline.json (when each scene, line and word lands, and where scenes crossfade) and the motion
 * tracks: out/check/motion.json, or a scoped check's beside it (motion-<scene>.json), so it never replaces the whole
 * one. Returns both paths. They're the latest check's; a render's own timeline and motion are in its snapshot.
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
 * Measures the motion of `at` (seconds) and draws it (see lib/output/picture-checks/models/motion-graph.ts) over one of its frames, as a PNG
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
 * Masters the soundtrack to out/mix.wav: one gain to delivery loudness, then a limiter for the peaks. Not loudnorm:
 * when its linear mode can't reach the target it becomes an AGC, which fills in the music's ducks.
 * `auditionSfxCueList` plays the cue list into out/mix-sfx-cues.wav too. `timeline`, the caller's report (a browser
 * pass to read), says whether it's a beat-click draft.
 */
export async function renderMasteredMix(session: RenderSession, { timeline, auditionSfxCueList = false }: { timeline: TimelineReport; auditionSfxCueList?: boolean }): Promise<string> {
  if (session.silent) throw new Error(`${basename(session.project)} is silent (project.ts): it plays no voice, music or sound, so it has no mix`);
  return withStudioTemp('mix', async (tmp) => {
    const raw = await session.renderAudio({ out: join(tmp, 'raw.wav'), inputProps: session.props({ auditionSfxCueList }) });
    return masterMix(session, raw, masterWavFor(session, auditionSfxCueList), { beatClicks: timeline.beatClicks });
  });
}

/**
 * Masters `raw`, the video's sound as rendered, to `masterWav` (see renderMasteredMix). A draft of `beatClicks` gains
 * only to the peak ceiling: sparse clicks reach delivery loudness only by the limiter crushing each one.
 */
function masterMix(session: RenderSession, raw: string, masterWav: string, { beatClicks }: { beatClicks: boolean }): string {
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
    let gain = beatClicks ? MASTER_TRUE_PEAK - before.truePeak : DELIVERY_LUFS - before.lufs, ceiling = MASTER_TRUE_PEAK, encodedPeak = Infinity;
    // AAC overshoots sharp transients by more than MASTER_TRUE_PEAK's 1 dB allows (a tattoo needle's bite came out 2.3 dB
    // over its master), so the ceiling comes down by what the encoded master still peaks over delivery's.
    for (let pass = 0; pass < 4 && encodedPeak > DELIVERY_TRUE_PEAK; pass++) {
      if (pass > 0) ceiling -= encodedPeak - DELIVERY_TRUE_PEAK + 0.2;
      master(gain, ceiling);
      // The limiter shaves a little loudness off the peaks it catches, so a second pass makes that back.
      if (!beatClicks) {
        gain += DELIVERY_LUFS - measureLoudness(masterWav).lufs;
        master(gain, ceiling);
      }
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
    // A draft of beat clicks is mastered to its peaks alone (see masterMix).
    if (!timeline.beatClicks && Math.abs(lufs - DELIVERY_LUFS) > 1) problems.push(`measures ${lufs} LUFS, not ${DELIVERY_LUFS} ± 1`);
    if (truePeak > DELIVERY_TRUE_PEAK) problems.push(`peaks at ${truePeak} dBTP, over ${DELIVERY_TRUE_PEAK}`);
    sound = `${lufs} LUFS${timeline.beatClicks ? ' (beat clicks, a draft)' : ''}, ${truePeak} dBTP`;
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

const draftVoiceWarning = (session: RenderSession) => `
!!!! DRAFT VOICE: macOS say read this video (studio voice --read=draft). It's for timing, not for sharing.
!!!! Voice it for real first: studio voice ${basename(session.project)}
`;

const beatClicksWarning = (session: RenderSession) => `
!!!! DRAFT CLICKS: this video is cut to a tempo grid and plays no music yet, so a click marks each beat. It's for timing.
!!!! Give it its track: studio music add ${basename(session.project)} <track>, studio music fit --bars, then
!!!! recordedGrid in timeline.ts and \`music: { track }\` in video.tsx
`;

/**
 * The whole pipeline: video.mp4 with captions, delivered only if its framing check passes; the mastered mix;
 * video-plain.mp4 if `plain`; each checked for delivery; video.srt and video.vtt. Returns what it delivered.
 * `onDraft` gets each draft's warning (a draft voice, beat clicks) at the start and the end.
 *
 * The check rides on the captioned render so every frame is drawn once.
 */
export async function renderDeliveredVideo(session: RenderSession, { plain, onDraft }: { plain: boolean; onDraft: (warning: string) => void }): Promise<string[]> {
  const timeline = await session.readTimeline();
  const estimated = timeline.cues.filter((q) => !q.voiced).map((q) => q.id);
  if (estimated.length) throw new Error(`${estimated.join(', ')} ${estimated.length > 1 ? 'are' : 'is'} estimated, not voiced: run studio voice <project> before rendering the video`);
  const drafts = [renderVoiceOf(session.project) === 'draft' && draftVoiceWarning(session), timeline.beatClicks && beatClicksWarning(session)].filter((w) => w !== false);
  drafts.forEach(onDraft);
  if (timeline.transparent) return renderTransparentDelivery(session, timeline, { plain });
  // An old plain video would no longer match the captioned one beside it.
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
      delivery = { soundtrack: deliveredSoundtrack(session, sound, timeline), motion: approveCheckedRender(session, sink, timeline).motion };
      return delivery;
    },
  });
  await session.timed('video.mp4 review', () => reviewDelivery(session, true, timeline));
  if (plain) {
    await renderDeliveryVideo(session, { out: videoFor(session, false), inputProps: session.props(), timeline, approve: async () => delivery! });
    await session.timed('video-plain.mp4 review', () => reviewDelivery(session, false, timeline));
  }
  const sidecars = writeCaptionSidecars(session, timeline);
  const variants = plain ? [true, false] : [true];
  const delivered = [...variants.map((captions) => videoFor(session, captions)), ...sidecars];
  for (const line of formatRenderPasses(session)) console.error(line);
  // Again at the end, where they can't scroll away under the render's progress.
  drafts.forEach(onDraft);
  return delivered;
}

/** out/video.srt and out/video.vtt from the timeline report, or neither for a video with nothing to caption. */
function writeCaptionSidecars(session: RenderSession, timeline: TimelineReport): string[] {
  const files = { srt: join(outDirFor(session), 'video.srt'), vtt: join(outDirFor(session), 'video.vtt') };
  for (const [kind, file] of Object.entries(files) as ['srt' | 'vtt', string][]) {
    if (timeline.captions) writeFileSync(file, timeline.captions[kind]);
    else rmSync(file, { force: true });
  }
  return timeline.captions ? [files.srt, files.vtt] : [];
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
 * drawn, each checked for its alpha, and a caption table's sidecar. It's silent, so it has no mix and no plain cut, and
 * the project must say so, since a sound it plays would be lost.
 */
async function renderTransparentDelivery(session: RenderSession, timeline: TimelineReport, { plain }: { plain: boolean }): Promise<string[]> {
  const name = basename(session.project);
  if (!session.silent) throw new Error(`${name} is transparent (its format), and a transparent video delivers with no sound: declare \`capability: 'silent'\` in project.ts`);
  if (plain) throw new Error(`${name} is transparent and silent, so it has no captions to leave out: drop --plain`);
  // Files of an opaque render would read as this one's.
  for (const old of [videoFor(session, true), videoFor(session, false)]) removeRender(old);
  for (const old of [masterWavFor(session), join(outDirFor(session), 'check', 'review.jpg')]) rmSync(old, { force: true });
  const { webm, mov } = transparentVideosFor(session);
  const sink = artifactSink();
  await session.renderTransparentVideo({
    webm, mov, inputProps: checkedProps(session), timeline, onArtifact: sink.onArtifact, onProgress: renderProgress(webm),
    approve: async () => ({ motion: approveCheckedRender(session, sink, timeline).motion }),
  });
  await session.timed('review', () => reviewTransparentDelivery(session, timeline));
  const delivered = [webm, mov, ...writeCaptionSidecars(session, timeline)];
  for (const line of formatRenderPasses(session)) console.error(line);
  return delivered;
}

/** The delivered videos' soundtrack: `sound`, the captioned render's, mastered to out/mix.wav, or none for a silent project. */
function deliveredSoundtrack(session: RenderSession, sound: string | undefined, timeline: TimelineReport): string | undefined {
  if (!session.silent) return masterMix(session, sound!, masterWavFor(session), { beatClicks: timeline.beatClicks });
  // An old mix would read as this video's.
  rmSync(masterWavFor(session), { force: true });
  console.error('silent (project.ts): no voice, music or sound, so no mix, mastering or loudness review; the video has no audio track');
  return undefined;
}

// ---------- the animatic ----------

/**
 * The whole video at `out` as it plays now, for `studio review`: whatever sound the composition has (none, a tempo
 * guess's clicks, a draft voice, the fitted music), captions on, with no framing check, no mix and no refusal of an
 * estimated line, so a video of blocked scenes can be approved before it's voiced or finished.
 */
export async function renderAnimatic(session: RenderSession, { out }: { out: string }): Promise<string> {
  mkdirSync(dirname(out), { recursive: true });
  const rendered = await session.renderVideo({
    out, inputProps: session.props({ captions: true }), crf: 26, x264Preset: 'veryfast', imageFormat: 'jpeg', jpegQuality: 85, onProgress: renderProgress(out),
  });
  if (renderVoiceOf(session.project) === 'draft') console.error(draftVoiceWarning(session));
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
 * Joins the slices in `dir` at `out`, under a fresh mastered mix, so placed sounds play across the joins. Refuses
 * another timeline, a gap or overlap, or a file short of its snapshot's frames: each puts every later frame off its
 * sound.
 *
 * Negative space: a silent join doesn't check that no sound plays; the delivered render's review does.
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
    const { gpu } = loaded.snapshot;
    const counted = countVideoFrames(file);
    if (counted !== frames.end - frames.from) throw new Error(`${name} holds ${counted} frames, and its snapshot says ${frames.end - frames.from}`);
    return { file, gpu, ...frames };
  }).toSorted((a, b) => a.from - b.from);
  // Each GPU rounds a painted frame its own way, so slices from two would show a seam where they meet.
  const gpus = [...new Set(slices.map((s) => s.gpu))];
  if (gpus.length > 1) throw new Error(`the slices in ${dir} were drawn on ${gpus.length} GPUs (${gpus.join('; ')}): render them all on one machine`);
  let reached = 0;
  for (const s of slices) {
    if (s.from !== reached) throw new Error(`${basename(s.file)} starts at frame ${s.from}, but the slices before it reach ${reached}: ${s.from > reached ? 'render the gap' : 'they overlap'}`);
    reached = s.end;
  }
  if (reached !== timeline.durationInFrames) throw new Error(`the slices in ${dir} reach frame ${reached}, short of the video's ${timeline.durationInFrames}`);

  const mix = session.silent ? undefined : await renderMasteredMix(session, { timeline });
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
  writeRenderSnapshot(out, { frames: { from: 0, end: timeline.durationInFrames }, timeline, clock: session.clock, voice: renderVoiceOf(session.project), gpu: gpus[0] });
  return out;
}

// ---------- repeatability ----------

/**
 * Renders each frame at `times`, then in one tab after others and among neighbours in concurrent tabs: a frame that
 * isn't a pure function of time differs. Equal is over 50 dB PSNR (a GPU rounds each draw apart), from PNGs (JPEG
 * hides a ±1). Times a frame too; keeps each differing frame beside its lone render in out/check/repeatable/.
 */
export async function checkFramesRepeatable(session: RenderSession, times: number[]): Promise<{ ok: boolean; report: string[] }> {
  if (!times.length || times.some((t) => !Number.isFinite(t))) throw new Error('give times in seconds, e.g. 2,8.5');
  const composition = await session.compositionFor(session.props());
  const { fps, durationInFrames } = composition;
  const frames = times.map((t) => Math.round(t * fps));
  const bad = frames.find((f) => !(f >= 0 && f < durationInFrames));
  if (bad !== undefined) throw new Error(`${bad / fps}s is outside the video`);
  const inVideo = (f: number) => f >= 0 && f < durationInFrames;
  let frameMs = 0;
  // Each time's worst render, kept beside its lone one wherever they differ at all, to look at.
  const kept = join(outDirFor(session), 'check', 'repeatable');
  rmSync(kept, { recursive: true, force: true });
  const worst = await withStudioTemp('repeatable', async (dir) => {
    const fresh = new Map<number, Awaited<ReturnType<typeof session.renderStills>>>();
    for (const [i, f] of frames.entries()) fresh.set(f, await session.renderStills(join(dir, `fresh-${i}`), [f], { lossless: true }));
    // A render's tabs each draw every Nth frame, N its worker count, so each time also comes after runs of those.
    const runUpTo = (f: number, every: number) => [3, 2, 1].map((k) => f - k * every).filter((g) => g >= 0);
    const order = [
      ...frames, ...[...frames].reverse(),
      ...frames.flatMap((f) => [Math.min(durationInFrames - 1, f + 7), f, Math.max(0, f - 11), f]),
      ...frames.flatMap((f) => [1, 2, 3].flatMap((every) => [...runUpTo(f, every), f])),
    ];
    // One tab drawing every frame in turn: its time a frame is the frame's cost, its browser's start spread thin.
    const replayStarted = performance.now();
    const replay = await session.renderReplay(join(dir, 'replay'), order);
    frameMs = (performance.now() - replayStarted) / order.length;
    const tabs = Math.max(2, session.workersFor(composition));
    const together = await session.renderStills(join(dir, 'together'), frames.flatMap((f) => [-2, -1, 0, 1, 2].map((d) => f + d)).filter(inVideo), { tabs, lossless: true });
    const worstRender = new Map<number, { db: number; file: string; how: string }>();
    const compare = (f: number, file: string, how: string) => {
      const { stderr } = measureWithFfmpeg(['-i', fresh.get(f)!.fileFor(f), '-i', file, '-lavfi', 'psnr', '-f', 'null', '-']);
      const db = Number(/average:(\S+)/.exec(stderr)![1].replace('inf', 'Infinity'));
      const was = worstRender.get(f);
      if (!was || db < was.db) worstRender.set(f, { db, file, how });
    };
    for (const [i, f] of order.entries()) if (fresh.has(f)) compare(f, replay.fileFor(i), `replay-${i}${i ? `-after-${order[i - 1]}` : ''}`);
    for (const f of frames) compare(f, together.fileFor(f), `among-${tabs}-tabs`);
    for (const [f, { db, file, how }] of worstRender) {
      if (db === Infinity) continue;
      mkdirSync(kept, { recursive: true });
      copyFileSync(fresh.get(f)!.fileFor(f), join(kept, `frame-${f}-alone.png`));
      copyFileSync(file, join(kept, `frame-${f}-${how}.png`));
    }
    return new Map([...worstRender].map(([f, { db }]) => [f, db]));
  });
  const report = frames.map((f) => {
    const db = worst.get(f)!;
    return `  ${db > 50 ? '✓' : '✗'} ${(f / fps).toFixed(2)}s  ${Number.isFinite(db) ? `${db.toFixed(1)} dB at worst` : 'identical'}`;
  });
  report.push(`  lens ${session.lens}: ${Math.round(frameMs)} ms a frame, drawn in one tab`);
  const ok = frames.every((f) => worst.get(f)! > 50);
  report.push(ok ? 'repeatable ✓' : 'not repeatable: something in those frames depends on what the tab drew before, or on the tabs drawing beside it');
  if ([...worst.values()].some((db) => db !== Infinity)) report.push(`  each differing frame, alone and at its worst: ${kept}`);
  return { ok, report };
}
