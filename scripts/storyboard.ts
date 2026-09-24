// storyboard.ts: the storyboard page for a project, made from the video itself so it can't drift from it.
//
//   node scripts/storyboard.ts projects/<p>        → out/storyboard/index.html
//
// A small preview of the whole video on top; below it, a card per scene with a still for each line, the line's
// words and its audio, and the scene's `note`. Clicking a card plays from that scene, and the card lights up while
// its scene plays. Before the motion pass, the video is an animatic: one camera and one highlight per scene, timed
// by `tts --estimate`, which is all a storyboard needs.
import { renderMedia } from '@remotion/renderer';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRenderSession } from '../lib/render-session.ts';

const project = process.argv[2];
if (!project || !existsSync(join(project, 'video.tsx'))) {
  console.error('usage: node scripts/storyboard.ts projects/<p>');
  process.exit(1);
}
const outDir = join(project, 'out', 'storyboard');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const session = await openRenderSession(project);
const timeline = await session.readTimeline();
const { fps } = timeline;
const voiced: Record<string, { src: string | null }> = JSON.parse(readFileSync(join(project, 'audio', 'manifest.json'), 'utf8'));

// A still per line, from the middle of its words; a scene without lines gets one from its middle.
const shots = timeline.scenes.map((scene) => {
  const cues = timeline.cues.filter((c) => scene.lines.includes(c.id));
  const moments = cues.length ? cues.map((c) => ({ line: c, t: (c.start + c.end) / 2 })) : [{ line: null, t: scene.start + scene.dur / 2 }];
  return { scene, moments: moments.map((m) => ({ ...m, frame: Math.round(m.t * fps) })) };
});
const stills = await session.renderStills(shots.flatMap((s) => s.moments.map((m) => m.frame)), { w: 640 });
for (const { moments } of shots) for (const m of moments) copyFileSync(stills.fileFor(m.frame), join(outDir, `${m.frame}.jpg`));
rmSync(stills.dir, { recursive: true, force: true });

console.log('rendering the preview…');
const inputProps = session.props({ captions: true });
await renderMedia({
  composition: await session.compositionFor(inputProps), serveUrl: session.serveUrl, inputProps, codec: 'h264',
  outputLocation: join(outDir, 'preview.mp4'), scale: 0.5, crf: 30, x264Preset: 'veryfast', imageFormat: 'jpeg', jpegQuality: 80,
});

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const cards = shots.map(({ scene, moments }, i) => `
  <section class="scene" data-start="${scene.start}" data-end="${scene.start + scene.dur}">
    <h2><span class="n">${i + 1}</span> ${esc(scene.id)} <span class="t">${clock(scene.start)} · ${scene.dur.toFixed(1)}s</span></h2>
    ${scene.note ? `<p class="note">${esc(scene.note)}</p>` : ''}
    <div class="shots">${moments.map((m) => `
      <figure data-t="${m.t}">
        <img src="${m.frame}.jpg" loading="lazy">
        ${m.line ? `<figcaption><code>${esc(m.line.id)}</code>${m.line.voiced ? '' : ' <em>estimated</em>'}<q>${esc(m.line.text)}</q>${
          voiced[m.line.id]?.src ? `<audio controls preload="none" src="../../${voiced[m.line.id].src}"></audio>` : ''}</figcaption>` : ''}
      </figure>`).join('')}
    </div>
  </section>`).join('');

writeFileSync(join(outDir, 'index.html'), `<!doctype html>
<meta charset="utf-8">
<title>Storyboard · ${esc(timeline.title)}</title>
<style>
  body { margin: 0; background: #f6f7f9; color: #191919; font: 15px/1.5 -apple-system, system-ui, sans-serif; }
  header { position: sticky; top: 0; z-index: 1; background: #16181c; padding: 16px 24px; display: flex; gap: 24px; align-items: center; }
  header h1 { color: #fff; font-size: 20px; margin: 0; flex: 1; }
  header p { color: #9aa0a8; margin: 4px 0 0; font-size: 13px; }
  video { width: 400px; border-radius: 8px; background: #000; }
  .scene { scroll-margin-top: 260px; }
  main { max-width: 1320px; margin: 0 auto; padding: 24px; }
  .scene { background: #fff; border: 1px solid #e4e6ea; border-radius: 12px; padding: 16px 20px; margin-bottom: 14px; cursor: pointer; }
  .scene.playing { border-color: #1c365e; box-shadow: 0 0 0 2px #1c365e; }
  .scene h2 { margin: 0; font-size: 17px; display: flex; gap: 10px; align-items: baseline; }
  .n { color: #6b6f76; font-weight: 500; }
  .t { margin-left: auto; color: #6b6f76; font-weight: 500; font-size: 13px; font-variant-numeric: tabular-nums; }
  .note { margin: 4px 0 0; color: #3b3f45; }
  .shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; margin-top: 12px; }
  figure { margin: 0; }
  img { width: 100%; border-radius: 6px; border: 1px solid #e4e6ea; display: block; }
  figcaption { font-size: 14px; margin-top: 6px; }
  figcaption code { font-size: 12px; color: #6b6f76; }
  figcaption em { font-size: 12px; color: #b82b2b; font-style: normal; }
  figcaption q { display: block; margin-top: 2px; }
  audio { width: 100%; height: 30px; margin-top: 4px; }
</style>
<header>
  <div><h1>${esc(timeline.title)}</h1><p>${timeline.scenes.length} scenes · ${clock(timeline.duration)} · click a scene to play from it</p></div>
  <video id="preview" src="preview.mp4" controls></video>
</header>
<main>${cards}</main>
<script>
  const video = document.getElementById('preview');
  const scenes = [...document.querySelectorAll('.scene')];
  scenes.forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('audio')) return;
    const fig = e.target.closest('figure');
    video.currentTime = Number(fig ? fig.dataset.t : el.dataset.start);
    video.play();
  }));
  video.addEventListener('timeupdate', () => {
    for (const el of scenes) el.classList.toggle('playing', video.currentTime >= Number(el.dataset.start) && video.currentTime < Number(el.dataset.end));
  });
</script>
`);
console.log(`storyboard → ${join(outDir, 'index.html')}`);
