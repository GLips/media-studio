// render.ts: checks, renders and reviews a project's video with Remotion's renderer.
//
//   The whole thing:
//     npm run video -- projects/<p>          framing check (every frame) → video.mp4 and video-captions.mp4 → video.srt
//                                            → review sheets of the encoded files → out/watch.html
//   Look at it (open the images with an image viewer or the Read tool):
//     node scripts/render.ts projects/<p> --sheet=0.5,4,9 [--cols=3] [--w=640] [--out=out/check/a.jpg]   chosen times
//     node scripts/render.ts projects/<p> --strip=4:5 [--step=0.1]                                       a stretch, for motion
//     Add --captions to either to burn captions in.
//   One step at a time:
//     node scripts/render.ts projects/<p> --check [--every=5]   the framing check alone: highlights under tags/captions.
//                                                               Also writes out/check/timeline.json: when each scene
//                                                               and line lands, for aiming sheets and strips.
//
// Every run bundles just this project (see lib/project-bundle.ts), so the others' missing captures can't break it.
import { bundle } from '@remotion/bundler';
import { serializeSrt } from '@remotion/captions';
import { renderFrames, renderMedia, selectComposition, type OnArtifact } from '@remotion/renderer';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { projectSlug, projectWebpackOverride } from '../lib/project-bundle.ts';
import type { FramingReport } from '../lib/studio/probe.tsx';
import type { TimelineReport, VideoProps } from '../lib/studio/Video.tsx';

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
const videoFor = (captions: boolean) => join(outDir, captions ? 'video-captions.mp4' : 'video.mp4');

const run = (cmd: string, a: string[]) => new Promise<void>((ok, bad) => {
  spawn(cmd, a, { stdio: 'inherit' }).on('close', (code) => (code ? bad(new Error(`${cmd} exited ${code}`)) : ok()));
});

// ---------- bundle ----------

const every = Number(args.every ?? (args.video ? 1 : 5)), step = Number(args.step ?? 0.1);
if (!Number.isInteger(every) || every < 1) throw new Error(`--every must be a whole number of frames, at least 1, not ${args.every}`);
if (!(step > 0 && Number.isFinite(step))) throw new Error(`--step must be a positive number of seconds, not ${args.step}`);

console.log(`bundling ${project}…`);
const serveUrl = await bundle({ entryPoint: resolve('lib/studio/index.ts'), webpackOverride: projectWebpackOverride(project) });
const props = (p: Partial<VideoProps> = {}): VideoProps => ({ captions: false, probe: false, ...p });
const compositionFor = (inputProps: VideoProps) => selectComposition({ serveUrl, id: projectSlug(project), inputProps });

/** Reads the artifacts a render emits, by name. */
function artifactSink() {
  const files = new Map<string, string>();
  const onArtifact: OnArtifact = (a) => { files.set(a.filename, Buffer.from(a.content).toString('utf8')); };
  return { onArtifact, json: <T,>(name: string): T => JSON.parse(files.get(name) ?? (() => { throw new Error(`no ${name} artifact`); })()), files };
}

// ---------- framing check ----------

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const W = 1920, H = 1080;

/**
 * Every highlight marks something the voice is describing, so one hidden under a tag or caption, or cut off by the
 * frame edge, is a shot nobody can follow. Measures every `every`th frame and reports each problem as a stretch of
 * time; `--video` measures every frame. Bounding boxes, not pixels: an overlap is a problem even if the pixels
 * happen to miss.
 */
