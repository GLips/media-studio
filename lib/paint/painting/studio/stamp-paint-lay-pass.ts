// stamp-paint-lay-pass.ts: films laid over paper, and the painting shown. The paper (its colour, or its photograph
// covering the frame and mirrored past it) is laid first; each group's film over it by its compositor's layGroup,
// at rest or through a lattice's rest points (a moved or warped group); an own sheet's card, its paper as far as its
// paint reaches, where its first layer goes; the painting is output in screen colour. The renderer, the sheet
// solver's composites and a shot all lay through it, a lay per paper.

import { gpuUniformLayout, gpuUniformStruct, gpuUniformWriter, type GpuUniformViews } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_FULL_FRAME_WGSL, GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { STAMP_OPAQUE_COVER } from '../models/stamp-paint-recipe-compile.ts';
import type { StampPaintPaper } from '../models/stamp-paint-recipe-types.ts';
import { STAMP_REST_POINT_WGSL, type StampRestMap } from '../models/stamp-rest-map.ts';
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

const STAMP_LAY_PLACED_PAPER = gpuUniformLayout('PlacedPaper', [['paper', gpuUniformStruct(PAPER)], ['origin', 'vec2u'], ['extent', 'vec2u']]);
// Paper laid where a lattice's rest map puts it: each pixel the paper's colour at its rest point, one no lattice
// covers left as it was.
const placedPaperWgsl = (compositor: StampPaintCompositor, stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('painting', 2, compositor.targets.painting, 'write')}
${GPU_SRGB_WGSL}
${compositor.paper}
${PAPER_COLOR_WGSL}
${STAMP_LAY_PLACED_PAPER.wgsl}
@group(0) @binding(0) var<uniform> u: PlacedPaper;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(3) var photographSampler: sampler;
@group(0) @binding(4) var rest: texture_2d<f32>;
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn placedPaper(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let at = textureLoad(rest, pixel, 0).xy;
  if (at.x < ${STAMP_NO_REST / 2}.0) { return; }
  layPaper(pixel, paperColor(image, photographSampler, u.paper, at));
}`;

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
/** Where a masked group pass binds its mask (r32float over the stage, 1 for all shown), after the rest point. */
const GROUP_MASK_BINDING = 17;
// `masked`: each pixel's opacity is the group's times a shot's presentation mask there, so a mask cuts paint as
// visibility fades it.
const groupWgsl = (compositor: StampPaintCompositor, moved: boolean, stage: StampStage, masked: boolean) => {
  const { layer, painting } = compositor.targets;
  const layerAt = (texel: string) => (layer.kind === 'array' ? `textureLoad(layer, ${texel}, l, 0)` : `textureLoad(layer, ${texel}, 0)`);
  const paintingAt = painting.kind === 'array' ? 'textureLoad(painting, pixel, i)' : 'textureLoad(painting, pixel)';
  const store = (value: string) => (painting.kind === 'array' ? `textureStore(painting, pixel, i, ${value})` : `textureStore(painting, pixel, ${value})`);
  const paintingLayers = painting.kind === 'array' ? painting.layers : 1;
  const opacity = masked ? /* wgsl */ `
  let opacity = u.opacity * textureLoad(mask, pixel, 0).r;
  if (opacity <= 0.0) { return; }` : '\n  let opacity = u.opacity;';
  const common = /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('layer', 1, layer, null)}
${stampPaintTargetWgsl('painting', 2, painting, 'read_write')}
${PAPER_COLOR_WGSL}
${GPU_SRGB_WGSL}
${STAMP_LAY_GROUP.wgsl}
@group(0) @binding(0) var<uniform> u: Group;
${masked ? `@group(0) @binding(${GROUP_MASK_BINDING}) var mask: texture_2d<f32>;` : ''}
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
  let pixel = u.origin + id.xy;${opacity}
  layGroup(pixel, u.glaze == 1u, opacity);
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
  if (q.x < ${STAMP_NO_REST / 2}.0) { return; }${opacity}
  let base = floor(q);
  let f = q - base;
  var blended: array<vec4f, ${paintingLayers}>;
  for (var k = 0u; k < 4u; k++) {
    let corner = vec2u(k & 1u, k >> 1u);
    let w = select(1.0 - f.x, f.x, corner.x == 1u) * select(1.0 - f.y, f.y, corner.y == 1u);
    if (w == 0.0) { continue; }
    tapTexel = vec2i(base) + STAGE_MARGIN + vec2i(corner);
    for (var i = 0u; i < ${paintingLayers}u; i++) { tapLaid[i] = groupUnderAt(pixel, i); }
    layGroup(pixel, u.glaze == 1u, opacity);
    for (var i = 0u; i < ${paintingLayers}u; i++) { blended[i] += w * tapLaid[i]; }
  }
  for (var i = 0u; i < ${paintingLayers}u; i++) { ${store('blended[i]')}; }
}`;
};

