// stamp-gate-stage-page.ts: the gate page's stage, planes, lens and three-plane cases (stamp-gate-stage.ts,
// stamp-gate-lens.ts, stamp-gate-three-plane.ts), drawn on surfaces of their own.

import type { StampPaintFrameState } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { STAMP_SINGLE_PLANE_ID, type StampLensFrame } from '#lib/paint/painting/models/stamp-plane.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { StampPaintFrame, StampPaintRenderer, StampPaintRendererOptions } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import { stampGateFrameDifference, type StampGateFrameDifference } from '../models/stamp-gate-frames.ts';
import {
  checkStampGateDefocus, checkStampGateGlow, STAMP_GATE_DEFOCUS_MARGIN, STAMP_GATE_DEFOCUS_SCALE, STAMP_GATE_DEFOCUS_SIGMA, STAMP_GATE_GLOW, STAMP_GATE_GLOW_COVER_X, STAMP_GATE_GLOW_LENS,
  stampGateDefocusLens, stampGateDefocusPainting, stampGateGlowCoverPlanes, stampGateGlowPainting, stampGateGlowState,
} from '../models/stamp-gate-lens.ts';
import {
  checkStampGateThreeDefocus, checkStampGateThreeDefocusEdge, checkStampGateThreePlane, STAMP_GATE_CARD, STAMP_GATE_THREE_DEFOCUS_LENS, STAMP_GATE_THREE_EDGE_LENS, STAMP_GATE_THREE_IDS,
  stampGateThreeContent, stampGateThreeContentBlurred, stampGateThreeEdgeLayered, stampGateThreeEdgeLayers, stampGateThreeKind, stampGateThreeMotion, stampGateThreePainting, stampGateThreePlanes,
} from '../models/stamp-gate-three-plane.ts';
import {
  checkStampGateThreeStill, STAMP_GATE_THREE_STILL_ID, STAMP_GATE_THREE_STILL_LENS, STAMP_GATE_THREE_STILL_SHUTTER, STAMP_GATE_THREE_STILL_T, stampGateThreeStillContent,
  stampGateThreeStillExposures, stampGateThreeStillPainting, stampGateThreeStillPlanes, stampGateThreeStillState,
} from '../models/stamp-gate-three-still.ts';
import type { StampGatePainting } from '../models/stamp-gate-paintings.ts';
import {
  checkStampGatePicture, STAMP_GATE_PICTURE_DEFOCUS_LENS, STAMP_GATE_PICTURE_ID, stampGatePictureCard, stampGatePictureGround, stampGatePictureOnlyPlanes, stampGatePicturePlanes,
} from '../models/stamp-gate-picture-plane.ts';
import { loadStampPictureSources } from '#lib/paint/painting/studio/stamp-picture-sources.ts';
import { createStampSourcesRenderer } from '#lib/paint/painting/studio/stamp-sources-renderer.ts';
import {
  checkStampGateFilmCache, checkStampGateMargin, checkStampGateOneSheet, checkStampGatePan, checkStampGatePictureCache, STAMP_GATE_PARALLAX_ORDER, STAMP_GATE_PLANES_IDS, STAMP_GATE_STAGE_IDS,
  STAMP_GATE_STAGE_MARGIN, stampGateInsetDifference, stampGateMarginSubjects, stampGateOneSheetPainting, stampGateOneSheetPlanes, stampGatePanPainting, stampGateParallaxPainting,
  stampGateParallaxTime, stampGatePlanesLens, stampGatePlanesOf, stampGatePlanesPainting,
} from '../models/stamp-gate-stage.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import { gpuHalfBits, gpuHalfBitsOf, gpuHalfValue } from '#lib/platform/gpu/models/gpu-half-float.ts';
import { pageSpanEnds } from '#lib/platform/trace/studio/page-trace.ts';
import { drawn, drawnExposures, drawnImages, gateRenderer, withGateRenderer, withGateSurface } from './stamp-gate-page-surface.ts';
import {
  checkStampGateMotion, checkStampGateTransport, STAMP_GATE_MOTION_SHUTTER, STAMP_GATE_MOTION_T, STAMP_GATE_TRANSPORT_ID, STAMP_GATE_TRANSPORT_STEP, stampGateMotionExposures, stampGateMotionFastLens, stampGateMotionPainting, stampGateMotionState, type StampGateMotionKind,
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

/** A trace counting the spans named `label` as they end, and the count so far. */
function stampGateSpanCounter(label: string) {
  const counted = {
    spans: 0,
    trace: () => span,
  };
  const span = pageSpanEnds((name) => {
    if (name === label) counted.spans++;
  });
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
    const t = STAMP_GATE_MOTION_T, opens = t - STAMP_GATE_MOTION_SHUTTER / 2;
    const fast = motionGateFramesDrawn((kind) => [{
      kind: 'fast', t, state: stampGateMotionState(kind, t), lens: stampGateMotionFastLens(kind),
      shutter: { open: { at: opens, state: stampGateMotionState(kind, opens) }, close: { at: opens + STAMP_GATE_MOTION_SHUTTER, state: stampGateMotionState(kind, opens + STAMP_GATE_MOTION_SHUTTER) } },
    }]);
    const reference = motionGateFramesDrawn((kind) => stampGateMotionExposures(kind).map(({ lens, ...exposure }) => ({
      kind: 'exposure', t, state: stampGateMotionState(kind, t), lens, exposure: { ...exposure, state: stampGateMotionState(kind, exposure.at) },
    })));
    const sharp = motionGateFramesDrawn((kind) => [{ kind: 'once', t, state: stampGateMotionState(kind, t) }]);
    const framesOf = async (kind: StampGateMotionKind) => ({ fast: await fast(kind), reference: await reference(kind), sharp: await sharp(kind) });
    return [checkStampGateMotion({ own: await framesOf('own'), pan: await framesOf('pan'), crossed: await framesOf('crossed') }, stampGateMotionPainting('own').width)];
  }
  throw new Error(`stamp gate: no lens case ${JSON.stringify(id)}`);
}

