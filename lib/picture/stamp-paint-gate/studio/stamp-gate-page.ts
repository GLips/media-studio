// stamp-gate-page.ts: the GPU gate's browser side, run by engine/stamp-gate.ts through withBrowserModulePage. It runs
// the formula grids (stamp-gate-formulas.ts) on the renderer's own WGSL, paints the gate's paintings
// (stamp-gate-paintings.ts) with the studio's renderer, and holds a traced resolve to the frame it draws. Paintings are
// built here, as a compiled painting's typed arrays don't survive the trip from Node.

import { PAINT_KUBELKA_MUNK_WGSL } from '#lib/picture/paint/models/paint-kubelka-munk.ts';
import { PAINT_PAPER_WGSL } from '#lib/picture/paint/models/paint-paper.ts';
import { COVERAGE_FORMULAS_WGSL } from '#lib/picture/stamp-paint/models/coverage-formulas.ts';
import { STAMP_ACCUMULATION_LAY_WGSL, STAMP_ACCUMULATION_RESOLVE_WGSL } from '#lib/picture/stamp-paint/models/stamp-deposit-stages.ts';
import { STAMP_WASH_FRONT_SHARE_WGSL } from '#lib/picture/stamp-paint/models/stamp-fill.ts';
import { STAMP_PAINT_FIELD_SHARE } from '#lib/picture/stamp-paint/models/stamp-paint-field.ts';
import { STAMP_GRID_AT_WGSL, STAMP_POLYGON_DISTANCE_WGSL, STAMP_REGION_WGSL } from '#lib/picture/stamp-paint/models/stamp-region.ts';
import { createStampPaintDevice } from '#lib/picture/stamp-paint/studio/stamp-paint-gpu.ts';
import type { StampBrush } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { createStampPaintRenderer, type StampPaintRenderer } from '#lib/picture/stamp-paint/studio/stamp-paint-renderer.ts';
import { stampGatePrivatePainting, type StampGatePrivateCase } from '../models/stamp-gate-private-cases.ts';
import { stampGateFrameDifference, type StampGateFrameDifference } from '../models/stamp-gate-frames.ts';
import { stampGatePainting, stampGateTracePainting, type StampGateImage, type StampGatePainting } from '../models/stamp-gate-paintings.ts';

const WORKGROUP = 64;

/** A formula grid as the page is handed it: its call, row width and rows, and the storage its call reads. */
type PageGrid = { call: string; width: number; rows: number[]; points?: number[]; grid?: number[] };

const kernel = ({ call, width, points, grid }: PageGrid) => /* wgsl */ `
${COVERAGE_FORMULAS_WGSL}
${PAINT_KUBELKA_MUNK_WGSL}
${PAINT_PAPER_WGSL}
${STAMP_ACCUMULATION_LAY_WGSL}
${STAMP_ACCUMULATION_RESOLVE_WGSL}
${STAMP_REGION_WGSL}
${STAMP_PAINT_FIELD_SHARE.wgsl}
${STAMP_WASH_FRONT_SHARE_WGSL}
@group(0) @binding(0) var<storage, read> inputs: array<f32>;
@group(0) @binding(1) var<storage, read_write> outputs: array<f32>;
${points ? `@group(0) @binding(2) var<storage, read> points: array<vec2f>;\n${STAMP_POLYGON_DISTANCE_WGSL}` : ''}
${grid ? `@group(0) @binding(3) var<storage, read> grid: array<f32>;\n${STAMP_GRID_AT_WGSL}` : ''}
var<private> row: u32;
fn x(i: u32) -> f32 { return inputs[row * ${width}u + i]; }
@compute @workgroup_size(${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&outputs)) { return; }
  row = id.x;
  outputs[id.x] = ${call};
}`;

/** Each grid's results, row by row, from the GPU. */
async function runStampGateFormulas(grids: readonly PageGrid[]): Promise<number[][]> {
  const device = await createStampPaintDevice();
  try {
    device.pushErrorScope('validation');
    const storage = (values: readonly number[]) => {
      const buffer = device.createBuffer({ size: Math.max(16, values.length * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, new Float32Array(values));
      return buffer;
    };
    const results = await Promise.all(grids.map(async (grid) => {
      const count = grid.rows.length / grid.width;
      const output = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const read = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: kernel(grid) }) } });
      // Only what the call reads is in the automatic layout, so only that is bound.
      const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: storage(grid.rows) } }, { binding: 1, resource: { buffer: output } }];
      if (grid.points) entries.push({ binding: 2, resource: { buffer: storage(grid.points) } });
      if (grid.grid) entries.push({ binding: 3, resource: { buffer: storage(grid.grid) } });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries }));
      pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP));
      pass.end();
      encoder.copyBufferToBuffer(output, 0, read, 0, count * 4);
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      return Array.from(new Float32Array(read.getMappedRange()));
    }));
    const error = await device.popErrorScope();
    if (error) throw new Error(`stamp gate formulas: ${error.message}`);
    return results;
  } finally {
    device.destroy();
  }
}

