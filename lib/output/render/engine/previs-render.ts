// previs-render.ts: `studio gen video`. Renders one previs scene's blockout alone (Video.tsx's BlockoutSolo), sends it
// to the chosen model (PREVIS_MODELS) as the reference video with the scene's stills, and lists what comes back in generated/footage.json
// (lib/footage/previs/engine/previs-footage.ts), so the scene plays it in place of its blockout (lib/footage/previs/studio/previs.tsx).
//
// The blockout is the whole request's content: re-rendering an unchanged scene makes the same MP4 and so the same
// cache key (lib/platform/paid-generation/engine/paid-generation.ts), while a changed subject, move or prompt pays for a new render. Timing never
// should: it's fixed afterwards with the scene's `previs.retime`.
import { renderMedia, selectComposition } from '@remotion/renderer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { generatePaidMedia } from '#lib/platform/paid-generation/engine/paid-generation.ts';
import { readPrevisFootageList, writePrevisFootageEntry } from '#lib/footage/previs/engine/previs-footage.ts';
import { blockoutSlug } from './project-bundle.ts';
import { RENDER_CHROMIUM } from './render-browser.ts';
import type { RenderSession } from './render-session.ts';
import { PREVIS_BLOCKOUT_SHORT_SIDE, PREVIS_MODEL_NAMES, PREVIS_MODELS, previsAspectRatio, previsShotSeconds, type PrevisModelName } from '#lib/footage/previs/models/previs-models.ts';
import { probeMediaSeconds } from '#lib/platform/ffmpeg/engine/ffmpeg.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';

// References are numbered by kind in the order sent, the blockout first. Worded as a new video
// referencing @Video1's camera, never as changing it: as an edit the output must take the input's length and ratio,
// which OpenRouter's schema can't send. Each preamble is in its requests' cache key: rewording one pays again for
// every scene it heads.
const PREVIS_PREAMBLES = {
  '3d': 'Generate a new, photoreal video. Reference @Video1 for its camera movement, framing and timing, and for where each '
    + 'subject stands and how it moves: @Video1 is a grey 3D layout sketch of this shot, where each grey or tinted shape marks a subject '
    + 'described below. The new video shows the real subjects in a real place, in real light and materials, with none of the sketch\'s '
    + 'grid, flat grey shapes or empty backdrop.',
  '2d': 'Generate a new video. Reference @Video1 for its framing and timing, and for where each element sits in the frame and how '
    + 'and when it moves: @Video1 is a flat 2D layout sketch of this shot, where each tinted box, line of placeholder type and crossed '
    + 'image slot marks an element described below, labelled with its name. The new video shows the finished elements as described, '
    + 'with none of the sketch\'s grid, labels, crossed slots or flat placeholder tints.',
} as const;

/**
 * Renders scene `sceneId`'s blockout to generated/blockout-<scene>-<hash>.mp4, run for `model`'s seconds, and,
 * unless `dry`, makes its footage with `model`. Returns the blockout, the footage (null when dry), the request's
 * prompt, what the shot would cost with each model, and whether the footage the scene plays now came from another
 * blockout: it's stale, and plays until this is run without `dry`.
 */
