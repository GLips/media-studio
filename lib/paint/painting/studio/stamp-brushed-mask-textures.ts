// stamp-brushed-mask-textures.ts: each brushed mask (stamp-brushed-mask.ts) drawn once into a region texture of its
// own, its marks laid through a deposit drawing (stamp-deposit-drawing.ts) and resolved as a deposit's coverage is,
// joined by max. A step of the masking fluid reads it as it reads an area (stamp-region-textures.ts).

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { PAINT_PAPER_WGSL } from '#lib/paint/materials/models/paint-paper.ts';
import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_FULL_FRAME_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { STAMP_RESIST_TOOTH, type CompiledStampBrushedMask, type CompiledStampMarkPlacement } from '../models/stamp-brushed-mask.ts';
import { STAMP_ACCUMULATION_RESOLVE_WGSL } from '../models/stamp-deposit-stages.ts';
import { stampBoxUnion, stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import { loadStampMarks, stampMarksBox } from './stamp-deposit-bank.ts';
import type { StampDepositDrawing, StampPaperTooth } from './stamp-deposit-drawing.ts';
import { STAMP_DEPOSIT, STAMP_DEPOSIT_FLAGS_WGSL, STAMP_RESOLVE_STAGES_WGSL, STAMP_TEXTURIZED_WGSL } from './stamp-deposit-resolve-wgsl.ts';
import { STAMP_GRAIN_WGSL } from './stamp-deposit-stamp-wgsl.ts';
import { clearStampTarget, STAMP_MAX_BLEND, stampBindGroup, stampPaintSamplers, type StampPaintDevice, type StampPaintImage } from './stamp-paint-gpu.ts';
import { STAMP_REGION_BUDGET, STAMP_REGION_FORMAT, STAMP_REGION_TEXEL_BYTES, type StampRegionTexture } from './stamp-region-textures.ts';

/**
 * A brushed mask's mark resolved into its texture (stamp-brushed-mask.ts): the stage's texel the texture's first is,
 * and its resist's amount (0 for fluid).
 */
const BRUSHED_COVER = gpuUniformLayout('BrushedCover', [['origin', 'vec2f'], ['resist', 'f32']]);
// A mark's coverage as a deposit's resolve has it before its paper, fluid and pigment: its builds resolved, the
// dual's grain and pooling, then its plan's stages. Wax keeps only what catches the paper's peaks, as a dry stick
// pressed fully does (paintDryContact). A mask's marks join by max, the blend.
const brushedCoverWgsl = (stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${STAMP_DEPOSIT.wgsl}
${BRUSHED_COVER.wgsl}
${STAMP_GRAIN_WGSL}
${STAMP_DEPOSIT_FLAGS_WGSL}
${STAMP_ACCUMULATION_RESOLVE_WGSL}
${PAINT_PAPER_WGSL}
${GPU_FULL_FRAME_WGSL}
@group(0) @binding(0) var<uniform> u: Deposit;
@group(0) @binding(1) var mask: texture_2d<f32>;
@group(0) @binding(2) var cap: texture_2d<f32>;
@group(0) @binding(3) var grain: texture_2d<f32>;
@group(0) @binding(4) var dualGrain: texture_2d<f32>;
@group(0) @binding(5) var paperGrain: texture_2d<f32>;
@group(0) @binding(6) var tile: sampler;
@group(0) @binding(7) var mirrorTile: sampler;
@group(0) @binding(8) var<uniform> b: BrushedCover;
${STAMP_TEXTURIZED_WGSL}
fn traced(slot: u32, value: f32) {}
${STAMP_RESOLVE_STAGES_WGSL}
@fragment fn brushedCover(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let pixel = vec2u(floor(at.xy + b.origin));
  let p = stagePoint(vec2i(pixel));
  let built = textureLoad(mask, pixel, 0).rg;
  let kept = textureLoad(cap, pixel, 0);
  let raw = vec2f(
    accumulationResolve(built.x, kept.b, kept.r, u.build.x, i32(u.accumulation.x)),
    accumulationResolve(built.y, kept.a, kept.g, u.build.y, i32(u.accumulation.y)),
  );
  var d = 0.0;
  if ((u.flags & DUAL) != 0u) {
    d = raw.g;
    if ((u.flags & DUAL_CANVAS_GRAIN) != 0u) { d = texturized(dualGrain, p, d, u.dualGrain); }
    if ((u.flags & DUAL_POOLED) != 0u) { d = pooled(d, u.pooling.z, u.pooling.w); }
  }
  var m = clamp(resolveStages(raw.r, d, p, u.resolveOrder), 0.0, 1.0);
  if (b.resist > 0.0) {
    var contact = 1.0;
    if ((u.flags & PAPER) != 0u) {
      let h = textureSampleLevel(paperGrain, mirrorTile, p / u.view.zw, u.paperLod).r;
      let mean = textureSampleLevel(paperGrain, tile, vec2f(0.5), 16.0).r;
      contact = paintDryContact(h, mean, ${STAMP_RESIST_TOOTH.toFixed(4)}, u.paperDepth, 1.0, 0.0);
    }
    m *= contact * b.resist;
  }
  return vec4f(m);
}`;

/**
 * Draws each of `masks` into a texture of its own made through `on`, over its marks' reach (none for one off the
 * stage), each mark by its brush in `brushes` laid through `drawing` (its stage, arena, mask and cap) and resolved on
 * `tooth`, into `encoder`.
 */
export function encodeStampBrushedMasks(
  on: StampPaintDevice, encoder: GPUCommandEncoder, drawing: StampDepositDrawing, masks: readonly CompiledStampBrushedMask[],
  brushes: ReadonlyMap<CompiledStampMarkPlacement, StampBrush<StampPaintImage>>, tooth: StampPaperTooth | null,
): ReadonlyMap<CompiledStampBrushedMask, StampRegionTexture | null> {
  if (!masks.length) return new Map();
  const { stage, arena, targets } = drawing, loading = { stage, tipFootprint: drawing.tipFootprint }, marks = masks.flatMap((mask) => mask.marks);
  // A mask lays no colour, and fluid has no medium: its marks are drawn untinted, their grain as deep as their brush says.
  const loaded = new Map(loadStampMarks(on, loading, marks.map((mark) => ({ marks: mark, brush: brushes.get(mark)!, medium: null, tinted: false }))).map((entry, i) => [marks[i], entry]));
  // A pixel past each mark's reach, as a deposit's box with no edges to blur.
  const markBox = (mark: CompiledStampMarkPlacement) => stampMarksBox(loading, mark, loaded.get(mark)!.brush, 1);
  const boxes = new Map(masks.map((mask) => [mask, mask.marks.reduce<StampPixelBox | null>((box, mark) => stampBoxUnion(box, markBox(mark)), null)] as const));
  const bytes = [...boxes.values()].reduce((sum, box) => sum + (box ? box.w * box.h * STAMP_REGION_TEXEL_BYTES : 0), 0);
  if (bytes > STAMP_REGION_BUDGET) throw new Error(`stamp paint: the painting's ${boxes.size} brushed masks need ${Math.round(bytes / 2 ** 20)} MB, over ${STAMP_REGION_BUDGET / 2 ** 20} MB; crop their marks`);

  const { tile, mirrorTile } = stampPaintSamplers(on);
  const module = on.createShaderModule({ code: brushedCoverWgsl(stage) });
  const pipeline = on.createRenderPipeline({ layout: 'auto', vertex: { module }, fragment: { module, entryPoint: 'brushedCover', targets: [{ format: STAMP_REGION_FORMAT, blend: STAMP_MAX_BLEND }] } });
  const textures = new Map<CompiledStampBrushedMask, StampRegionTexture | null>();
  for (const mask of masks) {
    const box = boxes.get(mask)!;
    textures.set(mask, null);
    if (!box) continue;
    const texture = on.createTexture({ size: [box.w, box.h], format: STAMP_REGION_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const view = texture.createView();
    // Drawn on the stage's texels, kept as a region is, in painting points.
    textures.set(mask, { view, box: { x: box.x - stage.margin, y: box.y - stage.margin, w: box.w, h: box.h } });
    clearStampTarget(encoder, view);
    for (const mark of mask.marks) {
      const markLoaded = loaded.get(mark)!, reach = markBox(mark);
      if (!reach) continue;
      drawing.drawStamps(encoder, markLoaded, mark, reach);
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }] });
      pass.setScissorRect(reach.x - box.x, reach.y - box.y, reach.w, reach.h);
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, stampBindGroup(on, pipeline, [
        arena.slot((views) => drawing.writeMarkCoverage(views, markLoaded, mark.grainOffset, tooth)),
        targets.mask.view, targets.cap.view,
        markLoaded.active.main.canvasGrain?.image.view ?? targets.blank.view, markLoaded.active.dual?.canvasGrain?.image.view ?? targets.blank.view,
        tooth ? tooth.image.view : targets.blank.view, tile, mirrorTile,
        arena.slot((views) => {
          const put = gpuUniformWriter(BRUSHED_COVER, views);
          put('origin', [box.x, box.y]);
          put('resist', mask.resist?.amount ?? 0);
        }),
      ]));
      pass.draw(3);
      pass.end();
    }
  }
  return textures;
}
