// storyboard-page.ts: the storyboard page for a project, made from the video itself so it can't drift from it.
// `studio storyboard` runs it and writes out/storyboard/index.html.
//
// A small preview of the whole video on top; below it, a card per scene with its `note` and its stills. Clicking a
// card plays from that scene, and the card lights up while its scene plays. A voiced video gets a still per line, with
// the line's words and its audio. A video cut to music gets one on each moment its timeline.ts names (a cue, a replay
// landing, a landmark), captioned in the timeline's words, so a pacing note reads back onto the line it changes; its
// preview plays the music. Before the motion pass the video is an animatic: rough scenes at their real timing.
import { copyFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRenderSession } from './render-session.ts';
import type { TimelineReport } from '../../studio/Video.tsx';
import { timelineSceneMoments, type TimelineMoment } from '../../models/timeline/scene-moments.ts';
import type { Timeline } from '../../models/timeline/timeline.ts';
import { readProjectTimeline } from '../timeline/project-clock.ts';
import { isVoicedWithDraft } from '../voice/voice-project.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** Builds the storyboard page for `project` and returns the path of its index.html. */
export async function buildStoryboardPage(project: string): Promise<string> {
  // Built beside the published page and swapped in at the end, so a failed rebuild leaves the last good one in place.
  const published = join(project, 'out', 'storyboard');
  const outDir = `${published}.building`;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const session = await openRenderSession(project);
  const timeline = await session.readTimeline();
  const { fps } = timeline;
  const lastFrame = (await session.compositionFor(session.props())).durationInFrames - 1;
  const timed = await readProjectTimeline(project);
  const shots = timed?.audio.some((placed) => placed.kind === 'music')
    ? musicShots(timeline, timed, lastFrame)
    : voicedShots(project, timeline, lastFrame);
  const stills = await session.renderStills(shots.flatMap((s) => s.moments.map((m) => m.frame)), { w: 640 });
  for (const { moments } of shots) for (const m of moments) copyFileSync(stills.fileFor(m.frame), join(outDir, `${m.frame}.jpg`));
  rmSync(stills.dir, { recursive: true, force: true });

  console.error('rendering the preview…');
  await session.renderVideo({
    out: join(outDir, 'preview.mp4'), inputProps: session.props({ captions: true }), timeline,
    scale: 0.5, crf: 30, x264Preset: 'veryfast', imageFormat: 'jpeg', jpegQuality: 80,
  });

  const cards = shots.map(({ scene, timing, moments }, i) => `
    <section class="scene" data-start="${scene.start}" data-end="${scene.start + scene.dur}">
      <h2><span class="n">${i + 1}</span> ${esc(scene.id)} <span class="t">${clock(scene.start)} · ${scene.dur.toFixed(1)}s${timing ? ` · ${esc(timing)}` : ''}</span></h2>
      ${scene.note ? `<p class="note">${esc(scene.note)}</p>` : ''}
      <div class="shots">${moments.map((m) => `
        <figure data-t="${m.frame / fps}">
          <img src="${m.frame}.jpg" loading="lazy">
          ${m.caption ? `<figcaption>${m.caption}</figcaption>` : ''}
        </figure>`).join('')}
      </div>
    </section>`).join('');

  writeFileSync(join(outDir, 'index.html'), storyboardHtml(timeline, isVoicedWithDraft(project), cards));
  rmSync(published, { recursive: true, force: true });
  renameSync(outDir, published);
  return join(published, 'index.html');
}

/** A scene's card: its stills' frames, each with its caption's HTML, and a line of its timing for the heading. */
type StoryboardShots = { scene: TimelineReport['scenes'][number]; timing?: string; moments: { frame: number; caption?: string }[] };

