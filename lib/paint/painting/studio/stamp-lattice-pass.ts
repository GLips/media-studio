// stamp-lattice-pass.ts: a film laid through a lattice (stamp-group-warp.ts): triangles from where its points lie on a
// stage back to where they were painted, rasterised into each stage pixel's rest point, and each vertex's travel over
// a shutter into a plane's motion. Where it folds, a later triangle covers an earlier unless its rest holds nothing.
// The renderer lays a moved or warped group through it; a shot lays its films, cards and ground through it.

import { stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import type { StampPoint } from '../models/stamp-region.ts';
import { stampPaintTargetWgsl, type StampPaintTarget } from './stamp-paint-compositor.ts';
import { STAMP_NO_REST } from './stamp-paint-lay-pass.ts';
import { stampBindGroup, type StampPaintDevice } from './stamp-paint-gpu.ts';

/** A lattice vertex's floats: its stage clip point, its rest point, and its travel over its plane's motion span. */
export const STAMP_LATTICE_VERTEX_FLOATS = 6;

/**
 * What a lattice's draw writes: each pixel's rest point where the film it reads holds paint (`paint`), over all it
 * covers (`region`) or nowhere; and its travel (`motion`), where it writes rest, or over all it covers when it writes none.
 */
export type StampLatticeDraw = { readonly rest: 'paint' | 'region' | null; readonly motion: boolean };

const STILL = { x: 0, y: 0 };

/** The lattice's WGSL for `draw`, a `paint` rest reading the film `layer` at binding 0 through a linear clamped sampler at 1. */
export function stampLatticeWgsl(layer: StampPaintTarget, stage: StampStage, { rest, motion }: StampLatticeDraw) {
  const outputs = [...(rest ? ['@location(0) rest: vec4f'] : []), ...(motion ? [`@location(${rest ? 1 : 0}) motion: vec4f`] : [])];
  const laid = [...(rest ? ['vec4f(point.rest, 0.0, 1.0)'] : []), ...(motion ? ['vec4f(point.travel, 0.0, 1.0)'] : [])].join(', ');
  const held = rest === 'paint' ? /* wgsl */ `
  let uv = (point.rest + vec2f(STAGE_MARGIN)) / vec2f(textureDimensions(source));
  var held = vec4f(0.0);
  ${layer.kind === 'array'
    ? `for (var l = 0u; l < ${layer.layers}u; l++) { held += abs(textureSampleLevel(source, linearClamp, uv, l, 0.0)); }`
    : 'held = abs(textureSampleLevel(source, linearClamp, uv, 0.0));'}
  if (all(held == vec4f(0.0))) { discard; }` : '';
  return /* wgsl */ `
${stampStageWgsl(stage)}
${rest === 'paint' ? `${stampPaintTargetWgsl('source', 0, layer, null)}
@group(0) @binding(1) var linearClamp: sampler;` : ''}
struct LatticePoint { @builtin(position) at: vec4f, @location(0) rest: vec2f, @location(1) travel: vec2f };
struct LatticeLaid { ${outputs.join(', ')} };
@vertex fn latticeVertex(@location(0) clip: vec2f, @location(1) rest: vec2f, @location(2) travel: vec2f) -> LatticePoint {
  return LatticePoint(vec4f(clip, 0.0, 1.0), rest, travel);
}
@fragment fn latticeRest(point: LatticePoint) -> LatticeLaid {${held}
  return LatticeLaid(${laid});
}`;
}

/** Where a lattice's vertices lie in a frame's vertex buffer, and how many it has. */
export type StampLatticeSpan = { readonly first: number; readonly floats: number; readonly vertices: number };

/** What a lattice's draw writes into: the rest map (rg32float, cleared to no rest first), the motion (kept), and the film a `paint` rest reads. */
export type StampLatticeTargets = { readonly rest: GPUTextureView | null; readonly motion: GPUTextureView | null; readonly source: GPUTextureView | null };

/**
 * Lattices drawn onto `stage` on `device`, reading films shaped `layer`: their pipelines made when first asked, their
 * vertices staged each frame and uploaded at `flush`.
 */
export function createStampLatticePass(device: StampPaintDevice, { layer, stage, sampler }: { layer: StampPaintTarget; stage: StampStage; sampler: GPUSampler }) {
  const pipelines = new Map<string, GPURenderPipeline>();
  let staging = new Float32Array(0), vertices: GPUBuffer | null = null, used = 0;
  const pipelineOf = (draw: StampLatticeDraw) => {
    const key = `${draw.rest}|${draw.motion}`;
    let pipeline = pipelines.get(key);
    if (!pipeline) {
      const module = device.createShaderModule({ code: stampLatticeWgsl(layer, stage, draw) });
      const attributes: GPUVertexAttribute[] = [0, 1, 2].map((shaderLocation) => ({ shaderLocation, offset: shaderLocation * 8, format: 'float32x2' }));
      const targets: GPUColorTargetState[] = [...(draw.rest ? [{ format: 'rg32float' as const }] : []), ...(draw.motion ? [{ format: 'rgba16float' as const }] : [])];
      pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, buffers: [{ arrayStride: STAMP_LATTICE_VERTEX_FLOATS * 4, attributes }] }, fragment: { module, targets } });
      pipelines.set(key, pipeline);
    }
    return pipeline;
  };
  return {
    /** Starts a frame's vertices, with room for `floats` of them: a frame's lattices must fit what it reserved. */
    reset(floats: number) {
      used = 0;
      if (floats <= staging.length) return;
      staging = new Float32Array(floats);
      // Destroyed once the frames that drew from it are done.
      vertices?.destroy();
      vertices = device.createBuffer({ size: floats * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    },
    /**
     * Stages `triangles` (stage point x, y and rest point x, y a vertex), each vertex carrying `travel` at its rest
     * point and index (still when left out). Returns its span, and the box of stage points it reaches.
     */
    add(triangles: Float32Array, travel?: (rest: StampPoint, vertex: number) => StampPoint): { span: StampLatticeSpan; reach: { x0: number; y0: number; x1: number; y1: number } } {
      const { margin, width, height } = stage, count = triangles.length / 4, floats = count * STAMP_LATTICE_VERTEX_FLOATS;
      if (used + floats > staging.length) throw new Error(`stamp lattice: a frame's lattices take ${used + floats} floats, past the ${staging.length} it reserved`);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let v = 0, k = used; v < triangles.length; v += 4, k += STAMP_LATTICE_VERTEX_FLOATS) {
        const x = triangles[v], y = triangles[v + 1];
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        const moved = travel ? travel({ x: triangles[v + 2], y: triangles[v + 3] }, v / 4) : STILL;
        // To the stage's texels, then clip space, y up.
        staging.set([((x + margin) / width) * 2 - 1, 1 - ((y + margin) / height) * 2, triangles[v + 2], triangles[v + 3], moved.x, moved.y], k);
      }
      const span = { first: used, floats, vertices: count };
      used += floats;
      return { span, reach: { x0, y0, x1, y1 } };
    },
    /** Draws `span` as `draw` says into `targets`, its rest map cleared to no rest first. */
    draw(encoder: GPUCommandEncoder, span: StampLatticeSpan, draw: StampLatticeDraw, targets: StampLatticeTargets) {
      const attachments: GPURenderPassColorAttachment[] = [];
      if (draw.rest) attachments.push({ view: targets.rest!, loadOp: 'clear', clearValue: [STAMP_NO_REST, STAMP_NO_REST, 0, 0], storeOp: 'store' });
      if (draw.motion) attachments.push({ view: targets.motion!, loadOp: 'load', storeOp: 'store' });
      const pipeline = pipelineOf(draw), pass = encoder.beginRenderPass({ colorAttachments: attachments });
      pass.setPipeline(pipeline);
      // Only a paint rest reads its film: the others bind nothing.
      if (draw.rest === 'paint') pass.setBindGroup(0, stampBindGroup(device, pipeline, [targets.source!, sampler]));
      pass.setVertexBuffer(0, vertices, span.first * 4, span.floats * 4);
      pass.draw(span.vertices);
      pass.end();
    },
    /** Uploads the frame's vertices: before its encoder is submitted. */
    flush() {
      if (used) device.queue.writeBuffer(vertices!, 0, staging, 0, used);
    },
  };
}

export type StampLatticePass = ReturnType<typeof createStampLatticePass>;
