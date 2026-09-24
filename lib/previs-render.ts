// previs-render.ts: `studio gen video`. Renders one previs scene's blockout alone (Video.tsx's BlockoutSolo), sends it
// to Seedance as the reference video with the scene's stills, and lists what comes back in generated/footage.ts, which
// the scene then plays in place of its blockout (lib/studio/previs.tsx).
//
// The blockout is the whole request's content: re-rendering an unchanged scene makes the same MP4 and so the same
// cache key (lib/paid-generation.ts), while a changed subject, move or prompt pays for a new render. Timing never
// should: it's fixed afterwards with the scene's `previs.retime`.
import { renderMedia, selectComposition } from '@remotion/renderer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { generatePaidMedia } from './paid-generation.ts';
import { blockoutSlug, footageModuleFor } from './project-bundle.ts';
import { RENDER_CHROMIUM, RENDER_CONCURRENCY, type RenderSession } from './render-session.ts';

export const PREVIS_MODEL = 'bytedance/seedance-2.5';
// Seedance 2.5 renders at most 720p, so the reference goes at that size too: a quarter of the bytes of 1080p inline.
const BLOCKOUT_WIDTH = 1280;

// Seedance numbers its references by kind in the order sent (@Video1, @Image1, @Image2…), and the blockout goes first.
const PREVIS_PREAMBLE = '@Video1 is a grey 3D previs blockout of this shot. Keep its camera movement, framing and timing exactly, '
  + 'and every subject where and as it moves there. Render it as finished footage: each grey or tinted shape becomes the real '
  + 'subject described below, in real light and materials. None of the blockout\'s grid, flat grey primitives or empty backdrop remains.';

type FootageEntry = { file: string; from: number; duration: number };
const footageListFor = (project: string) => join(project, 'generated', 'footage.json');

/**
 * Renders scene `sceneId`'s blockout to generated/blockout-<scene>-<hash>.mp4 and, unless `dry`, makes its footage.
 * Returns the blockout, the footage (null when dry) and the request's prompt.
 */
export async function renderPrevisFootage(session: RenderSession, sceneId: string, { dry }: { dry: boolean }) {
  const { project } = session;
  const timeline = await session.readTimeline();
  const scene = timeline.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`no scene "${sceneId}"; the scenes are ${timeline.scenes.map((s) => s.id).join(', ')}`);
  if (!scene.previs) throw new Error(`scene ${sceneId} has no previs: give its defineScene a \`previs: { prompt }\` and render its blockout from it`);
  const previs = scene.previs;
  for (const ref of previs.references) if (!existsSync(join(project, ref))) throw new Error(`scene ${sceneId}: reference ${ref} isn't in the project`);

  const blockout = await renderBlockout(session, sceneId);
  const prompt = `${PREVIS_PREAMBLE}\n\n${previs.prompt}`;
  if (dry) return { blockout, footage: null, prompt };

  const [footage] = await generatePaidMedia(project, {
    kind: 'video', model: PREVIS_MODEL, name: sceneId, prompt,
    params: { duration: previs.duration, resolution: '720p', aspect_ratio: '16:9', generate_audio: previs.audio },
    references: [{ path: blockout }, ...previs.references.map((ref) => ({ path: join(project, ref) }))],
  });
  writeFootageEntry(project, sceneId, { file: relative(join(project, 'generated'), footage), from: previs.from, duration: mediaSeconds(footage) });
  return { blockout, footage, prompt };
}

async function renderBlockout(session: RenderSession, sceneId: string): Promise<string> {
  const inputProps = { scene: sceneId };
  const composition = await selectComposition({ serveUrl: session.serveUrl, chromiumOptions: RENDER_CHROMIUM, id: blockoutSlug(session.project), inputProps });
  const tmp = mkdtempSync(join(tmpdir(), 'blockout-'));
  const rendered = join(tmp, 'blockout.mp4');
  console.error(`rendering scene ${sceneId}'s blockout, ${composition.durationInFrames / composition.fps}s…`);
  await renderMedia({
    composition, serveUrl: session.serveUrl, chromiumOptions: RENDER_CHROMIUM, concurrency: RENDER_CONCURRENCY, inputProps,
    codec: 'h264', muted: true, crf: 20, pixelFormat: 'yuv420p', scale: BLOCKOUT_WIDTH / composition.width, outputLocation: rendered,
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

// footage.json is the list; footage.ts, rewritten from it each time, imports each file so the bundle serves it.
function writeFootageEntry(project: string, sceneId: string, entry: FootageEntry) {
  const listPath = footageListFor(project);
  const list: Record<string, FootageEntry> = existsSync(listPath) ? JSON.parse(readFileSync(listPath, 'utf8')) : {};
  list[sceneId] = entry;
  writeFileSync(listPath, JSON.stringify(list, null, 2));
  const scenes = Object.entries(list);
  writeFileSync(footageModuleFor(project), [
    '// Written by `studio gen video` from footage.json. Edits here are lost on the next render.',
    ...scenes.map(([, { file }], i) => `import f${i} from './${file}';`),
    '',
    'export const footage = {',
    ...scenes.map(([id, { from, duration }], i) => `  ${JSON.stringify(id)}: { src: f${i}, from: ${from}, duration: ${duration} },`),
    '};',
    '',
  ].join('\n'));
}
