// previs-render.ts: `studio gen video`. Renders one previs scene's blockout alone (Video.tsx's BlockoutSolo), sends it
// to Seedance as the reference video with the scene's stills, and lists what comes back in generated/footage.json
// (lib/footage/previs/engine/previs-footage.ts), so the scene plays it in place of its blockout (lib/footage/previs/studio/previs.tsx).
//
// The blockout is the whole request's content: re-rendering an unchanged scene makes the same MP4 and so the same
// cache key (lib/footage/generation/engine/paid-generation.ts), while a changed subject, move or prompt pays for a new render. Timing never
// should: it's fixed afterwards with the scene's `previs.retime`.
import { renderMedia, selectComposition } from '@remotion/renderer';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { generatePaidMedia } from '#lib/footage/generation/engine/paid-generation.ts';
import { readPrevisFootageList, writePrevisFootageEntry } from '#lib/footage/previs/engine/previs-footage.ts';
import { blockoutSlug } from './project-bundle.ts';
import { RENDER_CHROMIUM } from './render-browser.ts';
import type { RenderSession } from './render-session.ts';
import { assertPrevisSpanFits, PREVIS_MODEL, PREVIS_SHORT_SIDE, previsAspectRatio } from '#lib/footage/previs/studio/previs.ts';
import { probeMediaSeconds } from '#lib/output/ffmpeg/engine/ffmpeg.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';

// Seedance numbers its references by kind in the order sent (@Video1, @Image1, @Image2…), and the blockout goes first.
// Worded as a new video that references @Video1's camera, never as changing @Video1: Seedance reads the task type from
// the prompt, and as an edit the output must take the input's length and ratio (duration -1), which OpenRouter's
// schema can't send. Each preamble is part of its requests' cache key: rewording one pays again for every scene it heads.
// A 2D blockout has no camera to follow, so its preamble asks for placement and timing, and says nothing of photorealism.
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
 * Renders scene `sceneId`'s blockout to generated/blockout-<scene>-<hash>.mp4 and, unless `dry`, makes its footage.
 * Returns the blockout, the footage (null when dry), the request's prompt, and whether the footage the scene plays now
 * came from another blockout: it's stale, and plays until this is run without `dry`.
 */
export async function renderPrevisFootage(session: RenderSession, sceneId: string, { dry }: { dry: boolean }) {
  const { project } = session;
  const timeline = await session.readTimeline();
  const scene = timeline.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`no scene "${sceneId}"; the scenes are ${timeline.scenes.map((s) => s.id).join(', ')}`);
  if (!scene.previs) throw new Error(`scene ${sceneId} has no previs: give it a \`previs: { blockout, prompt }\` and render its blockout from it`);
  const previs = scene.previs;
  assertPrevisSpanFits(sceneId, previs);
  for (const ref of previs.references) if (!existsSync(join(project, ref))) throw new Error(`scene ${sceneId}: reference ${ref} isn't in the project`);

  // Checked before the blockout renders, so a video Seedance can't match stops before any work.
  const aspect = previsAspectRatio(timeline);
  const blockout = await renderBlockout(session, sceneId);
  const prompt = `${PREVIS_PREAMBLES[previs.blockout]}\n\n${previs.prompt}`;
  const playing = readPrevisFootageList(project)[sceneId];
  const stale = Boolean(playing && playing.blockout !== basename(blockout));
  if (dry) return { blockout, footage: null, prompt, stale };

  const [footage] = await generatePaidMedia(project, {
    kind: 'video', model: PREVIS_MODEL, name: sceneId, prompt,
    params: { duration: previs.duration, resolution: '720p', aspect_ratio: aspect, generate_audio: previs.audio },
    references: [{ path: blockout }, ...previs.references.map((ref) => ({ path: join(project, ref) }))],
  });
  writePrevisFootageEntry(project, sceneId, {
    file: relative(join(project, 'generated'), footage), from: previs.from, duration: mediaSeconds(footage), blockout: basename(blockout),
  });
  return { blockout, footage, prompt, stale: false };
}

async function renderBlockout(session: RenderSession, sceneId: string): Promise<string> {
  const inputProps = { scene: sceneId };
  return withStudioTemp('blockout', async (tmp) => {
    const rendered = join(tmp, 'blockout.mp4');
    await session.inBrowser('blockout', async (browser) => {
      const composition = await selectComposition({ serveUrl: session.serveUrl, chromiumOptions: RENDER_CHROMIUM, puppeteerInstance: browser, id: blockoutSlug(session.project), inputProps });
      const concurrency = session.workersFor(composition);
      console.error(`rendering scene ${sceneId}'s blockout, ${composition.durationInFrames / composition.fps}s…`);
      await renderMedia({
        composition, serveUrl: session.serveUrl, chromiumOptions: RENDER_CHROMIUM, puppeteerInstance: browser, concurrency, inputProps,
        codec: 'h264', muted: true, crf: 20, pixelFormat: 'yuv420p', scale: PREVIS_SHORT_SIDE / Math.min(composition.width, composition.height), outputLocation: rendered,
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
