// stamp-paint-lay-pass.ts: films laid over paper, and the painting shown. The paper (its colour, or its photograph
// covering the frame and mirrored past it) is laid first; each group's film over it by its compositor's layGroup,
// at rest or through a lattice's rest points (a moved or warped group); the painting is output in screen colour.
// The renderer and the sheet solver's still both lay through it.

import { gpuUniformLayout, gpuUniformStruct, gpuUniformWriter, type GpuUniformViews } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_FULL_FRAME_WGSL, GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampPaintPaper } from '../models/stamp-paint-recipe-types.ts';
import { stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import { stampPaintTargetWgsl, type StampPaintCompositor } from './stamp-paint-compositor.ts';
import { dispatchStampCompute, STAMP_WORKGROUP, type StampPaintDevice, type StampPaintImage } from './stamp-paint-gpu.ts';
import type { StampUniformArena } from './stamp-uniform-arena.ts';

const PAPER = gpuUniformLayout('Paper', [['color', 'vec3f'], ['hasImage', 'u32'], ['cover', 'vec2f'], ['lod', 'f32'], ['frame', 'vec2f']]);
const PAPER_COLOR_WGSL = /* wgsl */ `
${PAPER.wgsl}
// The paper's gamma-encoded colour at painting point \`at\`: its photograph's, covering the frame (p.frame) and mirrored
// past it over the stage's margin, or its colour.
fn paperColor(image: texture_2d<f32>, paperSampler: sampler, p: Paper, at: vec2f) -> vec3f {
  let uv = at / p.frame;
  if (p.hasImage == 1u) { return textureSampleLevel(image, paperSampler, (uv - 0.5) * p.cover + 0.5, p.lod).rgb; }
  return p.color;
}`;
const paperWgsl = (compositor: StampPaintCompositor, stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('painting', 2, compositor.targets.painting, 'write')}
${GPU_SRGB_WGSL}
${compositor.paper}
${PAPER_COLOR_WGSL}
@group(0) @binding(0) var<uniform> u: Paper;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(3) var photographSampler: sampler;
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn paper(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(painting))) { return; }
  layPaper(id.xy, paperColor(image, photographSampler, u, stagePoint(vec2i(id.xy))));
}`;

/** A scene pixel's rest point where no moved or warped group's lattice covers it: outside any layer. */
export const STAMP_NO_REST = -65536;

// \`paper\` is the paper under a group, read where a scene pixel is (groupGroundAt, fixed to the stage) unless the group
// carries its own as it moves or warps (StampGroupPaper, \`paperFromRest\`): then where its texel was painted.
// \`backing\` (STAMP_PAINT_BACKING_WORDS): what a reserve or lift shows, the paper or a clear plane's measuring backing.
const STAMP_LAY_GROUP = gpuUniformLayout('Group', [
  ['opacity', 'f32'], ['glaze', 'u32'], ['origin', 'vec2u'], ['extent', 'vec2u'], ['group', 'u32'], ['paper', gpuUniformStruct(PAPER)], ['paperFromRest', 'u32'],
  ['backing', 'u32'],
]);
/**
 * What a plane's groups are laid on: the painting's paper (the back), or plain white or black (a clear plane measured
 * on each, stamp-paint-plane-passes.ts), no photograph.
 */
export type StampPaintBacking = 'paper' | 'white' | 'black';
const STAMP_PAINT_BACKING_WORDS = { paper: 0, white: 1, black: 2 } as const satisfies Record<StampPaintBacking, number>;
/** Where the moved group pass binds the rest point of each scene pixel, past any compositor's own bindings. */
const GROUP_REST_BINDING = 16;
const groupWgsl = (compositor: StampPaintCompositor, moved: boolean, stage: StampStage) => {
  const { layer, painting } = compositor.targets;
  const layerAt = (texel: string) => (layer.kind === 'array' ? `textureLoad(layer, ${texel}, l, 0)` : `textureLoad(layer, ${texel}, 0)`);
  const paintingAt = painting.kind === 'array' ? 'textureLoad(painting, pixel, i)' : 'textureLoad(painting, pixel)';
  const store = (value: string) => (painting.kind === 'array' ? `textureStore(painting, pixel, i, ${value})` : `textureStore(painting, pixel, ${value})`);
  const paintingLayers = painting.kind === 'array' ? painting.layers : 1;
  const common = /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('layer', 1, layer, null)}
${stampPaintTargetWgsl('painting', 2, painting, 'read_write')}
${PAPER_COLOR_WGSL}
${GPU_SRGB_WGSL}
${STAMP_LAY_GROUP.wgsl}
@group(0) @binding(0) var<uniform> u: Group;
fn groupUnderAt(pixel: vec2u, i: u32) -> vec4f { return ${paintingAt}; }
fn groupGroundAt(pixel: vec2u) -> vec2f { return stagePoint(vec2i(pixel)); }
// What a reserve or lift shows where \`paper\` lies under it: that, or the measuring backing.
fn groupBackingShown(paper: vec3f) -> vec3f {
  if (u.backing == 0u) { return paper; }
  return vec3f(select(0.0, 1.0, u.backing == 1u));
}`;
  if (!moved) return /* wgsl */ `${common}
fn groupLayerAt(pixel: vec2u, l: u32) -> vec4f { return ${layerAt('pixel')}; }
fn groupLaid(pixel: vec2u, i: u32, value: vec4f) { ${store('value')}; }
fn groupPaperAt(pixel: vec2u) -> vec2f { return stagePoint(vec2i(pixel)); }
${compositor.group.wgsl}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn group(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  layGroup(u.origin + id.xy, u.glaze == 1u, u.opacity);
}`;
  // Each of the four texels round a pixel's rest point is laid as it would be unmoved, and the laid paint blended
  // bilinearly. Blending amounts before the lay instead fills a dry medium's tooth: KM isn't linear in its films.
  return /* wgsl */ `${common}
@group(0) @binding(${GROUP_REST_BINDING}) var rest: texture_2d<f32>;
var<private> tapTexel: vec2i;
var<private> tapLaid: array<vec4f, ${paintingLayers}>;
fn groupLayerAt(pixel: vec2u, l: u32) -> vec4f {
  if (any(tapTexel < vec2i(0)) || any(tapTexel >= vec2i(textureDimensions(layer)))) { return vec4f(0.0); }
  return ${layerAt('vec2u(tapTexel)')};
}
fn groupLaid(pixel: vec2u, i: u32, value: vec4f) { tapLaid[i] = value; }
fn groupPaperAt(pixel: vec2u) -> vec2f {
  if (u.paperFromRest == 1u) { return stagePoint(tapTexel); }
  return stagePoint(vec2i(pixel));
}
${compositor.group.wgsl}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn group(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let q = textureLoad(rest, pixel, 0).xy - 0.5;
  if (q.x < ${STAMP_NO_REST / 2}.0) { return; }
  let base = floor(q);
  let f = q - base;
  var blended: array<vec4f, ${paintingLayers}>;
  for (var k = 0u; k < 4u; k++) {
    let corner = vec2u(k & 1u, k >> 1u);
    let w = select(1.0 - f.x, f.x, corner.x == 1u) * select(1.0 - f.y, f.y, corner.y == 1u);
    if (w == 0.0) { continue; }
    tapTexel = vec2i(base) + STAGE_MARGIN + vec2i(corner);
    for (var i = 0u; i < ${paintingLayers}u; i++) { tapLaid[i] = groupUnderAt(pixel, i); }
    layGroup(pixel, u.glaze == 1u, u.opacity);
    for (var i = 0u; i < ${paintingLayers}u; i++) { blended[i] += w * tapLaid[i]; }
  }
  for (var i = 0u; i < ${paintingLayers}u; i++) { ${store('blended[i]')}; }
}`;
};

