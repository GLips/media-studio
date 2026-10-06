// stamp-gate-shot-frames.ts: a gate shot drawn through the shot's renderer into its canvases (shot-canvas.ts), with
// the gate's brushes and images on a device of its own: what every shot page's checks and baselines are drawn by.
// Drawn on a canvas off the page, its frames are read back and what each cost is counted.

import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import { createStampPaintCostTally, type StampPaintCostTally, type StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { createStampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { compilePaintedShot, shotCanvasLayings, type CompiledPaintedShot } from '#lib/paint/shot/models/shot-compile.ts';
import { createShotCanvasElements, createShotCanvasSurface, disposeShotCanvasSurface, type ShotCanvasElements, type ShotCanvasSurface } from '#lib/paint/shot/studio/shot-canvas.ts';
import { createPaintedShotRenderer, type PaintedShotRenderer } from '#lib/paint/shot/studio/shot-renderer.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import type { LensMode } from '#lib/picture/lens/models/lens-mode.ts';
import { STAMP_GATE_SHOT_FPS, stampGateShotSpanned, type StampGateShot } from '../models/stamp-gate-shot-span.ts';
import { stampGateSheetBrushOf } from '../models/stamp-gate-sheets.ts';
import { stampGateCanvasBytes } from './stamp-gate-page-surface.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

/**
 * `shot` drawn into `canvases` (on the page or off it), each laid as it says, on a device owner of its own with the
 * gate's brushes and images, counting into `costs` when given; its renderer handed to `use`, all disposed after.
 */
export async function withGateShotRenderer<T>(
  shot: CompiledPaintedShot, canvases: readonly ShotCanvasElements[], use: (renderer: PaintedShotRenderer) => Promise<T>, costs?: StampPaintCostTally,
): Promise<T> {
  const owner = await createStampPaintGpuOwner(stampGateSheetImageUrl), surfaces: ShotCanvasSurface[] = [], layings = shotCanvasLayings(shot);
  try {
    await gpuEachInTurn(canvases, async (canvas, index) => surfaces.push(await createShotCanvasSurface(owner, canvas, layings[index], shot.camera.stage.frame)));
    const renderer = await createPaintedShotRenderer(owner, surfaces, shot, { brushOf: stampGateSheetBrushOf, ...(costs && { costs }) });
    try {
      return await use(renderer);
    } finally {
      renderer.dispose();
    }
  } finally {
    for (const surface of surfaces) disposeShotCanvasSurface(surface);
    owner.dispose();
  }
}

/** A gate shot's frames, RGBA bytes; each frame's costs, in turn; and its warm's (nothing solved without a span). */
export type StampGateShotFrames = { readonly frames: readonly Uint8ClampedArray[]; readonly costs: readonly StampPaintCosts[]; readonly warm: StampPaintCosts };

/** A frame a gate shot draws: at a scene second, fast; or at `t` in a lens mode. */
export type StampGateShotDraw = number | { readonly t: number; readonly mode: LensMode };

/**
 * `props`' frames as `draws` say, in turn, over the span they lie in, once its warm span (if any) is solved at
 * STAMP_GATE_SHOT_FPS, in no scene; `drawing` called as each frame begins, for a check splitting what else it hears by
 * frame.
 */
export async function stampGateShotFrames(props: StampGateShot, draws: readonly StampGateShotDraw[], drawing?: () => void): Promise<StampGateShotFrames> {
  const { shot, problems } = compilePaintedShot(stampGateShotSpanned(props, draws.map((draw) => (typeof draw === 'number' ? draw : draw.t))), []);
  if (!shot) throw paintingProblemsError('stamp gate shot', problems);
  const canvas = createShotCanvasElements(), tally = createStampPaintCostTally();
  return withGateShotRenderer(shot, [canvas], async (renderer) => {
    await renderer.warm({ fps: STAMP_GATE_SHOT_FPS, sceneDur: null, mode: 'fast' });
    const warm = tally.take(), costs: StampPaintCosts[] = [];
    const frames = await gpuEachInTurn(draws, async (draw) => {
      const { t, mode } = typeof draw === 'number' ? { t: draw, mode: 'fast' as const } : draw;
      drawing?.();
      await renderer.draw(t, mode);
      await renderer.finish();
      const read = stampGateCanvasBytes(canvas.colour);
      costs.push(tally.take());
      return read;
    });
    return { frames, costs, warm };
  }, tally);
}

/** Equal frames, RGBA bytes `height` rows high, laid side by side in turn into one `width` px across. */
export function stampGateFramesBeside(frames: readonly Uint8ClampedArray[], { width, height }: { readonly width: number; readonly height: number }): Uint8ClampedArray {
  const one = width / frames.length, beside = new Uint8ClampedArray(width * height * 4);
  frames.forEach((rgba, f) => {
    for (let y = 0; y < height; y++) beside.set(rgba.subarray(y * one * 4, (y + 1) * one * 4), (y * width + f * one) * 4);
  });
  return beside;
}

/** A frame's solves, each its sheet program and the first entry it re-ran. */
export const stampGateSolvedText = ({ solves }: StampPaintCosts) => solves.map(({ program, from }) => `${program} from ${from}`);
