// stamp-gate-stage-page.ts: the gate page's stage, planes, lens and three-plane cases (stamp-gate-stage.ts,
// stamp-gate-lens.ts, stamp-gate-three-plane.ts), drawn on surfaces of their own.

import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { StampLensFrame } from '#lib/paint/painting/models/stamp-plane.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { StampPaintFrame, StampPaintRenderer, StampPaintRendererOptions } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { stampGateFrameDifference, type StampGateFrameDifference } from '../models/stamp-gate-frames.ts';
import {
  checkStampGateDefocus, checkStampGateGlow, STAMP_GATE_DEFOCUS_MARGIN, STAMP_GATE_DEFOCUS_SCALE, STAMP_GATE_DEFOCUS_SIGMA, STAMP_GATE_GLOW, STAMP_GATE_GLOW_COVER_X, STAMP_GATE_GLOW_LENS,
  stampGateDefocusLens, stampGateDefocusPainting, stampGateGlowCoverPlanes, stampGateGlowPainting, stampGateGlowState,
} from '../models/stamp-gate-lens.ts';
import {
  checkStampGateThreeDefocus, checkStampGateThreePlane, STAMP_GATE_CARD, STAMP_GATE_THREE_DEFOCUS_LENS, STAMP_GATE_THREE_IDS, stampGateThreeContent, stampGateThreeContentBlurred, stampGateThreeKind, stampGateThreeMotion,
  stampGateThreePainting, stampGateThreePlanes,
} from '../models/stamp-gate-three-plane.ts';
import type { StampGatePainting } from '../models/stamp-gate-paintings.ts';
import {
  checkStampGateFilmCache, checkStampGateMargin, checkStampGateOneSheet, checkStampGatePan, checkStampGatePictureCache, STAMP_GATE_PARALLAX_ORDER, STAMP_GATE_PLANES_IDS, STAMP_GATE_STAGE_IDS,
  STAMP_GATE_STAGE_MARGIN, stampGateInsetDifference, stampGateMarginSubjects, stampGateOneSheetPainting, stampGateOneSheetPlanes, stampGatePanPainting, stampGateParallaxPainting,
  stampGateParallaxTime, stampGatePlanesLens, stampGatePlanesOf, stampGatePlanesPainting,
} from '../models/stamp-gate-stage.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { stampGateHalfBits } from '../models/stamp-gate-flow.ts';
import { drawn, drawnExposures, drawnImages, gateRenderer, withGateRenderer, withGateSurface } from './stamp-gate-page-surface.ts';
import {
  checkStampGateMotion, STAMP_GATE_MOTION_SHUTTER, STAMP_GATE_MOTION_T, stampGateMotionExposures, stampGateMotionFastLens, stampGateMotionPainting, stampGateMotionState, type StampGateMotionKind,
} from '../models/stamp-gate-motion.ts';

/** `gate`'s stage, `margin` px past its frame each side. */
const gateStage = (gate: StampGatePainting, margin: number) => stampStage({ width: gate.width, height: gate.height }, margin);

/** `gate`'s frame at `t`, in its frame state then, on a renderer of its own drawing on a stage `margin` px past its frame. */
const frameWithMargin = (gate: StampGatePainting, t: number, margin: number) =>
  withGateRenderer(gate, drawnImages(gate), (renderer, frame) => drawn(renderer, frame, t, gate.frameAt?.(t)), { stage: gateStage(gate, margin) });

type StampGateOrderedFrame = { frame: number; rgba: Uint8ClampedArray };

/**
 * Frames `order` of `gate` drawn in turn by one renderer made with `options`, frame k at stampGateParallaxTime(k) in
 * its frame state then, through `lensOf(k)` when given.
 */
const framesInOrder = (gate: StampGatePainting, order: readonly number[], options: StampPaintRendererOptions, lensOf?: (k: number) => StampLensFrame) =>
  withGateRenderer(gate, drawnImages(gate), (renderer, frame) => order.reduce<Promise<StampGateOrderedFrame[]>>(async (done, k) => {
    const t = stampGateParallaxTime(k);
    return [...await done, { frame: k, rgba: await drawn(renderer, frame, t, gate.frameAt?.(t), lensOf?.(k)) }];
  }, Promise.resolve([])), options);

/** How each of `drawnFrames` differs from the frame a fresh renderer made with `options` draws, through `lensOf(k)` when given. */
const againstFresh = (gate: StampGatePainting, drawnFrames: readonly StampGateOrderedFrame[], options: StampPaintRendererOptions, lensOf?: (k: number) => StampLensFrame) =>
  drawnFrames.reduce<Promise<{ frame: number; difference: StampGateFrameDifference }[]>>(async (done, { frame: k, rgba }) => {
    const [fresh] = await framesInOrder(gate, [k], options, lensOf);
    return [...await done, { frame: k, difference: stampGateFrameDifference(fresh.rgba, rgba) }];
  }, Promise.resolve([]));

