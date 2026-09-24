// previs-render.ts: `studio gen video`. Renders one previs scene's blockout alone (Video.tsx's BlockoutSolo), sends it
// to Seedance as the reference video with the scene's stills, and lists what comes back in generated/footage.json
// (lib/previs-footage.ts), so the scene plays it in place of its blockout (lib/studio/previs.tsx).
//
// The blockout is the whole request's content: re-rendering an unchanged scene makes the same MP4 and so the same
// cache key (lib/paid-generation.ts), while a changed subject, move or prompt pays for a new render. Timing never
// should: it's fixed afterwards with the scene's `previs.retime`.
import { renderMedia, selectComposition } from '@remotion/renderer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { generatePaidMedia } from './paid-generation.ts';
import { readPrevisFootageList, writePrevisFootageEntry } from './previs-footage.ts';
import { blockoutSlug } from './project-bundle.ts';
import { RENDER_CHROMIUM, RENDER_CONCURRENCY, type RenderSession } from './render-session.ts';
import { assertPrevisSpanFits, PREVIS_MODEL, PREVIS_WIDTH } from './studio/previs.ts';

// Seedance numbers its references by kind in the order sent (@Video1, @Image1, @Image2…), and the blockout goes first.
// Worded as a new video that references @Video1's camera, never as changing @Video1: Seedance reads the task type from
// the prompt, and as an edit the output must take the input's length and ratio (duration -1), which OpenRouter's
// schema can't send.
const PREVIS_PREAMBLE = 'Generate a new, photoreal video. Reference @Video1 for its camera movement, framing and timing, and for where each '
  + 'subject stands and how it moves: @Video1 is a grey 3D layout sketch of this shot, where each grey or tinted shape marks a subject '
  + 'described below. The new video shows the real subjects in a real place, in real light and materials, with none of the sketch\'s '
  + 'grid, flat grey shapes or empty backdrop.';

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
  if (!scene.previs) throw new Error(`scene ${sceneId} has no previs: give its defineScene a \`previs: { prompt }\` and render its blockout from it`);
  const previs = scene.previs;
  assertPrevisSpanFits(sceneId, previs);
  for (const ref of previs.references) if (!existsSync(join(project, ref))) throw new Error(`scene ${sceneId}: reference ${ref} isn't in the project`);

  const blockout = await renderBlockout(session, sceneId);
  const prompt = `${PREVIS_PREAMBLE}\n\n${previs.prompt}`;
  const playing = readPrevisFootageList(project)[sceneId];
  const stale = Boolean(playing && playing.blockout !== basename(blockout));
  if (dry) return { blockout, footage: null, prompt, stale };

  const [footage] = await generatePaidMedia(project, {
    kind: 'video', model: PREVIS_MODEL, name: sceneId, prompt,
    params: { duration: previs.duration, resolution: '720p', aspect_ratio: '16:9', generate_audio: previs.audio },
    references: [{ path: blockout }, ...previs.references.map((ref) => ({ path: join(project, ref) }))],
  });
  writePrevisFootageEntry(project, sceneId, {
    file: relative(join(project, 'generated'), footage), from: previs.from, duration: mediaSeconds(footage), blockout: basename(blockout),
  });
  return { blockout, footage, prompt, stale: false };
}

async function renderBlockout(session: RenderSession, sceneId: string): Promise<string> {
  const inputProps = { scene: sceneId };
  const composition = await selectComposition({ serveUrl: session.serveUrl, chromiumOptions: RENDER_CHROMIUM, id: blockoutSlug(session.project), inputProps });
  const tmp = mkdtempSync(join(tmpdir(), 'blockout-'));
  const rendered = join(tmp, 'blockout.mp4');
  console.error(`rendering scene ${sceneId}'s blockout, ${composition.durationInFrames / composition.fps}s…`);
  await renderMedia({
    composition, serveUrl: session.serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps,
    codec: 'h264', muted: true, crf: 20, pixelFormat: 'yuv420p', scale: PREVIS_WIDTH / composition.width, outputLocation: rendered,
  });
  // Named by its bytes, so each footage's blockout stays beside it for comparison.
  const hash = createHash('sha256').update(readFileSync(rendered)).digest('hex').slice(0, 12);
  const dir = join(session.project, 'generated');
  mkdirSync(dir, { recursive: true });
  const kept = join(dir, `blockout-${sceneId}-${hash}.mp4`);
  renameSync(rendered, kept);
  rmSync(tmp, { recursive: true, force: true });
  console.error(`blockout ${kept}`);
  return kept;
}

function mediaSeconds(file: string): number {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
}