async function checkFraming(every: number) {
  const inputProps = props({ probe: true });
  const composition = await compositionFor(inputProps);
  const sink = artifactSink();
  const frames = new Set<number>([0]);
  for (let f = 0; f < composition.durationInFrames; f += every) frames.add(f);
  const tmp = mkdtempSync(join(tmpdir(), 'framing-'));
  await renderFrames({
    composition, serveUrl, inputProps, outputDir: tmp, imageFormat: 'none', frames: [...frames].sort((a, b) => a - b),
    onArtifact: sink.onArtifact, onStart: () => {}, onFrameUpdate: () => {},
  });
  rmSync(tmp, { recursive: true, force: true });

  const { fps } = composition;
  type Issue = { frame: number; issue: string; scene?: string; sceneT?: number; rect: string };
  const issues: Issue[] = [];
  for (const f of [...frames].sort((a, b) => a - b)) {
    const { marks } = sink.json<FramingReport>(`framing-${f}.json`);
    const strong = marks.filter((m) => m.strength >= 0.5);
    const tags = strong.filter((m) => m.kind === 'tag'), caption = strong.find((m) => m.kind === 'caption');
    for (const m of strong.filter((mk) => mk.kind === 'subject')) {
      const r = m.rect;
      const found = [
        tags.some((tag) => overlaps(r, tag.rect)) && 'a highlight is under a tag',
        caption && overlaps(r, caption.rect) && 'a highlight is under the caption',
        (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) && 'a highlight runs off the frame',
      ].filter((x): x is string => Boolean(x));
      for (const issue of found) issues.push({ frame: f, issue, scene: m.scene, sceneT: m.sceneT, rect: [r.x, r.y, r.w, r.h].map(Math.round).join(',') });
    }
  }
  const spans: (Issue & { to: number })[] = [];
  for (const i of issues) {
    const last = spans.findLast((s) => s.issue === i.issue && s.scene === i.scene);
    if (last && i.frame - last.to <= every * 1.5) last.to = i.frame;
    else spans.push({ ...i, to: i.frame });
  }
  for (const s of spans) {
    console.log(`  ✗ ${(s.frame / fps).toFixed(1)}–${(s.to / fps).toFixed(1)}s  ${s.issue}  [scene ${s.scene} @ ${s.sceneT?.toFixed(1)}s, highlight at ${s.rect}]`);
  }
  console.log(spans.length ? `framing: ${spans.length} problem${spans.length > 1 ? 's' : ''}` : `framing ✓ (${frames.size} frames)`);
  return { ok: spans.length === 0, timeline: sink.json<TimelineReport>('timeline.json') };
}

// ---------- sheets ----------

/** Renders frames at chosen times, small, and tiles them into one labelled image. */
async function sheet(times: number[], out: string, { cols = 3, w = 640, captions = false } = {}) {
  const inputProps = props({ captions });
  const composition = await compositionFor(inputProps);
  const frameOf = (t: number) => Math.min(composition.durationInFrames - 1, Math.max(0, Math.round(t * composition.fps)));
  const frames = [...new Set(times.map(frameOf))].sort((a, b) => a - b);
  const tmp = mkdtempSync(join(tmpdir(), 'sheet-'));
  await renderFrames({
    composition, serveUrl, inputProps, outputDir: tmp, imageFormat: 'jpeg', jpegQuality: 90, scale: w / W, frames,
    imageSequencePattern: 'f-[frame].[ext]', onStart: () => {}, onFrameUpdate: () => {},
  });
  const files = readdirSync(tmp).filter((f) => /\.jpe?g$/.test(f)).sort();
  if (files.length !== frames.length) throw new Error(`rendered ${files.length} of ${frames.length} sheet frames`);

  // Even sizes: ffmpeg pads JPEG (4:2:0) frames to them anyway, and a mismatch fails the layout.
  const h = 2 * Math.round((w * H) / W / 2), label = 28, rows = Math.ceil(frames.length / cols);
  const cells = frames.map((f, i) => `[${i}:v]scale=${w}:${h},pad=${w}:${h + label}:0:${label}:color=0x222222,` +
    `drawtext=fontfile=/System/Library/Fonts/Helvetica.ttc:text='${(f / composition.fps).toFixed(2)}s':x=8:y=5:fontsize=18:fontcolor=0xeeeeee[c${i}]`);
  const layout = frames.map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * (h + label)}`).join('|');
  const stack = frames.length === 1 ? `[c0]copy[out]` :
    `${frames.map((_, i) => `[c${i}]`).join('')}xstack=inputs=${frames.length}:layout=${layout}:fill=0x222222[out]`;
  mkdirSync(dirname(out), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...files.flatMap((f) => ['-i', join(tmp, f)]),
    '-filter_complex', `${cells.join(';')};${stack}`, '-map', '[out]', '-frames:v', '1', '-q:v', '3', out]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${out}  (${frames.length} frames, ${cols}×${rows})`);
}