/** A profile counting the spans labelled `label` as they end, and the count so far. */
function stampGateSpanCounter(label: string) {
  const counted = {
    spans: 0,
    profile: (span: string) => () => {
      if (span === label) counted.spans++;
    },
  };
  return counted;
}

/** Lens case `id` (stamp-gate-lens.ts). */
async function checkStampGateLensCase(id: string): Promise<StampGateWashCheck[]> {
  if (id === 'lens/defocus') {
    const gate = stampGateDefocusPainting(), url = drawnImages(gate), stage = gateStage(gate, STAMP_GATE_DEFOCUS_MARGIN);
    const frameThrough = (lens?: StampLensFrame) => withGateRenderer(gate, url, (renderer, frame) => drawn(renderer, frame, gate.t, undefined, lens), { stage });
    return [checkStampGateDefocus({
      sharp: await frameThrough(), zero: await frameThrough(stampGateDefocusLens(0)), blurred: await frameThrough(stampGateDefocusLens(STAMP_GATE_DEFOCUS_SIGMA)),
      scaledSharp: await frameThrough(stampGateDefocusLens(0, STAMP_GATE_DEFOCUS_SCALE)), scaledBlurred: await frameThrough(stampGateDefocusLens(STAMP_GATE_DEFOCUS_SIGMA, STAMP_GATE_DEFOCUS_SCALE)),
    })];
  }
  if (id === 'lens/glow') {
    const gate = stampGateGlowPainting(), url = drawnImages(gate);
    const frameIn = (state: StampPaintFrameState, options: StampPaintRendererOptions = {}) =>
      withGateRenderer(gate, url, (renderer, frame) => drawn(renderer, frame, gate.t, state, STAMP_GATE_GLOW_LENS), options);
    const pale = stampGateGlowState(['pale'], 0), paleMoved = stampGateGlowState(['pale'], 12);
    const held = await withGateRenderer(gate, url, async (renderer, frame) => ({
      first: await drawn(renderer, frame, gate.t, pale, STAMP_GATE_GLOW_LENS), again: await drawn(renderer, frame, gate.t, pale, STAMP_GATE_GLOW_LENS),
      afterMove: await drawn(renderer, frame, gate.t, paleMoved, STAMP_GATE_GLOW_LENS),
    }));
    const covering = { planes: stampGateGlowCoverPlanes(gate.painting) }, greyX = STAMP_GATE_GLOW_COVER_X;
    return [checkStampGateGlow({
      plain: await frameIn(stampGateGlowState([], 0)), grey: await frameIn(stampGateGlowState(['grey'], 0)), zero: await frameIn(stampGateGlowState(['pale'], 0, { glow: { ...STAMP_GATE_GLOW, amount: 0 } })),
      pale: held.first, paleAgain: held.again, paleAfterMove: held.afterMove, paleFresh: await frameIn(paleMoved),
      covered: await frameIn(stampGateGlowState(['pale'], 0, { greyX }), covering), coveredPlain: await frameIn(stampGateGlowState([], 0, { greyX }), covering),
      // The grey, laid after the pale on the one plane, glows under its threshold: drawn the way the glowing frame is.
      onSheet: await frameIn(stampGateGlowState(['pale'], 0, { greyX })), onSheetDim: await frameIn(stampGateGlowState(['grey'], 0, { greyX })),
    })];
  }
  if (id === 'lens/motion') {
    const gate = stampGateMotionPainting(), url = drawnImages(gate), t = STAMP_GATE_MOTION_T, opens = t - STAMP_GATE_MOTION_SHUTTER / 2;
    const frameOf = (draws: (kind: StampGateMotionKind) => StampPaintFrame[]) => (kind: StampGateMotionKind) =>
      withGateRenderer(gate, url, (renderer, frame) => drawnExposures(renderer, frame, draws(kind)));
    const fast = frameOf((kind) => [{
      t, state: stampGateMotionState(kind, t), lens: stampGateMotionFastLens(kind),
      shutter: { open: { at: opens, state: stampGateMotionState(kind, opens) }, close: { at: opens + STAMP_GATE_MOTION_SHUTTER, state: stampGateMotionState(kind, opens + STAMP_GATE_MOTION_SHUTTER) } },
    }]);
    const reference = frameOf((kind) => stampGateMotionExposures(kind).map(({ lens, ...exposure }) => ({
      t, state: stampGateMotionState(kind, t), lens, exposure: { ...exposure, state: stampGateMotionState(kind, exposure.at) },
    })));
    const sharp = frameOf((kind) => [{ t, state: stampGateMotionState(kind, t) }]);
    const framesOf = async (kind: StampGateMotionKind) => ({ fast: await fast(kind), reference: await reference(kind), sharp: await sharp(kind) });
    return [checkStampGateMotion({ own: await framesOf('own'), pan: await framesOf('pan') }, gate.width)];
  }
  throw new Error(`stamp gate: no lens case ${JSON.stringify(id)}`);
}

