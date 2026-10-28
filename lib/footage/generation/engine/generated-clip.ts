// generated-clip.ts: `studio gen clip`. A shot from a prompt, optionally pinned to a first and a last frame, for
// footage no blockout needs: a handheld move between two stills the project already has. Cached like every paid
// generation (lib/platform/paid-generation/engine/paid-generation.ts), and written to generated/<name>-<key>.mp4.
//
// Each video model takes its own durations, resolutions, shapes and pinned frames, and a request outside them is
// either refused upstream after the job is queued or silently rendered otherwise, so it's checked against the video
// API's own description of the model (fetchOpenRouterVideoModel) before it's paid for.
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { fetchOpenRouterVideoModel, type OpenRouterVideoModel } from '#lib/platform/paid-generation/engine/openrouter.ts';
import { generatePaidMedia, type PaidGenerationReference } from '#lib/platform/paid-generation/engine/paid-generation.ts';

export type GeneratedClipRequest = {
  name: string;
  prompt: string;
  model: string;
  seconds: number;
  /** e.g. '9:16'. */
  aspect: string;
  /** e.g. '1080p'. */
  resolution: string;
  /** Absolute paths of the stills the shot starts and ends on. */
  first?: string;
  last?: string;
};

const FRAME_IMAGE = ['.png', '.jpg', '.jpeg', '.webp'];

/** Generates the clip and returns its path. Always silent: a video's sound is its voice and music. */
export async function generateProjectClip(project: string, request: GeneratedClipRequest): Promise<string> {
  if (!/^[a-z][a-z0-9-]*$/.test(request.name)) throw new Error(`--name must be lowercase words joined by dashes, not ${request.name}`);
  const references: Required<PaidGenerationReference>[] = [];
  for (const [frame, path] of [['first_frame', request.first], ['last_frame', request.last]] as const) {
    if (path === undefined) continue;
    if (!existsSync(path)) throw new Error(`no frame image at ${path}`);
    if (!FRAME_IMAGE.includes(extname(path).toLowerCase())) throw new Error(`${path}: a frame image must be one of ${FRAME_IMAGE.join(' ')}`);
    references.push({ path, frame });
  }
  const model = await fetchOpenRouterVideoModel(request.model);
  const { files: [file] } = await generatePaidMedia(project, {
    kind: 'video', model: request.model, name: request.name, prompt: request.prompt,
    params: {
      duration: request.seconds, resolution: request.resolution, aspect_ratio: request.aspect,
      ...(model.generate_audio !== null && { generate_audio: false }),
    },
    references,
    beforePaying: async () => checkOpenRouterClipRequest(model, request, references),
  });
  return file;
}

/** Refuses a request `model` can't render as asked. */
function checkOpenRouterClipRequest(model: OpenRouterVideoModel, request: GeneratedClipRequest, references: readonly Required<PaidGenerationReference>[]) {
  const refuse = (flag: string, value: string | number, allowed: readonly (string | number)[] | null) => {
    if (allowed && !allowed.includes(value)) throw new Error(`${model.id} takes ${flag} ${allowed.join(', ')}, not ${value}`);
  };
  refuse('--seconds', request.seconds, model.supported_durations);
  refuse('--aspect', request.aspect, model.supported_aspect_ratios);
  refuse('--resolution', request.resolution, model.supported_resolutions);
  for (const { frame } of references) {
    if (!model.supported_frame_images?.includes(frame)) throw new Error(`${model.id} can't pin a ${frame === 'first_frame' ? '--first' : '--last'} frame; pick another --model`);
  }
}