/** A motion-gate frame drawer: `kind`'s painting drawn through the frames `draws` gives it, read back. */
const motionGateFramesDrawn = (draws: (kind: StampGateMotionKind) => StampPaintFrame[]) => (kind: StampGateMotionKind) => {
  const gate = stampGateMotionPainting(kind);
  return withGateRenderer(gate, drawnImages(gate), (renderer, frame) => drawnExposures(renderer, frame, draws(kind)));
};

/**
 * Three-plane case `id` (stamp-gate-three-plane.ts), on one surface, the card's texture written before each frame. A
 * compositor case: the planes without the card; content a, b, a and all clear on one renderer; b on a renderer of its
 * own. A defocus case: the card defocused through the lens, then its content blurred on the CPU, then sharp.
 */
export async function checkStampGateThreeCase(id: string): Promise<StampGateWashCheck[]> {
  if (id === STAMP_GATE_THREE_STILL_ID) return [await checkThreeStillFront()];
  if (id === STAMP_GATE_PICTURE_ID) return checkPictureSource();
  const kind = id === 'three/defocus' || id === 'three/defocus-edge' ? 'flat' : stampGateThreeKind(id);
  if (!kind) throw new Error(`stamp gate: no three-plane case ${JSON.stringify(id)}; the gate has ${[...STAMP_GATE_THREE_IDS, STAMP_GATE_THREE_STILL_ID, STAMP_GATE_PICTURE_ID].join(', ')}`);
  const gate = stampGateThreePainting(kind), { width, height } = gate;
  return withGateSurface(gate, drawnImages(gate), async (surface, frame) => {
    const { device } = surface.owner;
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
    const texture = device.createTexture({ size: [width, height], format: 'rgba16float', usage }), motion = device.createTexture({ size: [width, height], format: 'rgba16float', usage });
    // The card's texture is written before each frame, so its render does nothing, and nothing in it moves.
    const card = { kind: 'three' as const, picture: { texture, motion, at: { x: 0, y: 0 } }, render: async () => ({ moved: false }) };
    const withCard = async <T,>(use: (renderer: StampPaintRenderer) => Promise<T>) => {
      const renderer = await gateRenderer(gate, surface, { planes: stampGateThreePlanes(gate.painting, { card: true }), sources: new Map([[STAMP_GATE_CARD, card]]) });
      try {
        return await use(renderer);
      } finally {
        renderer.dispose();
      }
    };
    // Every texel of `content` at the card's one distance, unless `distances` gives its own motion layer.
    const laid = (renderer: StampPaintRenderer, content: Float32Array | Float64Array, lens?: StampLensFrame, distances?: Float32Array) => {
      device.queue.writeTexture({ texture }, Uint16Array.from(content, gpuHalfBits), { bytesPerRow: width * 8 }, [width, height]);
      device.queue.writeTexture({ texture: motion }, Uint16Array.from(distances ?? stampGateThreeMotion(Float32Array.from(content)), gpuHalfBits), { bytesPerRow: width * 8 }, [width, height]);
      return drawn(renderer, frame, gate.t, undefined, lens);
    };
    const a = stampGateThreeContent('a');
    if (id === 'three/defocus') {
      const cpuBlurred = stampGateThreeContentBlurred();
      return withCard(async (renderer) => [checkStampGateThreeDefocus({
        blurred: await laid(renderer, a, STAMP_GATE_THREE_DEFOCUS_LENS), cpuBlurred: await laid(renderer, cpuBlurred), sharp: await laid(renderer, a),
      })]);
    }
    if (id === 'three/defocus-edge') {
      const { content, motion: distances } = stampGateThreeEdgeLayers(), layered = stampGateThreeEdgeLayered();
      return withCard(async (renderer) => [checkStampGateThreeDefocusEdge({
        blurred: await laid(renderer, content, STAMP_GATE_THREE_EDGE_LENS, distances), layered: await laid(renderer, layered), sharp: await laid(renderer, content),
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

/**
 * The picture case (stamp-gate-picture-plane.ts), on one surface: the card as a picture plane and as a three plane of
 * the same content, each sharp and defocused; then the scene of pictures alone with the card and without it.
 */
async function checkPictureSource(): Promise<StampGateWashCheck[]> {
  const gate = stampGateThreePainting('flat'), { width, height } = gate;
  return withGateSurface(gate, drawnImages(gate), async (surface, frame) => {
    const { device } = surface.owner;
    const sharpAndBlurred = async (options: StampPaintRendererOptions) => {
      const renderer = await gateRenderer(gate, surface, options);
      try {
        return { sharp: await drawn(renderer, frame, gate.t), blurred: await drawn(renderer, frame, gate.t, undefined, STAMP_GATE_PICTURE_DEFOCUS_LENS) };
      } finally {
        renderer.dispose();
      }
    };
    const pictureCard = stampGatePictureCard();
    const asPicture = loadStampPictureSources(surface.owner.webgpu, new Map([[STAMP_GATE_CARD, async () => pictureCard]]));
    const picture = await sharpAndBlurred({ planes: stampGatePicturePlanes(gate.painting), sources: asPicture.sources });
    asPicture.dispose();

    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
    const texture = device.createTexture({ size: [width, height], format: 'rgba16float', usage }), motion = device.createTexture({ size: [width, height], format: 'rgba16float', usage });
    const content = stampGateThreeContent('a');
    device.queue.writeTexture({ texture }, gpuHalfBitsOf(content), { bytesPerRow: width * 8 }, [width, height]);
    device.queue.writeTexture({ texture: motion }, gpuHalfBitsOf(stampGateThreeMotion(content)), { bytesPerRow: width * 8 }, [width, height]);
    const card = { kind: 'three' as const, picture: { texture, motion, at: { x: 0, y: 0 } }, render: async () => ({ moved: false }) };
    const three = await sharpAndBlurred({ planes: stampGateThreePlanes(gate.painting, { card: true }), sources: new Map([[STAMP_GATE_CARD, card]]) });
    texture.destroy();
    motion.destroy();

    const ground = stampGatePictureGround();
    const aloneDrawn = async (withCard: boolean) => {
      const alone = loadStampPictureSources(surface.owner.webgpu, new Map([['ground', async () => ground], [STAMP_GATE_CARD, async () => (withCard ? pictureCard : null)]]));
      const renderer = await createStampSourcesRenderer(surface, { stage: stampStage({ width, height }, 0), planes: stampGatePictureOnlyPlanes(), sources: alone.sources });
      try {
        await renderer.draw({ kind: 'once', t: 0 });
        await renderer.finish();
        return frame();
      } finally {
        renderer.dispose();
        alone.dispose();
      }
    };
    return checkStampGatePicture({ picture, three, alone: await aloneDrawn(true), aloneClear: await aloneDrawn(false) });
  });
}

/**
 * The still-front case (stamp-gate-three-still.ts): the card's patch written once, still, before a stroke that moves;
 * drawn fast, as the reference's exposures and sharp.
 */
async function checkThreeStillFront(): Promise<StampGateWashCheck> {
  const gate = stampGateThreeStillPainting(), { width, height } = gate, t = STAMP_GATE_THREE_STILL_T, opens = t - STAMP_GATE_THREE_STILL_SHUTTER / 2;
  return withGateSurface(gate, drawnImages(gate), async (surface, frame) => {
    const { device } = surface.owner;
    const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;
    const texture = device.createTexture({ size: [width, height], format: 'rgba16float', usage }), motion = device.createTexture({ size: [width, height], format: 'rgba16float', usage });
    const content = stampGateThreeStillContent();
    device.queue.writeTexture({ texture }, Uint16Array.from(content, gpuHalfBits), { bytesPerRow: width * 8 }, [width, height]);
    device.queue.writeTexture({ texture: motion }, Uint16Array.from(stampGateThreeMotion(content), gpuHalfBits), { bytesPerRow: width * 8 }, [width, height]);
    const card = { kind: 'three' as const, picture: { texture, motion, at: { x: 0, y: 0 } }, render: async () => ({ moved: false }) };
    const drawnAs = async (draws: StampPaintFrame[]) => {
      const renderer = await gateRenderer(gate, surface, { planes: stampGateThreeStillPlanes(gate.painting), sources: new Map([[STAMP_GATE_CARD, card]]) });
      try {
        return await drawnExposures(renderer, frame, draws);
      } finally {
        renderer.dispose();
      }
    };
    const lens = STAMP_GATE_THREE_STILL_LENS, state = stampGateThreeStillState(t), closes = opens + STAMP_GATE_THREE_STILL_SHUTTER;
    const fast = await drawnAs([{ kind: 'fast', t, state, lens, shutter: { open: { at: opens, state: stampGateThreeStillState(opens) }, close: { at: closes, state: stampGateThreeStillState(closes) } } }]);
    const reference = await drawnAs(stampGateThreeStillExposures().map((exposure) => ({ kind: 'exposure', t, state, lens, exposure: { ...exposure, state: stampGateThreeStillState(exposure.at) } })));
    const sharp = await drawnAs([{ kind: 'fast', t, state, lens, shutter: null }]);
    return checkStampGateThreeStill({ fast, reference, sharp });
  });
}

/** A transport layer read back as rgba floats, row by row. */
async function readTransportLayer(device: GPUDevice, texture: GPUTexture): Promise<Float32Array> {
  const rowBytes = Math.ceil((texture.width * 8) / 256) * 256, read = device.createBuffer({ size: rowBytes * texture.height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer: read, bytesPerRow: rowBytes }, [texture.width, texture.height]);
  device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const halves = new Uint16Array(read.getMappedRange()), values = new Float32Array(texture.width * texture.height * 4);
  for (let y = 0; y < texture.height; y++) for (let i = 0; i < texture.width * 4; i++) values[y * texture.width * 4 + i] = gpuHalfValue(halves[y * (rowBytes / 2) + i]);
  read.destroy();
  return values;
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
    const scrambled = await framesInOrder(gate, STAMP_GATE_PARALLAX_ORDER, { stage, trace: restores.trace });
    return [checkStampGateFilmCache(await againstFresh(gate, scrambled, { stage }), restores.spans)];
  }
  if (id === 'planes/cache') {
    const gate = stampGatePlanesPainting(), options = { stage: gateStage(gate, STAMP_GATE_STAGE_MARGIN), planes: stampGatePlanesOf(gate.painting) };
    const restores = stampGateSpanCounter('stamp paint picture restore');
    const scrambled = await framesInOrder(gate, STAMP_GATE_PARALLAX_ORDER, { ...options, trace: restores.trace }, stampGatePlanesLens);
    return [checkStampGatePictureCache(await againstFresh(gate, scrambled, options, stampGatePlanesLens), restores.spans)];
  }
  if (id === STAMP_GATE_TRANSPORT_ID) {
    const gate = stampGateMotionPainting('own'), t = STAMP_GATE_MOTION_T, from = t - STAMP_GATE_TRANSPORT_STEP;
    return [await withGateSurface(gate, drawnImages(gate), async (surface) => {
      const renderer = await gateRenderer(gate, surface, { stage: gateStage(gate, STAMP_GATE_STAGE_MARGIN) });
      try {
        const layers = await renderer.transport({ t, state: stampGateMotionState('own', t), from: { at: from, state: stampGateMotionState('own', from) }, to: { at: t, state: stampGateMotionState('own', t) } });
        return checkStampGateTransport(await readTransportLayer(surface.owner.webgpu, layers.get(STAMP_SINGLE_PLANE_ID)!), gate.width, renderer.stage.margin);
      } finally {
        renderer.dispose();
      }
    })];
  }
  if (id === 'planes/one-sheet') {
    const gate = stampGateOneSheetPainting(), url = drawnImages(gate);
    const frameOn = (options: StampPaintRendererOptions) => withGateRenderer(gate, url, (renderer, frame) => drawn(renderer, frame, gate.t), options);
    return [checkStampGateOneSheet({ planes: await frameOn({ planes: stampGateOneSheetPlanes(gate.painting) }), sheet: await frameOn({}) })];
  }
  throw new Error(`stamp gate: no stage case ${JSON.stringify(id)}; the gate holds ${[...STAMP_GATE_STAGE_IDS, ...STAMP_GATE_PLANES_IDS].join(', ')}`);
}