/**
 * `cardUnionAt(pixel, origin, extent, moved)`: an own sheet's union (z) and paper point (xy, stage px) where its card's
 * texel at `pixel` was painted, read bilinearly through `rest` when moved. The union is `edge` (r32float) over stage
 * texels `origin` `extent`. The includer declares `edge`, `rest` and the stage's WGSL.
 */
export const STAMP_CARD_UNION_WGSL = /* wgsl */ `
fn cardUnionTexel(t: vec2i, origin: vec2u, extent: vec2u) -> f32 {
  let q = t - vec2i(origin);
  if (any(q < vec2i(0)) || any(q >= vec2i(extent))) { return 0.0; }
  return textureLoad(edge, vec2u(q), 0).r;
}
fn cardUnionAt(pixel: vec2u, origin: vec2u, extent: vec2u, moved: bool) -> vec3f {
  if (!moved) { return vec3f(stagePoint(vec2i(pixel)), cardUnionTexel(vec2i(pixel), origin, extent)); }
  let at = textureLoad(rest, pixel, 0).xy;
  if (at.x < ${STAMP_NO_REST / 2}.0) { return vec3f(at, 0.0); }
  let q = at - 0.5 + vec2f(STAGE_MARGIN);
  let b = vec2i(floor(q));
  let f = q - floor(q);
  let top = mix(cardUnionTexel(b, origin, extent), cardUnionTexel(b + vec2i(1, 0), origin, extent), f.x);
  let bottom = mix(cardUnionTexel(b + vec2i(0, 1), origin, extent), cardUnionTexel(b + vec2i(1, 1), origin, extent), f.x);
  return vec3f(at, mix(top, bottom, f.y));
}`;

const STAMP_LAY_CARD = gpuUniformLayout('Card', [
  ['paper', gpuUniformStruct(PAPER)], ['origin', 'vec2u'], ['extent', 'vec2u'], ['edgeOrigin', 'vec2u'], ['edgeExtent', 'vec2u'], ['moved', 'u32'],
]);
// An own sheet's card: its paper laid over what's behind as far as its union reaches, cover = min(1, STAMP_OPAQUE_COVER
// × union), read where each pixel was painted when the sheet is moved, its photograph too. `masked`: the union is
// taken where a shot's presentation mask leaves its paint, so a masked word's card follows its ink.
const cardWgsl = (compositor: StampPaintCompositor, stage: StampStage, masked: boolean) => /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('painting', 2, compositor.targets.painting, 'read_write')}
${GPU_SRGB_WGSL}
${compositor.card}
${PAPER_COLOR_WGSL}
${STAMP_LAY_CARD.wgsl}
@group(0) @binding(0) var<uniform> u: Card;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(3) var photographSampler: sampler;
@group(0) @binding(4) var edge: texture_2d<f32>;
@group(0) @binding(5) var rest: texture_2d<f32>;
${masked ? '@group(0) @binding(6) var mask: texture_2d<f32>;' : ''}
${STAMP_CARD_UNION_WGSL}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn card(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let read = cardUnionAt(pixel, u.edgeOrigin, u.edgeExtent, u.moved == 1u);
  let cover = min(1.0, read.z${masked ? ' * textureLoad(mask, pixel, 0).r' : ''} * ${STAMP_OPAQUE_COVER.toFixed(1)});
  if (cover <= 0.0) { return; }
  layCard(pixel, paperColor(image, photographSampler, u.paper, read.xy), cover);
}`;

const STAMP_LAY_PLACE = gpuUniformLayout('Place', [['rest', 'vec4f'], ['extent', 'vec2u']]);
// Each stage texel's rest point under a placed sheet's rest map: where the paint laid there was painted.
const placeRestWgsl = (stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${STAMP_REST_POINT_WGSL}
${STAMP_LAY_PLACE.wgsl}
@group(0) @binding(0) var<uniform> u: Place;
@group(0) @binding(1) var rest: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn place(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  textureStore(rest, id.xy, vec4f(restPoint(u.rest, stagePoint(vec2i(id.xy))), 0.0, 1.0));
}`;

/**
 * An own sheet's card laid: `edge`, its union's coverage over stage texels `edgeBox` (r32float, its texel 0 the box's
 * first), onto `painting` over `box`; through `rest`, a placement's rest points, when the sheet is moved; its union
 * cut by `mask` (a shot's presentation mask, r32float over the stage) when given.
 */
export type StampCardLay = { edge: GPUTextureView; edgeBox: StampPixelBox; painting: GPUTextureView; box: StampPixelBox; rest: GPUTextureView | null; mask?: GPUTextureView | null };

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

/**
 * What a lay is made for: its stage and compositor, the paper and its photograph (null for none), a texture bound for
 * none, and the photograph's sampler; `paperFrame`, the rectangle a photograph covers from the stage's origin, the
 * stage's frame when left out (a shot's sheet covers its document).
 */
export type StampPaintLayOptions = {
  stage: StampStage; compositor: StampPaintCompositor; paper: StampPaintPaper; photograph: StampPaintImage | null; blank: GPUTextureView; sampler: GPUSampler;
  paperFrame?: { readonly width: number; readonly height: number };
};