/** A grey image as a PNG data URL, lossless, so the GPU samples the bytes drawn. */
function imageUrl({ size, pixels }: StampGateImage): string {
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const context = canvas.getContext('2d')!, image = context.createImageData(size, size);
  pixels.forEach((v, i) => image.data.set([v, v, v, 255], i * 4));
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** `gate` on a renderer of its own, its images at `url`, handed to `use`; disposed after. */
async function withGateRenderer<T>(gate: Omit<StampGatePainting, 'images'>, url: (file: string) => string, use: (renderer: StampPaintRenderer, frame: () => Uint8ClampedArray) => Promise<T>): Promise<T> {
  const { painting, paper, mixing, width, height } = gate;
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const renderer = await createStampPaintRenderer(canvas, painting, paper, mixing, width, height, ({ file }) => url(file));
  const frame = () => {
    const context = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d')!;
    context.drawImage(canvas, 0, 0);
    return context.getImageData(0, 0, width, height).data;
  };
  try {
    return await use(renderer, frame);
  } finally {
    renderer.dispose();
  }
}

const drawnImages = (gate: StampGatePainting) => {
  const urls = Object.fromEntries(Object.entries(gate.images).map(([file, image]) => [file, imageUrl(image)]));
  return (file: string) => urls[file];
};

/** `gate` drawn at its time: its frame as RGB bytes, row by row, in base64. */
function paintedFrame(gate: Omit<StampGatePainting, 'images'>, url: (file: string) => string): Promise<string> {
  return withGateRenderer(gate, url, async (renderer, frame) => {
    await renderer.draw(gate.t);
    await renderer.finish();
    const rgba = frame(), rgb = new Uint8Array(gate.width * gate.height * 3);
    for (let i = 0; i < gate.width * gate.height; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
    let binary = '';
    for (let i = 0; i < rgb.length; i += 0x8000) binary += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
    return btoa(binary);
  });
}

/** The gate painting `id`, as paintedFrame gives it. */
function paintStampGate(id: string): Promise<string> {
  const gate = stampGatePainting(id);
  return paintedFrame(gate, drawnImages(gate));
}

/** A private case of a pack's `brush`, its images under `packUrl`, as paintedFrame gives it. */
function paintStampGatePrivate(brush: StampBrush, packUrl: string, privateCase: StampGatePrivateCase): Promise<string> {
  return paintedFrame(stampGatePrivatePainting(brush, privateCase), (file) => `${packUrl}/${file}`);
}

/**
 * The trace painting traced, then drawn as usual on the same renderer: how far the traced coverage sits from the
 * traced frame, how far the traced frame sits from the ordinary one (it must be the same draw), and each deposit's
 * stage order.
 */
async function traceStampGate(): Promise<{ worst: number; mean: number; ordinary: StampGateFrameDifference; orders: string[] }> {
  const gate = stampGateTracePainting();
  const { width, height } = gate;
  return withGateRenderer(gate, drawnImages(gate), async (renderer, frame) => {
    const deposits = gate.painting.groups.flatMap((group) => group.passes.flatMap((pass) => pass.deposits));
    const traces = await renderer.trace(gate.t, deposits.map((deposit) => ({ deposit, crop: { x: 0, y: 0, w: width, h: height } })));
    await renderer.finish();
    const traced = frame();
    await renderer.draw(gate.t);
    await renderer.finish();
    const ordinary = stampGateFrameDifference(traced, frame());
    let worst = 0, sum = 0;
    for (let i = 0; i < width * height; i++) {
      // The strokes lie apart, so at most one covers a pixel; black on white, its darkness is that coverage.
      const coverage = 1 - traces.reduce((kept, trace) => kept * (1 - trace.coverage[i]), 1);
      const difference = Math.abs(coverage * 255 - (255 - traced[i * 4]));
      worst = Math.max(worst, difference);
      sum += difference;
    }
    return { worst, mean: sum / (width * height), ordinary, orders: traces.map((trace) => trace.stages.map(({ stage }) => stage).join(',')) };
  });
}

/** The GPU the gate draws on, as a baseline records it. */
async function stampGateAdapter(): Promise<string> {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('stamp gate: no WebGPU adapter');
  const { vendor, architecture, device, description } = adapter.info;
  return [vendor, architecture, device, description].filter(Boolean).join(' ');
}

Object.assign(globalThis, { runStampGateFormulas, paintStampGate, paintStampGatePrivate, traceStampGate, stampGateAdapter });
