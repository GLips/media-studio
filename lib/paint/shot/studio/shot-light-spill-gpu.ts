// shot-light-spill-gpu.ts: light spill on the GPU (shot-light-spill.ts). A source's light is its sharp picture's
// emission averaged into texels `step` px wide, then blurred by a separable gaussian there: a spill's light is smooth,
// so a coarse grid holds it, and a wide reach costs what a narrow one does. It's kept under the source image's key and
// its reach, so a still source is blurred once.
//
// The light is laid on a receiver as the lens takes it, in the receiver's own texels, after its defocus: a spill is
// broad enough that blurring it again changes nothing seen. Its other layers are copied as they are, emission included.

import { paintSimilarityAfter, paintSimilarityInverse, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import { dispatchStampCompute, STAMP_WORKGROUP } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import type { StampPlanePicture } from '#lib/paint/painting/studio/stamp-plane-picture-pass.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { StampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import type { LensLayer } from '#lib/picture/lens/studio/lens-compositor.ts';
import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { SHOT_LIGHT_SPILLS_MOST } from '../models/shot-light-spill.ts';

/** How many of its texels a spill's reach spans: the gaussian's sigma on its grid. */
const SHOT_SPILL_SIGMA_TEXELS = 8;

/**
 * A source's light, blurred: `texture`, one layer of linear light; its texel i spanning source plane px `x0` + i·`step`
 * onward, likewise in y.
 */
export type ShotSpillLight = { readonly texture: GPUTexture; readonly x0: number; readonly y0: number; readonly step: number };

/** One spill as a receiver's lay reads it: its light, its map from source plane px to the receiver's texel space, and its gain and added light. */
export type ShotSpillLaid = { readonly light: ShotSpillLight; readonly map: PaintSimilarity; readonly gain: number; readonly added: number };

const SHOT_SPILL_GATHER = gpuUniformLayout('ShotSpillGather', [['extent', 'vec2u'], ['size', 'vec2u'], ['before', 'u32'], ['step', 'u32'], ['layer', 'u32']]);
const SHOT_SPILL_BLUR = gpuUniformLayout('ShotSpillBlur', [['extent', 'vec2u'], ['direction', 'vec2u'], ['sigma', 'f32'], ['radius', 'i32']]);
const SHOT_SPILL_LAY = gpuUniformLayout('ShotSpillLay', [
  ['extent', 'vec2u'], ['origin', 'vec2f'], ['maps', { vec4fArray: SHOT_LIGHT_SPILLS_MOST }], ['weights', { vec4fArray: SHOT_LIGHT_SPILLS_MOST }],
]);

// Each grid texel the mean of the emission over the `step` × `step` source texels it spans, the first `before` texels
// up and left of the picture's first;
// the picture's box is `size` texels, its texture perhaps larger.
const GATHER_WGSL = /* wgsl */ `
${SHOT_SPILL_GATHER.wgsl}
@group(0) @binding(0) var<uniform> u: ShotSpillGather;
@group(0) @binding(1) var picture: texture_2d_array<f32>;
@group(0) @binding(2) var light: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn shotSpillGather(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let size = vec2i(u.size);
  let corner = vec2i(id.xy) * i32(u.step) - vec2i(i32(u.before));
  var sum = vec3f(0.0);
  for (var y = 0; y < i32(u.step); y++) {
    for (var x = 0; x < i32(u.step); x++) {
      let t = corner + vec2i(x, y);
      if (all(t >= vec2i(0)) && all(t < size)) { sum += textureLoad(picture, t, u.layer, 0).rgb; }
    }
  }
  textureStore(light, id.xy, vec4f(sum / f32(u.step * u.step), 1.0));
}`;

const BLUR_WGSL = /* wgsl */ `
${SHOT_SPILL_BLUR.wgsl}
@group(0) @binding(0) var<uniform> u: ShotSpillBlur;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var blurred: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn shotSpillBlur(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  var sum = vec3f(0.0);
  var weights = 0.0;
  for (var k = -u.radius; k <= u.radius; k++) {
    let w = exp(-0.5 * f32(k * k) / (u.sigma * u.sigma));
    weights += w;
    let t = vec2i(id.xy) + vec2i(u.direction) * k;
    if (all(t >= vec2i(0)) && all(t < vec2i(u.extent))) { sum += w * textureLoad(source, t, 0).rgb; }
  }
  textureStore(blurred, id.xy, vec4f(sum / weights, 1.0));
}`;

/** The lay's WGSL for `count` spills over a picture of `layers` array layers, its taken share at `taken` (null: its alpha covers). */
function layWgsl(count: number, layers: number, taken: number | null) {
  const lights = Array.from({ length: count }, (_, i) => `@group(0) @binding(${4 + i}) var light${i}: texture_2d<f32>;`).join('\n');
  const gathered = Array.from({ length: count }, (_, i) => /* wgsl */ `
  {
    let m = u.maps[${i}];
    let f = vec2f(m.x * q.x - m.y * q.y + m.z, m.y * q.x + m.x * q.y + m.w);
    let e = textureSampleLevel(light${i}, linearClamp, f / vec2f(textureDimensions(light${i})), 0.0).rgb;
    gain += u.weights[${i}].x * e;
    added += u.weights[${i}].y * e;
  }`).join('');
  return /* wgsl */ `
${SHOT_SPILL_LAY.wgsl}
@group(0) @binding(0) var<uniform> u: ShotSpillLay;
@group(0) @binding(1) var picture: texture_2d_array<f32>;
@group(0) @binding(2) var lit: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var linearClamp: sampler;
${lights}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn shotSpillLay(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let t = vec2i(id.xy);
  let q = u.origin + vec2f(id.xy) + vec2f(0.5);
  var gain = vec3f(0.0);
  var added = vec3f(0.0);${gathered}
  let colour = textureLoad(picture, t, 0u, 0);
  // Added light falls only where the receiver covers: per channel for a film, by its alpha otherwise.
  let covers = ${taken === null ? 'vec3f(colour.a)' : `textureLoad(picture, t, ${taken}u, 0).rgb`};
  textureStore(lit, t, 0u, vec4f(colour.rgb * (vec3f(1.0) + gain) + added * covers, colour.a));
  for (var layer = 1u; layer < ${layers}u; layer++) { textureStore(lit, t, layer, textureLoad(picture, t, layer, 0)); }
}`;
}

/** `texture`'s first layer as a plain 2D view. */
const planeView = (texture: GPUTexture) => texture.createView({ dimension: '2d' });

/** The array layers the lens reads of a picture laid as `layers`: its colour and any taken share, emission or motion. */
const lensLayerCount = ({ taken, emission, motion }: LensLayer['layers']) => 1 + Math.max(0, ...[taken, emission, motion].flatMap((layer) => (layer === null ? [] : [layer])));

/** Light spill's passes on `owner`'s device over `stage`, its blurred lights kept in the cache's `picture` store. */
export function createShotLightSpillPass(owner: StampPaintGpuOwner, { stage, arena }: { readonly stage: StampStage; readonly arena: StampUniformArena }) {
  const { device } = owner, { margin } = stage, lights = owner.cache.store<Omit<ShotSpillLight, 'texture'>>('picture');
  const pipelineOf = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  const linearClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
  return {
    /**
     * `picture`'s emission, kept under `key` (its image's), blurred by `reach` px: null when it doesn't emit, so throws
     * no light.
     */
    light(encoder: GPUCommandEncoder, picture: StampPlanePicture, key: string, reach: number): ShotSpillLight | null {
      if (picture.emission === null) return null;
      const step = Math.max(1, Math.floor(reach / SHOT_SPILL_SIGMA_TEXELS)), sigma = reach / step, radius = Math.ceil(3 * sigma);
      const kept = JSON.stringify(['light spill', key, reach, step]), found = lights.find(kept, encoder);
      if (found) return { ...found.note, texture: found.textures[0] };
      // The grid reaches three sigmas past the picture each side, in whole texels.
      const w = Math.ceil(picture.box.w / step) + 2 * radius, h = Math.ceil(picture.box.h / step) + 2 * radius;
      const x0 = picture.box.x - margin - radius * step, y0 = picture.box.y - margin - radius * step;
      const [texture] = lights.make(kept, encoder, [{ width: w, height: h, layers: 1, format: 'rgba16float', usage }], { x0, y0, step }).textures;
      const across = owner.target('light spill across', { size: [w, h], format: 'rgba16float', usage }, encoder);
      dispatchStampCompute(device, encoder, pipelineOf(GATHER_WGSL), [
        arena.slot((views) => {
          const put = gpuUniformWriter(SHOT_SPILL_GATHER, views);
          put('extent', [w, h]);
          put('size', [picture.box.w, picture.box.h]);
          put('before', radius * step);
          put('step', step);
          put('layer', picture.emission!);
        }),
        picture.texture.createView({ dimension: '2d-array' }), planeView(texture),
      ], w, h);
      for (const [direction, from, into] of [[[1, 0], texture, across], [[0, 1], across, texture]] as const) {
        dispatchStampCompute(device, encoder, pipelineOf(BLUR_WGSL), [
          arena.slot((views) => {
            const put = gpuUniformWriter(SHOT_SPILL_BLUR, views);
            put('extent', [w, h]);
            put('direction', direction);
            put('sigma', sigma);
            put('radius', radius);
          }),
          planeView(from), planeView(into),
        ], w, h);
      }
      return { texture, x0, y0, step };
    },

    /**
     * `layer` with `spills` laid on its colour, into a target of the owner's named for `id`, the receiving plane: its
     * other layers as they were. Its texel space is the receiver's (plane px, or frame px for a three render).
     */
    lay(encoder: GPUCommandEncoder, id: string, layer: LensLayer, spills: readonly ShotSpillLaid[]): LensLayer {
      const { w, h } = layer.size, count = lensLayerCount(layer.layers);
      const lit = owner.target(`light spill ${id}`, { size: [w, h, count], format: 'rgba16float', usage }, encoder);
      // Receiver texel space to each light's grid: its map undone, then onto its grid.
      const back = spills.map(({ light: { x0, y0, step }, map }) => paintSimilarityAfter({ ma: 1 / step, mb: 0, kx: -x0 / step, ky: -y0 / step }, paintSimilarityInverse(map)));
      dispatchStampCompute(device, encoder, pipelineOf(layWgsl(spills.length, count, layer.layers.taken)), [
        arena.slot((views) => {
          const put = gpuUniformWriter(SHOT_SPILL_LAY, views);
          put('extent', [w, h]);
          put('origin', [layer.origin.x, layer.origin.y]);
          put('maps', Array.from({ length: SHOT_LIGHT_SPILLS_MOST * 4 }, (_, word) => {
            const at = back[Math.floor(word / 4)];
            return at ? [at.ma, at.mb, at.kx, at.ky][word % 4] : 0;
          }));
          put('weights', Array.from({ length: SHOT_LIGHT_SPILLS_MOST * 4 }, (_, word) => {
            const at = spills[Math.floor(word / 4)];
            return at ? [at.gain, at.added, 0, 0][word % 4] : 0;
          }));
        }),
        layer.picture, lit.createView({ dimension: '2d-array' }), linearClamp,
        ...spills.map(({ light }) => planeView(light.texture)),
      ], w, h);
      return { ...layer, picture: lit.createView({ dimension: '2d-array' }) };
    },

    dispose: () => lights.dispose(),
  };
}
