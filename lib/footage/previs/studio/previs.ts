// previs.ts: a previs scene's rules as pure data, shared by the composition (Video.tsx, previs.tsx) and by
// `studio gen video` (lib/output/render/engine/previs-render.ts): where a scene's blockout render starts and how long it
// runs, and what the command asks for. The models it can be rendered with are in ../models/previs-models.ts.
//
// The footage covers the scene's whole time on screen, crossfades included, so it starts at the scene time the
// blockout render started (`from`, negative when the scene fades in). Retiming maps scene time to blockout time, and
// footage time is blockout time less `from`.

import type { PrevisRequest } from '#lib/picture/video/models/timeline-report.ts';
import type { LaidScene, LaidVideo } from '#lib/picture/video/studio/video.ts';

/** One scene's generated footage, as generated/footage.ts lists it. */
export type PrevisFootage = { src: string; from: number; duration: number };

/** Where a scene's blockout render starts, in scene seconds, and its time on screen in whole seconds. */
export function previsSpan(tl: LaidVideo, sceneId: string): { from: number; duration: number } {
  const scene = tl.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`no scene "${sceneId}"; the scenes are ${tl.scenes.map((s) => s.id).join(', ')}`);
  const { visible } = scene;
  return { from: (visible.from - scene.from) / tl.fps, duration: Math.ceil((visible.to - visible.from) / tl.fps) };
}

export function previsRequestFor(tl: LaidVideo, scene: LaidScene): PrevisRequest | undefined {
  const { previs } = scene;
  return previs && { blockout: previs.blockout, prompt: previs.prompt, references: previs.references ?? [], audio: previs.audio ?? false, ...previsSpan(tl, scene.id) };
}