/**
 * A group laid: its film `layer` onto `painting` over `box` (stage texels) at `opacity` (times a shot's `mask` there,
 * r32float over the stage, when given), glazed or not, as group `index` of its compositor; a reserve or lift showing
 * `backing`; through `rest`, a lattice's rest points, when moved, its own paper read where it was painted when
 * `paperFromRest`.
 */
export type StampGroupLay = {
  layer: GPUTextureView; painting: GPUTextureView; index: number; opacity: number; glaze: boolean; box: StampPixelBox; backing: StampPaintBacking;
  rest: GPUTextureView | null; paperFromRest: boolean; mask?: GPUTextureView | null;
};

/** The lay's passes on `device`, their pipelines made now; each pass's uniform from `arena`. */
export function createStampPaintLay(device: StampPaintDevice, arena: StampUniformArena, { stage, compositor, paper, photograph, blank, sampler, paperFrame }: StampPaintLayOptions) {
  const frame = paperFrame ?? stage.frame;
  const compute = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  const pipelines = { paper: compute(paperWgsl(compositor, stage)) };
  // The still unmasked group pass is made now, as every lay takes it; the others when first asked.
  const groups = new Map<string, GPUComputePipeline>([['false|false', compute(groupWgsl(compositor, false, stage, false))]]);
  const groupPipeline = (moved: boolean, masked: boolean) => {
    const key = `${moved}|${masked}`;
    let made = groups.get(key);
    if (!made) groups.set(key, (made = compute(groupWgsl(compositor, moved, stage, masked))));
    return made;
  };
  const cards = new Map<boolean, GPUComputePipeline>();
  const cardPipeline = (masked: boolean) => {
    let made = cards.get(masked);
    if (!made) cards.set(masked, (made = compute(cardWgsl(compositor, stage, masked))));
    return made;
  };
  let placeRest: GPUComputePipeline | null = null, placedPaper: GPUComputePipeline | null = null;
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
    /** The painting's paper over `painting`'s `box` (stage texels) where `rest`, a lattice's rest map, puts it. */
    drawPlacedPaper(encoder: GPUCommandEncoder, painting: GPUTextureView, rest: GPUTextureView, box: StampPixelBox) {
      placedPaper ??= compute(placedPaperWgsl(compositor, stage));
      dispatchStampCompute(device, encoder, placedPaper, [
        arena.slot((views) => {
          writePaper(views, STAMP_LAY_PLACED_PAPER.at.paper, 'paper');
          const put = gpuUniformWriter(STAMP_LAY_PLACED_PAPER, views);
          put('origin', [box.x, box.y]);
          put('extent', [box.w, box.h]);
        }),
        photograph?.view ?? blank, painting, sampler, rest,
      ], box.w, box.h);
    },
    /** Lays a group as `lay` says. */
    layGroup(encoder: GPUCommandEncoder, lay: StampGroupLay) {
      const { box, rest } = lay, mask = lay.mask ?? null;
      const pipeline = groupPipeline(rest !== null, mask !== null);
      // The moved pass binds the rest points past the compositor's own bindings, at GROUP_REST_BINDING, and a masked
      // one its mask after them.
      const restBinding = rest || mask ? [...Array<null>(GROUP_REST_BINDING - 3 - groupResources.length).fill(null), rest, ...(mask ? [mask] : [])] : [];
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
    /** Lays an own sheet's card as `lay` says, its paper this lay's. */
    layCard(encoder: GPUCommandEncoder, lay: StampCardLay) {
      const { box, edgeBox } = lay, mask = lay.mask ?? null;
      dispatchStampCompute(device, encoder, cardPipeline(mask !== null), [
        arena.slot((views) => {
          const put = gpuUniformWriter(STAMP_LAY_CARD, views);
          writePaper(views, STAMP_LAY_CARD.at.paper, 'paper');
          put('origin', [box.x, box.y]);
          put('extent', [box.w, box.h]);
          put('edgeOrigin', [edgeBox.x, edgeBox.y]);
          put('edgeExtent', [edgeBox.w, edgeBox.h]);
          put('moved', lay.rest ? 1 : 0);
        }),
        photograph?.view ?? blank, lay.painting, sampler, lay.edge, lay.rest ?? blank, mask,
      ], box.w, box.h);
    },
    /** Writes into `rest` (rg32float, the stage's size) each stage texel's rest point under `map`. */
    drawPlacedRest(encoder: GPUCommandEncoder, rest: GPUTextureView, map: StampRestMap) {
      placeRest ??= compute(placeRestWgsl(stage));
      dispatchStampCompute(device, encoder, placeRest, [
        arena.slot((views) => {
          const put = gpuUniformWriter(STAMP_LAY_PLACE, views);
          put('rest', map);
          put('extent', [stage.width, stage.height]);
        }),
        rest,
      ], stage.width, stage.height);
    },
  };
}

export type StampPaintLay = ReturnType<typeof createStampPaintLay>;
