// stamp-gate-shot-frames.ts: a gate shot drawn through the shot's renderer on a surface of its own, with the gate's
// brushes and images, its frames read back: what every shot page's checks and baselines are drawn by.

import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { compilePaintedShot } from '#lib/paint/shot/models/shot-compile.ts';
import type { PaintedShotProps } from '#lib/paint/shot/models/shot-props.ts';
import { createPaintedShotRenderer } from '#lib/paint/shot/studio/shot-renderer.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { STAMP_GATE_SHOT_FPS } from '../models/stamp-gate-shots.ts';
import { stampGateSheetBrushOf } from '../models/stamp-gate-sheets.ts';
import { withGateSurface } from './stamp-gate-page-surface.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

/** What a gate shot's frames count into, `costs`, and what's called as they're drawn: `warmed` after the warm, `drawn` after each frame. */
export type StampGateShotFramesWatch = { readonly costs?: StampPaintCostTally; readonly warmed?: () => void; readonly drawn?: () => void };

/**
 * `props`' frames at scene seconds `times`, in turn, each read back as RGBA bytes, once its warm span (if any) is
 * solved at STAMP_GATE_SHOT_FPS, in no scene.
 */
export async function stampGateShotFrames(props: PaintedShotProps, times: readonly number[], { costs, warmed, drawn }: StampGateShotFramesWatch = {}): Promise<Uint8ClampedArray[]> {
  const { shot, problems } = compilePaintedShot(props, []);
  if (!shot) throw paintingProblemsError('stamp gate shot', problems);
  const { width, height } = shot.camera.stage.frame;
  return withGateSurface({ width, height }, stampGateSheetImageUrl, async (surface, frame) => {
    const renderer = await createPaintedShotRenderer(surface.owner, [surface], shot, { brushOf: stampGateSheetBrushOf, ...(costs && { costs }) });
    try {
      await renderer.warm({ fps: STAMP_GATE_SHOT_FPS, sceneDur: null });
      warmed?.();
      return await gpuEachInTurn(times, async (t) => {
        await renderer.draw(t, 'fast');
        await renderer.finish();
        const read = frame();
        drawn?.();
        return read;
      });
    } finally {
      renderer.dispose();
    }
  });
}
