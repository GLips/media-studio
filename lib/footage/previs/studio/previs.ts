// previs.ts: a previs scene's rules as pure data, shared by the composition (Video.tsx, previs.tsx) and by
// `studio gen video` (lib/output/render/engine/previs-render.ts): the model and its limits, where a scene's blockout render starts and how
// long it runs, and what the command asks for.
//
// The footage covers the scene's whole time on screen, crossfades included, so it starts at the scene time the
// blockout render started (`from`, negative when the scene fades in). Retiming maps scene time to blockout time, and
// footage time is blockout time less `from`.

import type { FrameSize } from '#lib/picture/frame/models/frame.ts';
import type { LaidScene, LaidVideo } from '#lib/picture/composition/studio/timeline.ts';

export const PREVIS_MODEL = 'bytedance/seedance-2.5';
/** The whole seconds Seedance 2.5 renders: a request is the scene's time on screen, rounded up into these. */
export const PREVIS_SECONDS = { min: 4, max: 30 } as const;
/** Seedance 2.5 renders at most 720p (720 px on the short side), so the blockout is sent at that size too. */
export const PREVIS_SHORT_SIDE = 720;
/** The frame shapes Seedance renders. A video of any other shape can't be sent a matching shot. */
const PREVIS_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;

/** Seedance's `aspect_ratio` for a video of this frame size; throws for a shape it doesn't render. */
export function previsAspectRatio({ width, height }: FrameSize): (typeof PREVIS_ASPECT_RATIOS)[number] {
  const ratio = PREVIS_ASPECT_RATIOS.find((r) => {
    const [w, h] = r.split(':').map(Number);
    return Math.abs(width / height - w / h) < 0.01;
  });
  if (!ratio) throw new Error(`Seedance renders ${PREVIS_ASPECT_RATIOS.join(', ')} shots; a ${width}×${height} video is none of them`);
  return ratio;
}

/** One scene's generated footage, as generated/footage.ts lists it. */
export type PrevisFootage = { src: string; from: number; duration: number };

/** What `studio gen video` asks for a previs scene, read from the timeline report. */
export type PrevisRequest = { blockout: '3d' | '2d'; prompt: string; references: readonly string[]; audio: boolean; from: number; duration: number };

/**
 * Where a scene's blockout render starts, in scene seconds, and how many whole seconds it runs. Not checked against
 * PREVIS_SECONDS.max: a scene that outgrew it still plays the footage it has (assertPrevisSpanFits guards a render).
 */
export function previsSpan(tl: LaidVideo, sceneId: string): { from: number; duration: number } {
  const scene = tl.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`no scene "${sceneId}"; the scenes are ${tl.scenes.map((s) => s.id).join(', ')}`);
  const { visible } = scene;
  return { from: (visible.from - scene.from) / tl.fps, duration: Math.max(PREVIS_SECONDS.min, Math.ceil((visible.to - visible.from) / tl.fps)) };
}

export function assertPrevisSpanFits(sceneId: string, span: { duration: number }) {
  if (span.duration > PREVIS_SECONDS.max) throw new Error(`scene ${sceneId} is on screen over ${PREVIS_SECONDS.max}s, longer than a generated shot can run: split it`);
}

export function previsRequestFor(tl: LaidVideo, scene: LaidScene): PrevisRequest | undefined {
  const { previs } = scene;
  return previs && { blockout: previs.blockout, prompt: previs.prompt, references: previs.references ?? [], audio: previs.audio ?? false, ...previsSpan(tl, scene.id) };
}