/** A still per line, from the middle of its words; a scene without lines gets one from its middle. */
function voicedShots(project: string, timeline: TimelineReport, lastFrame: number): StoryboardShots[] {
  const voiced: Record<string, { src: string | null }> = JSON.parse(readFileSync(join(project, 'audio', 'manifest.json'), 'utf8'));
  return timeline.scenes.map((scene) => {
    const lines = timeline.cues.filter((c) => scene.lines.includes(c.id));
    const moments = lines.length ? lines.map((line) => ({ line, t: (line.start + line.end) / 2 })) : [{ line: null, t: scene.start + scene.dur / 2 }];
    return {
      scene,
      moments: moments.map(({ line, t }) => ({
        frame: Math.min(Math.round(t * timeline.fps), lastFrame),
        caption: line ? `<code>${esc(line.id)}</code>${line.voiced ? '' : ' <em>estimated</em>'}<q>${esc(line.text)}</q>${
          voiced[line.id]?.src ? `<audio controls preload="none" src="../../${voiced[line.id].src}"></audio>` : ''}` : undefined,
      })),
    };
  });
}

/**
 * A still on each frame the timeline names in a scene, its moments captioned together (the scene's own first, the
 * replays landing there counted); a scene that names none gets one from its middle.
 */
function musicShots(report: TimelineReport, timeline: Timeline, lastFrame: number): StoryboardShots[] {
  const scenes = timelineSceneMoments(timeline);
  return report.scenes.map((scene) => {
    const timed = scenes.find((s) => s.id === scene.id);
    if (!timed) throw new Error(`the video's scene ${scene.id} isn't in timeline.ts: bind the video with bindTimeline`);
    const frames = [...new Set(timed.moments.map((m) => m.frame))];
    const timing = timed.driver === 'beat'
      ? `${timed.beats} beats${timed.musicBeat !== null && timed.musicBeat !== 1 ? `, in on the music's beat ${timed.musicBeat}` : ''}`
      : timed.driver;
    if (!frames.length) return { scene, timing, moments: [{ frame: Math.min(Math.round((timed.from + timed.to) / 2), lastFrame) }] };
    return {
      scene, timing,
      moments: frames.map((frame) => ({ frame: Math.min(frame, lastFrame), caption: momentsCaption(timed.moments.filter((m) => m.frame === frame)) })),
    };
  });
}

function momentsCaption(moments: readonly TimelineMoment[]): string {
  const rank = { landmark: 0, cue: 1, line: 2, replay: 3 };
  const own = moments.filter((m) => m.kind !== 'replay').sort((a, b) => rank[a.kind] - rank[b.kind]);
  const replays = moments.filter((m) => m.kind === 'replay');
  const named = own.map((m) => `<span class="${m.kind}">${m.kind}</span> <b>${esc(m.name)}</b> <code>${esc(m.at)}</code>`);
  const replayed = replays.length
    ? [`<span class="replay">${replays.length === 1 ? 'replay' : `${replays.length} replays`}</span> <code>${esc(replays.map((m) => m.at.split(' on ')[0]).join(', '))}</code>`]
    : [];
  return [...named, ...replayed].map((row) => `<span class="moment">${row}</span>`).join('');
}

function storyboardHtml(timeline: TimelineReport, draft: boolean, cards: string) {
  return `<!doctype html>
<meta charset="utf-8">
<title>${draft ? 'DRAFT VOICE · ' : ''}Storyboard · ${esc(timeline.title)}</title>
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
  .moment { display: block; }
  .moment b { font-weight: 600; }
  .cue, .replay, .landmark, .line { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .cue { color: #b8860b; } .replay { color: #1f7a8c; } .landmark { color: #c0392b; } .line { color: #2e7d32; }
</style>
<header>
  <div><h1>${esc(timeline.title)}</h1><p>${timeline.scenes.length} scenes · ${clock(timeline.duration)} · click a scene to play from it</p>${draft ? '<p><strong>DRAFT VOICE</strong>: read by macOS say, for timing only.</p>' : ''}</div>
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
`;
}