export async function renderPrevisFootage(session: RenderSession, sceneId: string, { model, dry }: { model: PrevisModelName; dry: boolean }) {
  const { project } = session;
  const timeline = await session.readTimeline();
  const scene = timeline.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`no scene "${sceneId}"; the scenes are ${timeline.scenes.map((s) => s.id).join(', ')}`);
  if (!scene.previs) throw new Error(`scene ${sceneId} has no previs: give it a \`previs: { blockout, prompt }\` and render its blockout from it`);
  const previs = scene.previs;
  const chosen = PREVIS_MODELS[model];
  const seconds = previsShotSeconds(model, previs.duration);
  if (seconds === null) throw new Error(`scene ${sceneId} is on screen ${previs.duration}s, longer than ${chosen.label}'s ${chosen.seconds.max}s: split it, or render with a model that runs longer`);
  if (previs.references.length && !chosen.takesStills) throw new Error(`scene ${sceneId} sends stills (previs.references), which ${chosen.label} doesn't take: render it with another model, or drop them`);
  for (const ref of previs.references) if (!existsSync(join(project, ref))) throw new Error(`scene ${sceneId}: reference ${ref} isn't in the project`);

  // Checked before the blockout renders, so a video no model can match stops before any work.
  const aspect = previsAspectRatio(timeline);
  const blockout = await renderBlockout(session, sceneId, seconds);
  const prompt = `${PREVIS_PREAMBLES[previs.blockout]}\n\n${previs.prompt}`;
  const playing = readPrevisFootageList(project)[sceneId];
  const stale = Boolean(playing && playing.blockout !== basename(blockout));
  if (dry) return { blockout, footage: null, prompt, stale, estimates: previsCostEstimates(previs.duration) };

  const [footage] = await generatePaidMedia(project, {
    kind: 'video', model: chosen.id, name: sceneId, prompt,
    params: { duration: seconds, resolution: chosen.resolution, aspect_ratio: aspect, ...(chosen.audioOptional && { generate_audio: previs.audio }) },
    references: [{ path: blockout }, ...previs.references.map((ref) => ({ path: join(project, ref) }))],
  });
  writePrevisFootageEntry(project, sceneId, {
    file: relative(join(project, 'generated'), footage), from: previs.from, duration: mediaSeconds(footage), blockout: basename(blockout), model: chosen.id,
  });
  return { blockout, footage, prompt, stale: false, estimates: [] };
}

/** Each model's length and price for a scene on screen `onScreen` whole seconds, or why it can't render it. */
function previsCostEstimates(onScreen: number): string[] {
  return PREVIS_MODEL_NAMES.map((name) => {
    const { label, usdPerSecond, seconds: { max } } = PREVIS_MODELS[name];
    const seconds = previsShotSeconds(name, onScreen);
    return `${name} (${label}): ${seconds === null ? `can't, it runs at most ${max}s` : `${seconds}s, about $${(seconds * usdPerSecond).toFixed(2)}`}`;
  });
}

async function renderBlockout(session: RenderSession, sceneId: string, seconds: number): Promise<string> {
  const inputProps = { scene: sceneId, seconds };
  return withStudioTemp('blockout', async (tmp) => {
    const rendered = join(tmp, 'blockout.mp4');
    await session.inBrowser('blockout', async (browser) => {
      const composition = await selectComposition({ serveUrl: session.serveUrl, chromiumOptions: RENDER_CHROMIUM, puppeteerInstance: browser, id: blockoutSlug(session.project), inputProps });
      const concurrency = session.workersFor(composition);
      console.error(`rendering scene ${sceneId}'s blockout, ${composition.durationInFrames / composition.fps}s…`);
      await renderMedia({
        composition, serveUrl: session.serveUrl, chromiumOptions: RENDER_CHROMIUM, puppeteerInstance: browser, concurrency, inputProps,
        codec: 'h264', muted: true, crf: 20, pixelFormat: 'yuv420p', scale: PREVIS_BLOCKOUT_SHORT_SIDE / Math.min(composition.width, composition.height), outputLocation: rendered,
      });
      return { result: undefined, workers: concurrency };
    });
    // Named by its bytes, so each footage's blockout stays beside it for comparison.
    const hash = createHash('sha256').update(readFileSync(rendered)).digest('hex').slice(0, 12);
    const dir = join(session.project, 'generated');
    mkdirSync(dir, { recursive: true });
    const kept = join(dir, `blockout-${sceneId}-${hash}.mp4`);
    renameSync(rendered, kept);
    console.error(`blockout ${kept}`);
    return kept;
  });
}

function mediaSeconds(file: string): number {
  return probeMediaSeconds(file);
}
