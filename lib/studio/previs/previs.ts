// previs.ts: a previs scene's rules as pure data, shared by the composition (Video.tsx, previs.tsx) and by
// `studio gen video` (lib/engine/render/previs-render.ts): the model and its limits, where a scene's blockout render starts and how
// long it runs, and what the command asks for.
//
// The footage covers the scene's whole time on screen, crossfades included, so it starts at the scene time the
// blockout render started (`from`, negative when the scene fades in). Retiming maps scene time to blockout time, and
// footage time is blockout time less `from`.

import { visibleSpan, type LaidScene, type Timeline } from '../composition/timeline.ts';

export const PREVIS_MODEL = 'bytedance/seedance-2.5';
/** The whole seconds Seedance 2.5 renders: a request is the scene's time on screen, rounded up into these. */
export const PREVIS_SECONDS = { min: 4, max: 30 } as const;
/** Seedance 2.5 renders at most 720p, so the blockout is sent at that width too. */
export const PREVIS_WIDTH = 1280;

/** One scene's generated footage, as generated/footage.ts lists it. */
export type PrevisFootage = { src: string; from: number; duration: number };

/** What `studio gen video` asks for a previs scene, read from the timeline report. */
export type PrevisRequest = { prompt: string; references: readonly string[]; audio: boolean; from: number; duration: number };

/**
 * Where a scene's blockout render starts, in scene seconds, and how many whole seconds it runs. Not checked against
 * PREVIS_SECONDS.max: a scene that outgrew it still plays the footage it has (assertPrevisSpanFits guards a render).
 */
export function previsSpan(tl: Timeline, sceneId: string): { from: number; duration: number } {
  const i = tl.scenes.findIndex((scene) => scene.id === sceneId);
  if (i < 0) throw new Error(`no scene "${sceneId}"; the scenes are ${tl.scenes.map((scene) => scene.id).join(', ')}`);
  const scene = tl.scenes[i], span = visibleSpan(tl, i);
  return { from: span.start - scene.start, duration: Math.max(PREVIS_SECONDS.min, Math.ceil(span.end - span.start - 1e-6)) };
}

export function assertPrevisSpanFits(sceneId: string, span: { duration: number }) {
  if (span.duration > PREVIS_SECONDS.max) throw new Error(`scene ${sceneId} is on screen over ${PREVIS_SECONDS.max}s, longer than a generated shot can run: split it`);
}

export function previsRequestFor(tl: Timeline, scene: LaidScene): PrevisRequest | undefined {
  const { previs } = scene;
  return previs && { prompt: previs.prompt, references: previs.references ?? [], audio: previs.audio ?? false, ...previsSpan(tl, scene.id) };
}
