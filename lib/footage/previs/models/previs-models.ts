// previs-models.ts: the video models `studio gen video` can render a previs scene with, and what each can render:
// its length, shapes and price. Pure, so the CLI's flag and the render (lib/output/render/engine/previs-render.ts) share it.

import type { FrameSize } from '#lib/picture/frame/models/frame.ts';

/** A video model a previs scene can be rendered with, as `studio gen video --model` names it. */
export type PrevisModel = {
  id: string;
  label: string;
  /** The whole seconds it renders: a request is the scene's time on screen, rounded up into these. */
  seconds: { min: number; max: number };
  resolution: string;
  /** What a second of footage costs with a blockout as its reference video, in USD. */
  usdPerSecond: number;
  /** Whether it takes `previs.references`, stills of the real subjects, beside the blockout. */
  takesStills: boolean;
  /** Whether it takes `generate_audio`. A model without it always makes sound, which previs.tsx mutes unless `previs.audio`. */
  audioOptional: boolean;
};

export const PREVIS_MODELS = {
  // Bills the blockout's seconds as well as the footage's.
  seedance: { id: 'bytedance/seedance-2.5', label: 'Seedance 2.5', seconds: { min: 4, max: 30 }, resolution: '720p', usdPerSecond: 0.28, takesStills: true, audioOptional: true },
  // OpenRouter lists $0.06/s with a reference video at 768p; six 6 s renders on 2026-09-30 were each billed $0.03/s.
  heygen: { id: 'heygen/heygen-video-1', label: 'HeyGen Video 1', seconds: { min: 5, max: 15 }, resolution: '768p', usdPerSecond: 0.03, takesStills: false, audioOptional: false },
} as const satisfies Record<string, PrevisModel>;
export type PrevisModelName = keyof typeof PREVIS_MODELS;
// SAFETY: PREVIS_MODELS is a literal object, so its keys are exactly PrevisModelName.
export const PREVIS_MODEL_NAMES = Object.keys(PREVIS_MODELS) as PrevisModelName[];

/**
 * The blockout's short side, whichever model it's sent to: one size, so a scene's blockout is the same file for both
 * and a footage is stale only when the shot changed.
 */
export const PREVIS_BLOCKOUT_SHORT_SIDE = 720;
/** The frame shapes both models render. A video of any other shape can't be sent a matching shot. */
const PREVIS_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;

/** The models' `aspect_ratio` for a video of this frame size; throws for a shape they don't render. */
export function previsAspectRatio({ width, height }: FrameSize): (typeof PREVIS_ASPECT_RATIOS)[number] {
  const ratio = PREVIS_ASPECT_RATIOS.find((r) => {
    const [w, h] = r.split(':').map(Number);
    return Math.abs(width / height - w / h) < 0.01;
  });
  if (!ratio) throw new Error(`generated shots come in ${PREVIS_ASPECT_RATIOS.join(', ')}; a ${width}×${height} video is none of them`);
  return ratio;
}

/**
 * How many seconds `model` renders for a scene on screen `onScreen` whole seconds: rounded up to its minimum, or null
 * past its maximum. Only a render is refused: a scene that outgrew it still plays the footage it has.
 */
export function previsShotSeconds(model: PrevisModelName, onScreen: number): number | null {
  const { seconds } = PREVIS_MODELS[model];
  return onScreen > seconds.max ? null : Math.max(seconds.min, onScreen);
}