// ---------- the videos ----------

async function renderVideo(captions: boolean) {
  const inputProps = props({ captions });
  const composition = await compositionFor(inputProps);
  const out = videoFor(captions);
  mkdirSync(dirname(out), { recursive: true });
  let shown = -1;
  const started = Date.now();
  await renderMedia({
    composition, serveUrl, inputProps, codec: 'h264', outputLocation: out,
    crf: 18, x264Preset: 'slow', pixelFormat: 'yuv420p', audioCodec: 'aac', audioBitrate: '192k',
    imageFormat: 'jpeg', jpegQuality: 94,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== shown) { shown = pct; console.log(`  ${out}: ${pct}%`); }
    },
  });
  console.log(`rendered ${out} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

const srtFrom = (timeline: TimelineReport) =>
  serializeSrt({ lines: timeline.cues.map((q) => [{ text: q.text, startMs: q.start * 1000, endMs: q.end * 1000, timestampMs: null, confidence: 1 }]) });

// Checks the encoded file, not the frames: right length, has sound, and a tiled sheet of it to look at.
async function review(captions: boolean, timeline: TimelineReport) {
  const video = videoFor(captions);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', video]).toString());
  const actual = Number(probe.format.duration);
  const problems = [];
  if (Math.abs(actual - timeline.duration) > 0.1) problems.push(`is ${actual.toFixed(2)}s, the timeline is ${timeline.duration.toFixed(2)}s`);
  if (!probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')) problems.push('has no audio stream');
  if (problems.length) throw new Error(`${video} ${problems.join(' and ')}`);

  const tiles = 16, out = join(outDir, 'check', captions ? 'review-captions.jpg' : 'review.jpg');
  mkdirSync(dirname(out), { recursive: true });
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=${tiles}/${actual},scale=480:-1,tile=4x4`, '-frames:v', '1', out]);
  console.log(`${video}: ${actual.toFixed(2)}s with audio ✓  sheet → ${out}`);
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
  <video id="v" src="video-captions.mp4" controls autoplay></video>
  <nav>
    <a href="#" onclick="v.src='video-captions.mp4';return false">With captions</a>
    <a href="#" onclick="v.src='video.mp4';return false">Without captions</a>
    <a href="video.mp4" download>Download</a>
    <a href="video-captions.mp4" download>Download with captions</a>
    <a href="video.srt" download>Captions (.srt)</a>
  </nav>
</main>
`);
  console.log(`watch → ${page}`);
}

// ---------- dispatch ----------

const captions = Boolean(args.captions);
if (args.video) {
  const { ok, timeline } = await checkFraming(every);
  if (!ok) throw new Error('fix the framing problems above before rendering (look at a stretch with --strip=a:b)');
  const estimated = timeline.cues.filter((q) => !q.voiced).map((q) => q.id);
  if (estimated.length) throw new Error(`${estimated.join(', ')} ${estimated.length > 1 ? 'are' : 'is'} estimated, not voiced: run npm run tts before rendering the video`);
  for (const cap of [false, true]) {
    await renderVideo(cap);
    await review(cap, timeline);
  }
  writeFileSync(join(outDir, 'video.srt'), srtFrom(timeline));
  writeWatchPage(timeline.title);
} else if (args.sheet || args.strip) {
  let times: number[];
  if (args.strip) {
    const [a, b] = String(args.strip).split(':').map(Number);
    times = [];
    for (let t = a; t <= b + 1e-6; t += step) times.push(Number(t.toFixed(3)));
  } else times = String(args.sheet).split(',').map(Number);
  await sheet(times, at(typeof args.out === 'string' ? args.out : 'out/check/sheet.jpg'), { cols: Number(args.cols || (args.strip ? 5 : 3)), w: Number(args.w || (args.strip ? 384 : 640)), captions });
} else if (args.check) {
  const { ok, timeline } = await checkFraming(every);
  mkdirSync(join(outDir, 'check'), { recursive: true });
  writeFileSync(join(outDir, 'check', 'timeline.json'), JSON.stringify(timeline, null, 2));
  if (!ok) process.exitCode = 1;
} else {
  console.error('nothing to do: pass --video, --sheet, --strip or --check');
  process.exitCode = 1;
}