/**
 * Three-plane case `id` (stamp-gate-three-plane.ts), on one surface, the card's texture written before each frame. A
 * compositor case: the planes without the card; content a, b, a and all clear on one renderer; b on a renderer of its
 * own. The defocus case: the card defocused through the lens, then its content blurred on the CPU, then sharp.
 */
export async function checkStampGateThreeCase(id: string): Promise<StampGateWashCheck[]> {
  const kind = id === 'three/defocus' ? 'flat' : stampGateThreeKind(id);
  if (!kind) throw new Error(`stamp gate: no three-plane case ${JSON.stringify(id)}; the gate has ${STAMP_GATE_THREE_IDS.join(', ')}`);
  const gate = stampGateThreePainting(kind), { width, height } = gate;
  return withGateSurface(gate, drawnImages(gate), async (surface, frame) => {
    const { device } = surface.owner;
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
    const texture = device.createTexture({ size: [width, height], format: 'rgba16float', usage }), motion = device.createTexture({ size: [width, height], format: 'rgba16float', usage });
    const withCard = async <T,>(use: (renderer: StampPaintRenderer) => Promise<T>) => {
      const renderer = await gateRenderer(gate, surface, { planes: stampGateThreePlanes(gate.painting, { card: true }), three: new Map([[STAMP_GATE_CARD, { texture, motion, at: { x: 0, y: 0 } }]]) });
      try {
        return await use(renderer);
      } finally {
        renderer.dispose();
      }
    };
    const laid = (renderer: StampPaintRenderer, content: Float32Array | Float64Array, lens?: StampLensFrame) => {
      device.queue.writeTexture({ texture }, Uint16Array.from(content, stampGateHalfBits), { bytesPerRow: width * 8 }, [width, height]);
      device.queue.writeTexture({ texture: motion }, Uint16Array.from(stampGateThreeMotion(Float32Array.from(content)), stampGateHalfBits), { bytesPerRow: width * 8 }, [width, height]);
      return drawn(renderer, frame, gate.t, undefined, lens);
    };
    const a = stampGateThreeContent('a');
    if (id === 'three/defocus') {
      const cpuBlurred = stampGateThreeContentBlurred();
      return withCard(async (renderer) => [checkStampGateThreeDefocus({
        blurred: await laid(renderer, a, STAMP_GATE_THREE_DEFOCUS_LENS), cpuBlurred: await laid(renderer, cpuBlurred), sharp: await laid(renderer, a),
      })]);
    }
    const b = stampGateThreeContent('b'), clear = new Float32Array(width * height * 4);
    const plainRenderer = await gateRenderer(gate, surface, { planes: stampGateThreePlanes(gate.painting, { card: false }) });
    const plain = await drawn(plainRenderer, frame, gate.t);
    plainRenderer.dispose();
    const inTurn = await withCard(async (renderer) => ({ a: await laid(renderer, a), b: await laid(renderer, b), aAgain: await laid(renderer, a), clear: await laid(renderer, clear) }));
    const bFresh = await withCard((renderer) => laid(renderer, b));
    return checkStampGateThreePlane(kind, { plain, ...inTurn, bFresh });
  });
}

/** Stage or planes case `id` (stamp-gate-stage.ts), or a lens case (stamp-gate-lens.ts). */
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
  if (id === 'stage/film-cache') {
    const gate = stampGateParallaxPainting(), stage = gateStage(gate, STAMP_GATE_STAGE_MARGIN), restores = stampGateSpanCounter('stamp paint film restore');
    const scrambled = await framesInOrder(gate, STAMP_GATE_PARALLAX_ORDER, { stage, profile: restores.profile });
    return [checkStampGateFilmCache(await againstFresh(gate, scrambled, { stage }), restores.spans)];
  }
  if (id === 'planes/cache') {
    const gate = stampGatePlanesPainting(), options = { stage: gateStage(gate, STAMP_GATE_STAGE_MARGIN), planes: stampGatePlanesOf(gate.painting) };
    const restores = stampGateSpanCounter('stamp paint picture restore');
    const scrambled = await framesInOrder(gate, STAMP_GATE_PARALLAX_ORDER, { ...options, profile: restores.profile }, stampGatePlanesLens);
    return [checkStampGatePictureCache(await againstFresh(gate, scrambled, options, stampGatePlanesLens), restores.spans)];
  }
  if (id === 'planes/one-sheet') {
    const gate = stampGateOneSheetPainting(), url = drawnImages(gate);
    const frameOn = (options: StampPaintRendererOptions) => withGateRenderer(gate, url, (renderer, frame) => drawn(renderer, frame, gate.t), options);
    return [checkStampGateOneSheet({ planes: await frameOn({ planes: stampGateOneSheetPlanes(gate.painting) }), sheet: await frameOn({}) })];
  }
  throw new Error(`stamp gate: no stage case ${JSON.stringify(id)}; the gate holds ${[...STAMP_GATE_STAGE_IDS, ...STAMP_GATE_PLANES_IDS].join(', ')}`);
}
