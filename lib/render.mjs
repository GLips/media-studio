// render.mjs: renders a project's studio.html in headless Chromium. Adapted from JohnHeibel/ClaudeAnimationBase (MIT).
//
//   The whole thing:
//     node lib/render.mjs <project> --video        frames → both MP4s (plain and captioned) → .srt → review sheets
//                                                  → out/watch.html
//   Look at it (open the images with an image viewer or the Read tool):
//     node lib/render.mjs <project> --sheet=0.5,4,9 [--cols=3] [--w=640] [--out=out/check/a.jpg]   chosen times
//     node lib/render.mjs <project> --strip=4:5 [--step=0.1]                                       a stretch, for motion
//   One step at a time:
//     node lib/render.mjs <project> --frames [--workers=6]   JPEG frames → <project>/out/frames (parallel, resumable)
//     node lib/render.mjs <project> --encode                 frames + the voiced lines → out/video.mp4, and out/video.srt
//     node lib/render.mjs <project> --review                 checks the MP4 and tiles it into out/check/review.jpg
//   Add --captions to a step to burn captions in (frames go to out/frames-captions).
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const project = argv.find((a) => !a.startsWith('--'));
if (!project) {
  console.error('usage: node lib/render.mjs <project dir> --video | --sheet=… | --strip=a:b | --frames | --encode | --review');
  process.exit(1);
}
const args = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const fps = Number(args.fps || 30);
const JPEG_QUALITY = 0.94;
const outDir = join(project, 'out');
const at = (p) => (p.startsWith('/') ? p : join(project, p));
const framesDirFor = (captions) => join(outDir, captions ? 'frames-captions' : 'frames');
const videoFor = (captions) => at(args.out || (captions ? 'out/video-captions.mp4' : 'out/video.mp4'));

const run = (cmd, a) => new Promise((ok, bad) => {
  const p = spawn(cmd, a, { stdio: 'inherit' });
  p.on('close', (code) => (code ? bad(new Error(`${cmd} exited ${code}`)) : ok()));
});

// ---------- frame stamps ----------
// A frame is a pure function of its inputs, so frames are stamped with a hash of all of them. Frames from older
// inputs are wiped before rendering and refused at encode, so a video can never mix old and new frames.

const studioLib = join(dirname(fileURLToPath(import.meta.url)), 'studio');
const filesIn = (dir, keep = () => true) => (existsSync(dir) ? readdirSync(dir).filter(keep).map((f) => join(dir, f)) : []);
function inputsHash() {
  const files = [
    ...filesIn(studioLib),
    join(project, 'studio.html'),
    ...filesIn(project, (f) => f.endsWith('.js')),
    ...filesIn(join(project, 'captures')),
    join(project, 'audio', 'manifest.js'),
  ].sort();
  const h = createHash('sha1').update(`fps=${fps} q=${JPEG_QUALITY}\n`);
  for (const f of files) h.update(f).update(readFileSync(f));
  return h.digest('hex');
}
const stampFile = (dir) => join(dir, '.inputs');
const stampOf = (dir) => (existsSync(stampFile(dir)) ? readFileSync(stampFile(dir), 'utf8') : null);

// ---------- the studio page ----------

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
async function openStudio(captions, tag = '') {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log(`[page${tag}]`, m.text()); });
  page.on('pageerror', (e) => { console.error(`[page error${tag}]`, e.message); process.exitCode = 1; });
  const url = pathToFileURL(resolve(project, 'studio.html')).href + (captions ? '?captions' : '');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.ready === true', null, { timeout: 60000 });
  return page;
}
async function studioInfo() {
  const page = await openStudio(false);
  const info = await page.evaluate(() => window.studioInfo());
  await page.close();
  return info;
}
const decode = (url) => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
const frameName = (i) => `f${String(i).padStart(5, '0')}.jpg`;

// ---------- steps ----------

async function renderFrames(captions) {
  const dir = framesDirFor(captions), stamp = inputsHash();
  if (stampOf(dir) !== stamp) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(stampFile(dir), stamp);

  const { duration } = await studioInfo();
  const total = Math.ceil(duration * fps);
  const todo = [];
  for (let i = 0; i < total; i++) {
    const f = join(dir, frameName(i));
    if (!existsSync(f) || statSync(f).size < 1000) todo.push(i);
  }
  console.log(`${dir}: ${duration.toFixed(2)}s at ${fps}fps, ${todo.length} of ${total} frames to render`);
  let next = 0, done = 0;
  const start = Date.now();
  await Promise.all(Array.from({ length: Number(args.workers || 8) }, async (_, w) => {
    const page = await openStudio(captions, `#${w}`);
    while (next < todo.length) {
      const i = todo[next++], f = join(dir, frameName(i));
      writeFileSync(`${f}.tmp`, decode(await page.evaluate(([t, q]) => window.renderAt(t, 'image/jpeg', q), [i / fps, JPEG_QUALITY])));
      renameSync(`${f}.tmp`, f);
      if (++done % 300 === 0 || done === todo.length) {
        const el = (Date.now() - start) / 1000;
        console.log(`  frame ${done}/${todo.length}  eta ${((todo.length - done) * el / done).toFixed(0)}s`);
      }
    }
  }));
}

