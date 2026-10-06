// stamp-gate-shot-span.ts: a gate shot is written without a span, as a scene's shot is written before its scene
// hands it one; what draws it (stampGateShotFrames, a page) gives it the span its frames lie in, at the fps the gate
// plays shots at.

import type { PaintedShotProps } from '#lib/paint/shot/models/shot-props.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';

/** The fps the gate plays its shots at, as a composition would: a span's and a warm's frames are counted at it, and a lens leaving out its shutter takes half a frame of it. */
export const STAMP_GATE_SHOT_FPS = 30;

/** A shot as a gate case writes it: everything but the span, which what draws it hands it (stampGateShotSpanned). */
export type StampGateShot = Omit<PaintedShotProps, 'span'>;

/**
 * The span a scene drawing a gate shot at `drawn` scene seconds would hand it: from 0 (or the earliest drawn, if
 * before) to a frame past the latest, at STAMP_GATE_SHOT_FPS.
 */
export const stampGateShotSpan = (drawn: readonly number[]): SceneShownSpan =>
  ({ from: Math.min(0, ...drawn), to: Math.max(0, ...drawn) + 1 / STAMP_GATE_SHOT_FPS, fps: STAMP_GATE_SHOT_FPS });

/** `shot` with the span its frames at `drawn` scene seconds and its warm lie in. */
export const stampGateShotSpanned = (shot: StampGateShot, drawn: readonly number[]): PaintedShotProps =>
  ({ ...shot, span: stampGateShotSpan([...drawn, ...(shot.warm ? [shot.warm.to] : [])]) });
