// stamp-gate-shot-frames.ts: a gate shot drawn through the shot's renderer on a surface of its own, with the gate's
// brushes and images, its frames read back and what each cost counted: what every shot page's checks and baselines
// are drawn by.

import { paintingProblemsError } from '#lib/paint/document/models/painting-problem.ts';
import { createStampPaintCostTally, type StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { compilePaintedShot } from '#lib/paint/shot/models/shot-compile.ts';
import type { PaintedShotProps } from '#lib/paint/shot/models/shot-props.ts';
import { createPaintedShotRenderer } from '#lib/paint/shot/studio/shot-renderer.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { STAMP_GATE_SHOT_FPS } from '../models/stamp-gate-shots.ts';
import { stampGateSheetBrushOf } from '../models/stamp-gate-sheets.ts';
import { withGateSurface } from './stamp-gate-page-surface.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

/** A gate shot's frames, RGBA bytes; each frame's costs, in turn; and its warm's (nothing solved without a span). */
export type StampGateShotFrames = { readonly frames: readonly Uint8ClampedArray[]; readonly costs: readonly StampPaintCosts[]; readonly warm: StampPaintCosts };

/**
 * `props`' frames at scene seconds `times`, in turn, once its warm span (if any) is solved at STAMP_GATE_SHOT_FPS, in
 * no scene; `drawing` called as each frame begins, for a check splitting what else it hears by frame.
 */
export async function stampGateShotFrames(props: PaintedShotProps, times: readonly number[], drawing?: () => void): Promise<StampGateShotFrames> {
  const { shot, problems } = compilePaintedShot(props, []);
  if (!shot) throw paintingProblemsError('stamp gate shot', problems);
  const { width, height } = shot.camera.stage.frame, tally = createStampPaintCostTally();
  return withGateSurface({ width, height }, stampGateSheetImageUrl, async (surface, frame) => {
    const renderer = await createPaintedShotRenderer(surface.owner, [{ colour: surface, filter: null }], shot, { brushOf: stampGateSheetBrushOf, costs: tally });
    try {
      await renderer.warm({ fps: STAMP_GATE_SHOT_FPS, sceneDur: null });
      const warm = tally.take(), costs: StampPaintCosts[] = [];
      const frames = await gpuEachInTurn(times, async (t) => {
        drawing?.();
        await renderer.draw(t, 'fast');
        await renderer.finish();
        const read = frame();
        costs.push(tally.take());
        return read;
      });
      return { frames, costs, warm };
    } finally {
      renderer.dispose();
    }
  });
}

/** A frame's solves, each its sheet program and the first entry it re-ran. */
export const stampGateSolvedText = ({ solves }: StampPaintCosts) => solves.map(({ program, from }) => `${program} from ${from}`);
