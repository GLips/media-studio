// stamp-sources-renderer.ts: a scene that paints nothing, its planes all sources (stamp-lens-source.ts), rendered and
// laid through the lens on a stamp paint surface as the stamp renderer lays its source planes. Its back is a picture.

import { createLensCompositor, type LensFrameExposures } from '#lib/picture/lens/studio/lens-compositor.ts';
import type { StampLaidPlanes } from '../models/stamp-plane.ts';
import type { StampStage } from '../models/stamp-stage.ts';
import { checkStampLensSources, createStampLensSourceLayers, STAMP_REST_LOOK } from './stamp-lens-source-layers.ts';
import type { StampLensSource } from './stamp-lens-source.ts';
import { stampLensSourceExposureOf, type StampPaintFrame, type StampPaintRenderer } from './stamp-paint-renderer.ts';
import type { StampPaintSurface } from './stamp-paint-surface.ts';

/** A renderer of a scene's sources alone: drawn, timed and let go of as a painting's renderer is. */
export type StampSourcesRenderer = Pick<StampPaintRenderer, 'stage' | 'draw' | 'finish' | 'dispose'>;

/**
 * A renderer on `surface` of `planes` (stampScenePlanes over no painting, or a painting camera built over none), each
 * drawn from its source in `sources`, on `stage`. Refuses a painted plane: it has nothing to paint one with.
 */
export async function createStampSourcesRenderer(
  surface: StampPaintSurface, { stage, planes, sources }: { stage: StampStage; planes: StampLaidPlanes; sources: ReadonlyMap<string, StampLensSource> },
): Promise<StampSourcesRenderer> {
  const { owner, format } = surface, device = owner.webgpu;
  if (stage.frame.width !== surface.width || stage.frame.height !== surface.height) {
    throw new Error(`stamp paint: the stage's frame is ${stage.frame.width} × ${stage.frame.height}, and its surface ${surface.width} × ${surface.height}`);
  }
  const painted = [planes.back, ...planes.nearer].filter((plane) => plane.kind === 'painted');
  if (painted.length) throw new Error(`stamp paint: ${painted.map(({ id }) => id).join(', ')} ${painted.length > 1 ? 'are' : 'is'} painted, and the scene has no painting`);
  checkStampLensSources(planes, sources, stage);
  const lens = createLensCompositor(owner.webgpu, { ...stage.frame, blurExtent: { w: stage.width, h: stage.height } });
  const sourceLayers = createStampLensSourceLayers(owner, { stage, lens, sources });
  const laidPlanes = [planes.back, ...planes.nearer].flatMap((plane) => (plane.kind === 'painted' ? [] : [plane]));
  const dithered = format.endsWith('8unorm');

  let referenceFrame: LensFrameExposures | null = null, disposed = false;
  /** The lens frame `paintFrame` draws into: its own for one exposure, else its reference frame's. */
  function lensFrameOf(paintFrame: StampPaintFrame): LensFrameExposures {
    if (paintFrame.kind !== 'exposure') return lens.beginFrame(1);
    const { index, count } = paintFrame.exposure;
    if (index === 0) referenceFrame = lens.beginFrame(count);
    if (referenceFrame?.count !== count) throw new Error(`stamp paint: exposure ${index} of ${count} drawn into a paintFrame of ${referenceFrame?.count ?? 'none'}`);
    return referenceFrame;
  }

  return {
    stage,
    draw: async (paintFrame) => {
      if (disposed) return;
      const renders = await sourceLayers.render(paintFrame.t, stampLensSourceExposureOf(paintFrame));
      await owner.checked(`drawing the sources at ${paintFrame.t} s`, () => {
        const lensFrame = paintFrame.kind === 'once' ? null : paintFrame.lens;
        const moving = paintFrame.kind === 'fast' && (renders.moved.size > 0 || [...paintFrame.lens.planes.values()].some(({ shutter }) => shutter));
        const encoder = device.createCommandEncoder();
        const layers = laidPlanes.flatMap((plane, index) => sourceLayers.layer(encoder, plane, renders, {
          look: lensFrame?.planes.get(plane.id) ?? STAMP_REST_LOOK, focus: lensFrame?.focus ?? null, moving, back: index === 0,
        }));
        const exposures = lensFrameOf(paintFrame);
        exposures.exposure(encoder, layers, { glowing: false, moving });
        // Negative space: no bloom, as a source has no emission to glow.
        if (paintFrame.kind !== 'exposure' || paintFrame.exposure.index === paintFrame.exposure.count - 1) {
          exposures.develop(encoder, { bloom: null, into: surface.frameTexture().createView(), format, encoding: { kind: 'encoded', dithered } });
        }
        lens.flush();
        device.queue.submit([encoder.finish()]);
      });
    },
    finish: () => (disposed ? Promise.resolve() : device.queue.onSubmittedWorkDone()),
    dispose: () => {
      disposed = true;
      lens.dispose();
    },
  };
}