const srtTime = (s) => {
  const ms = Math.round(s * 1000), p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

async function encode(captions) {
  const dir = framesDirFor(captions);
  const { duration, audio, captions: cues } = await studioInfo();
  const expected = Math.ceil(duration * fps);
  const frames = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jpg')).length : 0;
  if (stampOf(dir) !== inputsHash() || frames !== expected) {
    throw new Error(`${dir} is stale or incomplete (${frames}/${expected} frames). Run --frames${captions ? ' --captions' : ''} first.`);
  }
  const out = videoFor(captions);
  mkdirSync(dirname(out), { recursive: true });

  // One voice track: every line delayed to its cue, mixed without normalisation so levels stay as voiced.
  const voice = join(outDir, 'voice.wav');
  const inputs = audio.flatMap((cue) => ['-i', at(cue.src)]);
  const delays = audio.map((cue, i) => `[${i}:a]adelay=${Math.round(cue.start * 1000)}:all=1[a${i}]`).join(';');
  const mix = `${delays};${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0,apad=whole_dur=${duration}[v]`;
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', mix, '-map', '[v]', '-ar', '48000', voice]);

  console.log(`encoding ${frames} frames + ${audio.length} voice lines → ${out}`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'f%05d.jpg'), '-i', voice,
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
  rmSync(voice);

  // Sidecar captions, for players and upload sites that show their own instead of burned-in ones.
  const srt = join(outDir, 'video.srt');
  writeFileSync(srt, cues.map((q, i) => `${i + 1}\n${srtTime(q.start)} --> ${srtTime(q.end)}\n${q.text}\n`).join('\n'));
  console.log(`wrote ${out} and ${srt}`);
}

// Checks the encoded file, not the frames: right length, has sound, and a tiled sheet of it to look at.
async function review(captions) {
  const video = videoFor(captions);
  const { duration } = await studioInfo();
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', video]));
  const actual = Number(probe.format.duration);
  const problems = [];
  if (Math.abs(actual - duration) > 0.2) problems.push(`is ${actual.toFixed(2)}s, the timeline is ${duration.toFixed(2)}s`);
  if (!probe.streams.some((s) => s.codec_type === 'audio')) problems.push('has no audio stream');
  if (problems.length) throw new Error(`${video} ${problems.join(' and ')}`);

  const tiles = 16, sheet = join(outDir, 'check', captions ? 'review-captions.jpg' : 'review.jpg');
  mkdirSync(dirname(sheet), { recursive: true });
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=${tiles}/${actual},scale=480:-1,tile=4x4`, '-frames:v', '1', sheet]);
  console.log(`${video}: ${actual.toFixed(2)}s with audio ✓  sheet → ${sheet}`);
}

// ---------- dispatch ----------

// A page to watch the finished videos, since file:// MP4s have no player of their own worth sharing a link to.
function writeWatchPage() {
  const title = readFileSync(join(project, 'studio.html'), 'utf8').match(/<title>Studio · (.*)<\/title>/)?.[1] ?? project;
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

const captions = Boolean(args.captions);
if (args.video) {
  for (const cap of [false, true]) {
    await renderFrames(cap);
    await encode(cap);
    await review(cap);
  }
  writeWatchPage();
} else if (args.sheet || args.strip) {
  const page = await openStudio(captions);
  let times;
  if (args.strip) {
    const [a, b] = String(args.strip).split(':').map(Number), step = Number(args.step || 0.1);
    times = [];
    for (let t = a; t <= b + 1e-6; t += step) times.push(Number(t.toFixed(3)));
  } else times = String(args.sheet).split(',').map(Number);
  const out = at(args.out || 'out/check/sheet.jpg');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, decode(await page.evaluate(([ts, c, w]) => window.renderSheet(ts, c, w), [times, Number(args.cols || 3), Number(args.w || 640)])));
  console.log(`${out}  (${times.length} frames)`);
} else if (args.frames) {
  await renderFrames(captions);
} else if (args.encode) {
  await encode(captions);
} else if (args.review) {
  await review(captions);
} else {
  console.error('nothing to do: pass --video, --sheet, --strip, --frames, --encode or --review');
  process.exitCode = 1;
}
await browser.close();
