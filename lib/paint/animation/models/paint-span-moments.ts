// paint-span-moments.ts: the moments a shot draws over its span of scene seconds: each frame's own and, with the
// shutter open, its shutter's ends (lens-shutter.ts), each end reading the frame's own `frame` so a held part stays
// put across it. A build samples every value there, so what it checks is what the frames draw: the camera's poses,
// how far a node's placement or a plane's lay carries paint.
//
// Negative space: between those moments nothing is drawn but a shutter's smear, which runs between its ends, and a
// reference's exposures within the shutter; a build pads its bounds for what moves between samples.

import { shutterOpensAt } from '#lib/picture/lens/models/lens-shutter.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
import { paintCameraShutterShut, type PaintCameraLens } from './paint-camera.ts';

/** A frame of a span: its scene second, and the moments drawing it reads (its own first, then its shutter's ends). */
export type PaintSpanFrame = { readonly t: number; readonly moments: readonly PaintMoment[] };

/** The first and past-the-last frame numbers `span` shows, frame k at k/fps scene seconds. */
export const paintSpanFrameRange = ({ from, to, fps }: SceneShownSpan) => ({ first: Math.ceil(from * fps - 1e-6), end: Math.ceil(to * fps - 1e-6) });

/** Why `span` can't be drawn over, or null: bounds not finite, a frame rate not above 0, or no frame between them. */
export function paintSpanProblem(span: SceneShownSpan): string | null {
  const { from, to, fps } = span;
  if (!(fps > 0 && Number.isFinite(fps))) return `its span's frame rate is ${fps}, not above 0`;
  if (!(Number.isFinite(from) && Number.isFinite(to))) return `its span runs from ${from} s to ${to} s, not between finite times`;
  const { first, end } = paintSpanFrameRange(span);
  return first < end ? null : `its span, ${from} s to ${to} s at ${fps} fps, shows no frame`;
}

/**
 * Why `span` isn't the one it's drawn over, worded to follow the span's name: a frame rate other than the
 * composition's `fps`, or, in a scene `sceneDur` s long (null outside one), not covering it from cut to end. Checks
 * and warnings sample the span alone, so a shot and a StampPainting's camera both hold to it.
 */
export function paintSpanShownProblems(span: SceneShownSpan, fps: number, sceneDur: number | null): string[] {
  const problems: string[] = [], remedy = "give it its scene's span, sceneSecondsOf(clock).span";
  if (span.fps !== fps) problems.push(`is sampled at ${span.fps} fps, and the composition runs at ${fps}: ${remedy}`);
  if (sceneDur !== null && !(span.from <= 1e-9 && span.to >= sceneDur - 1e-9)) {
    problems.push(`runs from ${span.from} s to ${span.to} s, and its scene shows 0 s to ${sceneDur} s at least: ${remedy}`);
  }
  return problems;
}

/** Why frame `t` can't be drawn over `span`, or null: it lies outside it, where nothing was checked. */
export function paintSpanDrawnProblem({ from, to }: SceneShownSpan, t: number): string | null {
  return t < from - 1e-9 || t >= to - 1e-9 ? `drawn at ${t} s, outside its span, ${from} s to ${to} s` : null;
}

/** Every frame `span` shows through `lens`, checked first by paintSpanProblem. */
export function paintSpanFrames(span: SceneShownSpan, lens: PaintCameraLens): PaintSpanFrame[] {
  const { first, end } = paintSpanFrameRange(span), shut = paintCameraShutterShut(lens), frames: PaintSpanFrame[] = [];
  for (let k = first; k < end; k++) {
    const t = k / span.fps, opens = shutterOpensAt(t, lens.shutter);
    frames.push({ t, moments: shut ? [paintMoment(t)] : [paintMoment(t), paintMoment(opens, t), paintMoment(opens + lens.shutter, t)] });
  }
  return frames;
}

/** Every moment of `frames`, in order. */
export const paintSpanMoments = (frames: readonly PaintSpanFrame[]): PaintMoment[] => frames.flatMap(({ moments }) => moments);

/** A scene second as a diagnostic names it: to the millisecond, trailing zeros dropped. */
export const paintSecondsText = (t: number) => `${Number(t.toFixed(3))} s`;
