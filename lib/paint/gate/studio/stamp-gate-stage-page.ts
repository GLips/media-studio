// stamp-gate-stage-page.ts: the gate page's stage and lens cases (stamp-gate-stage.ts, stamp-gate-lens.ts), drawn
// on surfaces of their own.

import type { StampOutsideLayerState } from '#lib/paint/painting/models/stamp-outside-layer.ts';
import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { createStampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { stampGateFrameDifference, type StampGateFrameDifference } from '../models/stamp-gate-frames.ts';
import {
  checkStampGateDefocus, checkStampGateGlow, checkStampGateOutsideLens, STAMP_GATE_DEFOCUS_SCALE, STAMP_GATE_DEFOCUS_SIGMA, STAMP_GATE_GLOW, STAMP_GATE_OUTSIDE_DEFOCUS,
  stampGateDefocusPainting, stampGateDefocusState, stampGateGaussian, stampGateGlowPainting, stampGateGlowState,
} from '../models/stamp-gate-lens.ts';
import { STAMP_GATE_OUTSIDE_SLOT, stampGateOutsideContent, stampGateOutsidePainting } from '../models/stamp-gate-outside-layer.ts';
import type { StampGatePainting } from '../models/stamp-gate-paintings.ts';
import {
  checkStampGateLayerCache, checkStampGateMargin, checkStampGatePan, STAMP_GATE_PARALLAX_ORDER, STAMP_GATE_STAGE_IDS, STAMP_GATE_STAGE_MARGIN, stampGateInsetDifference, stampGateMarginSubjects,
  stampGatePanPainting, stampGateParallaxPainting, stampGateParallaxTime,
} from '../models/stamp-gate-stage.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGateHalfBits } from '../models/stamp-gate-flow.ts';
import { drawn, drawnImages, withGateRenderer, withGateSurface } from './stamp-gate-page-surface.ts';

/** `gate`'s stage, `margin` px past its frame each side. */
const gateStage = (gate: StampGatePainting, margin: number) => stampStage({ width: gate.width, height: gate.height }, margin);

/** `gate`'s frame at `t`, in its frame state then, on a renderer of its own drawing on a stage `margin` px past its frame. */
const frameWithMargin = (gate: StampGatePainting, t: number, margin: number) =>
  withGateRenderer(gate, drawnImages(gate), (renderer, frame) => drawn(renderer, frame, t, gate.frameAt?.(t)), { stage: gateStage(gate, margin) });

/** Lens case `id` (stamp-gate-lens.ts). */
async function checkStampGateLensCase(id: string): Promise<StampGateWashCheck[]> {
  if (id === 'lens/defocus') {
    const gate = stampGateDefocusPainting(), url = drawnImages(gate);
    const frameIn = (state: StampPaintFrameState) => withGateRenderer(gate, url, (renderer, frame) => drawn(renderer, frame, gate.t, state));
    return [checkStampGateDefocus({
      sharp: await frameIn(stampGateDefocusState(undefined)), zero: await frameIn(stampGateDefocusState(0)), blurred: await frameIn(stampGateDefocusState(STAMP_GATE_DEFOCUS_SIGMA)),
      scaledSharp: await frameIn(stampGateDefocusState(undefined, STAMP_GATE_DEFOCUS_SCALE)), scaledBlurred: await frameIn(stampGateDefocusState(STAMP_GATE_DEFOCUS_SIGMA, STAMP_GATE_DEFOCUS_SCALE)),
    })];
  }
  if (id === 'lens/glow') {
    const gate = stampGateGlowPainting(), url = drawnImages(gate);
    const frameIn = (state: StampPaintFrameState) => withGateRenderer(gate, url, (renderer, frame) => drawn(renderer, frame, gate.t, state));
    const pale = stampGateGlowState(['pale'], 0), paleMoved = stampGateGlowState(['pale'], 12);
    const held = await withGateRenderer(gate, url, async (renderer, frame) => ({
      first: await drawn(renderer, frame, gate.t, pale), again: await drawn(renderer, frame, gate.t, pale), afterMove: await drawn(renderer, frame, gate.t, paleMoved),
    }));
    return [checkStampGateGlow({
      plain: await frameIn(stampGateGlowState([], 0)), grey: await frameIn(stampGateGlowState(['grey'], 0)), zero: await frameIn(stampGateGlowState(['pale'], 0, { ...STAMP_GATE_GLOW, amount: 0 })),
      pale: held.first, paleAgain: held.again, paleAfterMove: held.afterMove, paleFresh: await frameIn(paleMoved),
    })];
  }
  if (id === 'lens/outside') {
    const gate = stampGateOutsidePainting('flat'), { width, height } = gate;
    const content = stampGateOutsideContent('a');
    const halves = { sharp: Uint16Array.from(content, stampGateHalfBits), cpuBlurred: Uint16Array.from(stampGateGaussian(content, width, height, 4, STAMP_GATE_OUTSIDE_DEFOCUS, 0), stampGateHalfBits) };
    return withGateSurface(gate, drawnImages(gate), async (surface, frame) => {
      const texture = surface.device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      const renderer = await createStampPaintRenderer(surface, gate.painting, { outsideLayers: [{ ...STAMP_GATE_OUTSIDE_SLOT, texture }] });
      const laid = async (pixels: 'sharp' | 'cpuBlurred', state: Omit<StampOutsideLayerState, 'content'>) => {
        surface.device.queue.writeTexture({ texture }, halves[pixels], { bytesPerRow: width * 8 }, [width, height]);
        await renderer.draw({ t: gate.t, outside: new Map([[STAMP_GATE_OUTSIDE_SLOT.id, { content: pixels, ...state }]]) });
        await renderer.finish();
        return frame();
      };
      const frames = {
        blurred: await laid('sharp', { defocus: STAMP_GATE_OUTSIDE_DEFOCUS }), cpuBlurred: await laid('cpuBlurred', {}), sharp: await laid('sharp', {}), glowing: await laid('sharp', { glow: STAMP_GATE_GLOW }),
      };
      renderer.dispose();
      return [checkStampGateOutsideLens(frames)];
    });
  }
  throw new Error(`stamp gate: no lens case ${JSON.stringify(id)}`);
}

/** Stage case `id` (stamp-gate-stage.ts), or a lens case (stamp-gate-lens.ts). */
export async function checkStampGateStageCase(id: string): Promise<StampGateWashCheck[]> {
  if (id.startsWith('lens/')) return checkStampGateLensCase(id);
  if (id === 'stage/margin') {
    const subjects = await stampGateMarginSubjects().reduce<Promise<{ name: string; difference: StampGateFrameDifference }[]>>(async (done, { name, gate, t }) => [
      ...await done, { name, difference: stampGateInsetDifference(await frameWithMargin(gate, t, 0), await frameWithMargin(gate, t, STAMP_GATE_STAGE_MARGIN), gate.width, gate.height) },
    ], Promise.resolve([]));
    return [checkStampGateMargin(subjects)];
  }
  if (id === 'stage/pan') {
    const panned = stampGatePanPainting('off-frame'), onFrame = stampGatePanPainting('on-frame');
    const shown = await frameWithMargin(panned, panned.t, STAMP_GATE_STAGE_MARGIN), there = await frameWithMargin(onFrame, onFrame.t, 0);
    return [checkStampGatePan({ panned: shown, onFrame: there, bare: await frameWithMargin(panned, panned.t, 0), difference: stampGateFrameDifference(shown, there) })];
  }
  if (id === 'stage/layer-cache') {
    const gate = stampGateParallaxPainting(), url = drawnImages(gate), margin = STAMP_GATE_STAGE_MARGIN;
    let restores = 0;
    const profile = (label: string) => () => {
      if (label === 'stamp paint layer restore') restores++;
    };
    const scrambled = await withGateRenderer(gate, url, (renderer, frame) => STAMP_GATE_PARALLAX_ORDER.reduce<Promise<{ frame: number; rgba: Uint8ClampedArray }[]>>(async (done, k) => {
      const t = stampGateParallaxTime(k);
      return [...await done, { frame: k, rgba: await drawn(renderer, frame, t, gate.frameAt?.(t)) }];
    }, Promise.resolve([])), { stage: gateStage(gate, margin), profile });
    const frames = await scrambled.reduce<Promise<{ frame: number; difference: StampGateFrameDifference }[]>>(async (done, { frame: k, rgba }) => [
      ...await done, { frame: k, difference: stampGateFrameDifference(await frameWithMargin(gate, stampGateParallaxTime(k), margin), rgba) },
    ], Promise.resolve([]));
    return [checkStampGateLayerCache(frames, restores)];
  }
  throw new Error(`stamp gate: no stage case ${JSON.stringify(id)}; the gate holds ${STAMP_GATE_STAGE_IDS.join(', ')}`);
}

