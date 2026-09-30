// stamp-formula-parity-page.ts: the formulas command's browser side, run by engine/stamp-formula-parity.ts through
// withBrowserModulePage. It compiles the renderer's own WGSL for the formula and accumulation registries into one
// compute shader per grid (stamp-formula-parity.ts), runs each row's call on the GPU in f32, and hands back the results.

import { COVERAGE_FORMULAS_WGSL } from '#lib/picture/stamp-paint/models/coverage-formulas.ts';
import { STAMP_ACCUMULATION_RESOLVE_WGSL } from '#lib/picture/stamp-paint/models/stamp-deposit-stages.ts';
import { createStampPaintDevice } from '#lib/picture/stamp-paint/studio/stamp-paint-gpu.ts';

const WORKGROUP = 64;

/** A grid as the page is handed it: its call, its row width and its rows, flattened. */
type ParityGrid = { call: string; width: number; rows: number[] };

const kernel = ({ call, width }: ParityGrid) => /* wgsl */ `
${COVERAGE_FORMULAS_WGSL}
${STAMP_ACCUMULATION_RESOLVE_WGSL}
@group(0) @binding(0) var<storage, read> inputs: array<f32>;
@group(0) @binding(1) var<storage, read_write> outputs: array<f32>;
var<private> row: u32;
fn x(i: u32) -> f32 { return inputs[row * ${width}u + i]; }
@compute @workgroup_size(${WORKGROUP}) fn run(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&outputs)) { return; }
  row = id.x;
  outputs[id.x] = ${call};
}`;

/** Each grid's results, row by row, from the GPU. */
async function runStampFormulaParity(grids: readonly ParityGrid[]): Promise<number[][]> {
  const device = await createStampPaintDevice();
  try {
    device.pushErrorScope('validation');
    const results = await Promise.all(grids.map(async (grid) => {
      const count = grid.rows.length / grid.width;
      const input = device.createBuffer({ size: grid.rows.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(input, 0, new Float32Array(grid.rows));
      const output = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const read = device.createBuffer({ size: count * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: kernel(grid) }) } });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: output } }] }));
      pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP));
      pass.end();
      encoder.copyBufferToBuffer(output, 0, read, 0, count * 4);
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      return Array.from(new Float32Array(read.getMappedRange()));
    }));
    const error = await device.popErrorScope();
    if (error) throw new Error(`stamp formula parity: ${error.message}`);
    return results;
  } finally {
    device.destroy();
  }
}

Object.assign(globalThis, { runStampFormulaParity });
