// new-project.mjs: starts a video project that renders on its first run.
//
//   npm run new -- <slug> --url=https://example.com [--title="Big new thing"]
//
// Writes projects/<yyyy-mm>-<slug>/ with a capture of the URL's home page, a two-line script, and scenes built from
// the kit (a motion title and a glass-card outro). Then: capture, voice, render, and replace the middle with the story.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith('--'));
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const url = flag('url');
if (!slug || !url) {
  console.error('usage: npm run new -- <slug> --url=https://example.com [--title="Big new thing"]');
  process.exit(1);
}
const title = flag('title') || slug.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
const month = new Date().toISOString().slice(0, 7);
const dir = join('projects', `${month}-${slug}`);
if (existsSync(dir)) {
  console.error(`${dir} already exists`);
  process.exit(1);
}

const files = {
  'capture.mjs': `// Photographs every state the ${title} video shows.
//   node ${dir}/capture.mjs
import { openCaptureSession } from '../../lib/capture.mjs';

const session = await openCaptureSession({ project: import.meta.dirname, viewport: { width: 1440, height: 810 } });
const { page, snap } = session;

await page.goto(${JSON.stringify(url)}, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await snap('home', { height: 1600 });

// Each state the story needs: reach it, then snap it with the rects scenes will point at, e.g.
//   await snap('detail', { rects: { button: '.buy', options: ['.option', { all: true }] }, height: 1200 });

await session.close();
`,

  'voiceover.json': `${JSON.stringify({
    voice: 'Callirrhoe',
    lines: [
      { id: 'intro', text: `Here's a quick look at ${title}.` },
      { id: 'outro', text: 'That’s it. Thanks for watching.' },
    ],
  }, null, 2)}\n`,

  'scenes.js': `// The ${title} shot list. Scene times are seconds from each scene's start; \`s.line(id)\` anchors a beat to speech.

const INK = '#1c365e';
const ACCENT = '#b82b2b';

function drawTitle(s) {
  drawMotionTitle(s, { capture: 'home', eyebrow: 'WALKTHROUGH', title: ${JSON.stringify(title)}, accent: ACCENT });
}

function drawOutro(s) {
  const blur = seg(s.t, 0, 1.0);
  drawCapture('home', camTop('home'), { blur: 34 * blur });
  drawWash('22, 40, 70', 0.62 * blur, 0.38 * blur, { x0: 0, x1: W });
  drawGlassCard(seg(s.t, 0.4, 1.3, easeOut) * (1 - seg(s.t, s.dur - 2.8, s.dur - 2.1)), {
    eyebrow: 'IN SHORT',
    points: ['The first takeaway', 'The second takeaway'],
    accent: ACCENT,
    ink: INK,
  });
  drawEndCard(seg(s.t, s.dur - 2.4, s.dur - 1.6), ${JSON.stringify(title)}, { bg: INK });
}

defineScenes([
  { id: 'title', lines: ['intro'], lead: 1.4, tail: 1.0, draw: drawTitle },
  { id: 'outro', lines: ['outro'], lead: 0.6, tail: 3.4, draw: drawOutro },
]);
`,

  'studio.html': `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Studio · ${title}</title>
<style>
  html, body { margin: 0; background: #16181c; color: #ddd; font: 13px -apple-system, system-ui, sans-serif; }
  main { padding: 12px; display: grid; gap: 8px; }
  #out { width: min(100%, 1280px); aspect-ratio: 16 / 9; height: auto; background: #fff; }
  .bar { display: flex; gap: 10px; align-items: center; max-width: 1280px; }
  #scrub { flex: 1; }
  #tt { font-variant-numeric: tabular-nums; min-width: 240px; }
</style>
</head>
<body>
<main>
  <canvas id="out" width="1920" height="1080"></canvas>
  <div class="bar"><input id="scrub" type="range" min="0" max="1" step="0.0333" value="0"><span id="tt">loading…</span></div>
</main>
<script src="captures/index.js"></script>
<script src="audio/manifest.js"></script>
<script src="../../lib/studio/engine.js"></script>
<script src="../../lib/studio/kit.js"></script>
<script src="scenes.js"></script>
</body>
</html>
`,
};

mkdirSync(dir, { recursive: true });
for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
console.log(`${dir}/ is ready. Next:
  node ${dir}/capture.mjs
  npm run tts -- ${dir}
  npm run video -- ${dir}`);