// The frame's window of the stage, a painting shown as it is: an output pixel is the stage's texel a margin in.
export const stampPaintOutputWgsl = (compositor: StampPaintCompositor, dithered: boolean, stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${GPU_FULL_FRAME_WGSL}
${stampPaintTargetWgsl('painting', 0, compositor.targets.painting, null)}
${GPU_SRGB_WGSL}
${compositor.output}
@fragment fn output(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let pixel = vec2u(at.xy);
  // An ordered dither, the same each frame, so a smooth flood doesn't band when the half floats become bytes.
  let dither = ${dithered ? '(fract(dot(vec2f(pixel), vec2f(0.7548776662, 0.5698402910))) - 0.5) / 255.0' : '0.0'};
  return vec4f(clamp(screenColor(pixel + vec2u(STAGE_MARGIN)) + dither, vec3f(0.0), vec3f(1.0)), 1.0);
}`;

const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
const rgb = (hex: string): [number, number, number] => [channel(hex, 1), channel(hex, 3), channel(hex, 5)];

/** What a lay is made for: its stage and compositor, the paper and its photograph (null for none), a texture bound for none, and the photograph's sampler. */
export type StampPaintLayOptions = {
  stage: StampStage; compositor: StampPaintCompositor; paper: StampPaintPaper; photograph: StampPaintImage | null; blank: GPUTextureView; sampler: GPUSampler;
};

/**
 * A group laid: its film `layer` onto `painting` over `box` (stage texels) at `opacity`, glazed or not, as group
 * `index` of its compositor; a reserve or lift showing `backing`; through `rest`, a lattice's rest points, when moved,
 * its own paper read where it was painted when `paperFromRest`.
 */
export type StampGroupLay = {
  layer: GPUTextureView; painting: GPUTextureView; index: number; opacity: number; glaze: boolean; box: StampPixelBox; backing: StampPaintBacking;
  rest: GPUTextureView | null; paperFromRest: boolean;
};

/** The lay's passes on `device`, their pipelines made now; each pass's uniform from `arena`. */
export function createStampPaintLay(device: StampPaintDevice, arena: StampUniformArena, { stage, compositor, paper, photograph, blank, sampler }: StampPaintLayOptions) {
  const { frame } = stage;
  const compute = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  const pipelines = { group: compute(groupWgsl(compositor, false, stage)), paper: compute(paperWgsl(compositor, stage)) };
  let movedGroup: GPUComputePipeline | null = null;
  /**
   * The Paper uniform at word `at` for `backing`: the painting's paper, or plain white or black. Cover: the photograph
   * fills the frame, cropped along whichever side it has to spare, so a margin leaves the frame's paper as it was;
   * past the frame it's mirrored.
   */
  const writePaper = (views: GpuUniformViews, at: number, backing: StampPaintBacking) => {
    const put = gpuUniformWriter(PAPER, views, at);
    put('frame', [frame.width, frame.height]);
    if (backing !== 'paper') {
      put('color', backing === 'white' ? [1, 1, 1] : [0, 0, 0]);
      return;
    }
    put('color', rgb(paper.color));
    if (!photograph) return;
    const fit = Math.max(frame.width / photograph.width, frame.height / photograph.height);
    put('hasImage', 1);
    put('cover', [frame.width / (photograph.width * fit), frame.height / (photograph.height * fit)]);
    put('lod', Math.max(0, Math.log2(1 / fit)));
  };
  const groupResources = compositor.group.resources({ photograph: photograph?.view ?? blank, sampler });
  return {
    /** `backing` over `painting`'s first `w` × `h` texels. */
    drawPaper(encoder: GPUCommandEncoder, painting: GPUTextureView, backing: StampPaintBacking, w: number, h: number) {
      dispatchStampCompute(device, encoder, pipelines.paper, [arena.slot((views) => writePaper(views, 0, backing)), photograph?.view ?? blank, painting, sampler], w, h);
    },
    /** Lays a group as `lay` says. */
    layGroup(encoder: GPUCommandEncoder, lay: StampGroupLay) {
      const { box, rest } = lay;
      const pipeline = rest ? (movedGroup ??= compute(groupWgsl(compositor, true, stage))) : pipelines.group;
      // The moved pass binds the rest points past the compositor's own bindings, at GROUP_REST_BINDING.
      const restBinding = rest ? [...Array<null>(GROUP_REST_BINDING - 3 - groupResources.length).fill(null), rest] : [];
      dispatchStampCompute(device, encoder, pipeline, [
        arena.slot((views) => {
          const put = gpuUniformWriter(STAMP_LAY_GROUP, views);
          put('opacity', lay.opacity);
          put('glaze', lay.glaze ? 1 : 0);
          put('origin', [box.x, box.y]);
          put('extent', [box.w, box.h]);
          put('group', lay.index);
          // Its own paper even on a measuring backing: opaque paint is laid over that, as on one sheet.
          writePaper(views, STAMP_LAY_GROUP.at.paper, 'paper');
          put('paperFromRest', rest && lay.paperFromRest ? 1 : 0);
          put('backing', STAMP_PAINT_BACKING_WORDS[lay.backing]);
        }),
        lay.layer, lay.painting, ...groupResources, ...restBinding,
      ], box.w, box.h);
    },
  };
}

export type StampPaintLay = ReturnType<typeof createStampPaintLay>;
