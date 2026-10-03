// stamp-gate-reductions-page.ts: the reductions of schedule/reductions (stamp-gate-sheets.ts), run alone on a device
// of their own over textures written here and read back as the sheet solver reads them: a fully touched core's weight
// in its two words, and a damp histogram refined to 1 ms against the closed form's step.

import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import {
  STAMP_DAMP_HISTOGRAM_WORDS, STAMP_SHEET_SHARE, STAMP_SHEET_TOTALS, STAMP_SHEET_WEIGHT, stampDampFirstStep, stampDampFirstWidth, stampDampHistogram, stampDampStep, stampSheetTotals,
} from '#lib/paint/painting/models/stamp-sheet-schedule.ts';
import { stampDrying } from '#lib/paint/painting/models/stamp-wetness.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampSheetReductions, type StampSheetCore, type StampSheetReduceTextures } from '#lib/paint/painting/studio/stamp-sheet-reductions.ts';
import { createStampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import { requestStudioGpuDevice } from '#lib/platform/gpu/studio/gpu-device-owner.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';

const DRYING = stampDrying(PAINT_MEDIA.watercolour.wetting, { color: '#ffffff' });
const SIDE = 256;
/** The largest document's side: its core, fully touched, totals 2⁴². */
const LARGEST = 8192;

/** A size² r16float touch target, every texel touched wholly once `encoder` runs. */
function wholeTouch(device: GPUDevice, encoder: GPUCommandEncoder, size: number): GPUTextureView {
  const view = device.createTexture({ size: [size, size], format: 'r16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }).createView();
  encoder.beginRenderPass({ colorAttachments: [{ view, clearValue: [1, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] }).end();
  return view;
}

const single = (device: GPUDevice, format: GPUTextureFormat) => device.createTexture({ size: [1, 1], format, usage: GPUTextureUsage.TEXTURE_BINDING }).createView();

/** `count` words from what `work` writes into a cleared storage buffer, read back. */
async function wordsFrom(device: GPUDevice, count: number, work: (encoder: GPUCommandEncoder, words: GPUBuffer) => void): Promise<Uint32Array> {
  const storage = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const read = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const encoder = device.createCommandEncoder();
  encoder.clearBuffer(storage);
  work(encoder, storage);
  encoder.copyBufferToBuffer(storage, 0, read, 0, count * 4);
  device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const words = new Uint32Array(read.getMappedRange().slice(0));
  read.destroy();
  storage.destroy();
  return words;
}

/** The reductions over `paper` (and a whole touch of `size`²), each pass's uniform its own slot. */
function reductionsOver(device: GPUDevice, encoder: GPUCommandEncoder, size: number, paper: GPUTextureView) {
  const arena = createStampUniformArena(device, 1);
  const textures: StampSheetReduceTextures = { core: wholeTouch(device, encoder, size), clip: single(device, 'rgba16float'), paper, open: single(device, 'r32float'), blank: single(device, 'r8unorm') };
  return { arena, reductions: stampSheetReductions(device, stampStage({ width: size, height: size }), arena, textures) };
}

const wholeCore = (size: number): StampSheetCore => ({ box: { x: 0, y: 0, w: size, h: size }, fluid: null, within: null, clipped: false });

/** A fully touched `size`² core's weight words (low, high). The weight reads no paper, so a texel of it does. */
async function wholeWeight(device: GPUDevice, size: number): Promise<{ lo: number; hi: number }> {
  const words = await wordsFrom(device, STAMP_SHEET_TOTALS.words, (encoder, storage) => {
    const { arena, reductions } = reductionsOver(device, encoder, size, single(device, 'rgba32float'));
    reductions.totals(encoder, storage, { core: wholeCore(size), tau: 0, drying: DRYING }, null);
    arena.flush();
  });
  return { lo: words[STAMP_SHEET_TOTALS.weight], hi: words[STAMP_SHEET_TOTALS.weight + 1] };
}

/** Each texel's matte step: half a step past one of 10,000 a millisecond apart, 1 s on, so no f32 rounding moves it. */
const matteStepOf = (i: number) => (i * 7919) % 10_000;

/**
 * A damp histogram over SIDE² texels turning matte across 10 s, refined until its bins are 1 ms: the step it finds,
 * the f64 closed form's, and the narrowest bins it read.
 */
async function dampSearch(device: GPUDevice) {
  const levels = new Float32Array(SIDE * SIDE * 4);
  for (let i = 0; i < SIDE * SIDE; i++) levels[i * 4] = DRYING.damp + DRYING.rate * (1 + (matteStepOf(i) + 0.5) / 1000);
  const paper = device.createTexture({ size: [SIDE, SIDE], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: paper }, levels, { bytesPerRow: SIDE * 16 }, [SIDE, SIDE]);
  const probe = { core: wholeCore(SIDE), tau: 0, drying: DRYING };
  const over = (work: (reductions: ReturnType<typeof stampSheetReductions>, encoder: GPUCommandEncoder, storage: GPUBuffer) => void, count: number) =>
    wordsFrom(device, count, (encoder, storage) => {
      const { arena, reductions } = reductionsOver(device, encoder, SIDE, paper.createView());
      work(reductions, encoder, storage);
      arena.flush();
    });
  const totals = stampSheetTotals(await over((reductions, encoder, storage) => reductions.totals(encoder, storage, probe, null), STAMP_SHEET_TOTALS.words), 0);
  let narrowest = Infinity;
  const binned = async ({ start, width }: { start: number; width: number }) => {
    narrowest = Math.min(narrowest, width);
    return stampDampHistogram(await over((reductions, encoder, storage) => reductions.histogram(encoder, storage, probe, start, width), STAMP_DAMP_HISTOGRAM_WORDS), start, width);
  };
  const first = await binned({ start: 0, width: stampDampFirstWidth(stampDampStep(totals.latestSet!, 0)) });
  const { step } = await stampDampFirstStep(first, STAMP_SHEET_SHARE * totals.weight, binned);
  // Nothing sets within 84 s of turning matte, so damp weight at a step is all turned matte by it.
  const steps = Array.from({ length: SIDE * SIDE }, (_, i) => 1001 + matteStepOf(i)).toSorted((a, b) => a - b);
  return { step, expected: steps[Math.ceil(STAMP_SHEET_SHARE * SIDE * SIDE) - 1], narrowest };
}

/** A fully touched `size`² core's weight. */
const wholeWeightOf = (size: number) => size * size * STAMP_SHEET_WEIGHT;

/** schedule/reductions' reductions: exact two-word totals at 256² and 8192², and the damp search's step. */
export async function checkStampGateReductions(): Promise<StampGateWashCheck[]> {
  const device = await requestStudioGpuDevice();
  try {
    device.pushErrorScope('validation');
    const small = await wholeWeight(device, SIDE), large = await wholeWeight(device, LARGEST), damp = await dampSearch(device);
    const error = await device.popErrorScope();
    if (error) throw new Error(`stamp gate reductions: ${error.message}`);
    const id = 'schedule/reductions';
    return [
      { id: `${id}: 256²`, passed: small.hi === 1 && small.lo === 0, detail: `high ${small.hi}, low ${small.lo}: ${small.hi * 2 ** 32 + small.lo}, needs ${wholeWeightOf(SIDE)}` },
      { id: `${id}: 8192²`, passed: large.hi === 2 ** 10 && large.lo === 0, detail: `high ${large.hi}, low ${large.lo}: ${large.hi * 2 ** 32 + large.lo}, needs ${wholeWeightOf(LARGEST)}` },
      { id: `${id}: damp histogram`, passed: damp.step === damp.expected && damp.narrowest === 1, detail: `step ${damp.step}, the closed form's ${damp.expected}, bins refined to ${damp.narrowest} step` },
    ];
  } finally {
    device.destroy();
  }
}
