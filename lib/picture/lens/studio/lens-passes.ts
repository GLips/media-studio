// lens-passes.ts: the lens's passes on the GPU, from a frame's layers to its image (lens-compositor.ts runs them).
// Each exposure composites its layers far to near; exposures add into a sum; a frame that moved under one exposure
// is gathered along its motion; what glows is bloomed once; the image is written linear or encoded.
//
// Light is linear and premultiplied throughout, rgba16float between passes and rgba32float in the sum.

import { gpuUniformLayout } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_FULL_FRAME_WGSL, GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';

/**
 * A picture's array layers past its colour (0, premultiplied): `taken`, a clear film's share of what's behind it
 * that it takes, per channel (null: it's laid by its alpha); `emission`, its light to bloom; `motion`, its own motion
 * over the shutter, picture px, and its distance, each times its cover, with that cover in w.
 */
export type LensPictureLayers = { readonly taken: number | null; readonly emission: number | null; readonly motion: number | null };

/** A pipeline key naming `layers`' shape. */
export const lensPictureLayersKey = ({ taken, emission, motion }: LensPictureLayers) => `${taken !== null}|${emission !== null}|${motion !== null}`;

/**
 * Where a frame shows a picture: `view` takes plane points to frame px (p ↦ (ma + i·mb)·p + (kx + i·ky)), as do
 * `open` and `close` as the shutter opens and closes; its first texel's corner at plane point `origin`, `size`
 * texels; `clipped`, clear past its edge, else edge texels held; `distance`, unless `distances` reads its texels'.
 */
export const LENS_COMPOSITE = gpuUniformLayout('LensComposite', [
  ['view', 'vec4f'], ['open', 'vec4f'], ['close', 'vec4f'], ['origin', 'vec2f'], ['size', 'vec2f'], ['clipped', 'u32'], ['distances', 'u32'], ['distance', 'f32'],
]);

/**
 * How a picture is laid: `filter` multiplies what's behind, colour and emission, by what the picture lets through;
 * `add` adds its colour and emission, and lays its motion over the frame's by its cover. The two make `over` for a
 * picture laid by its alpha.
 */
export type LensLaying = 'filter' | 'add';

/** What the frame being composited holds besides its colour: an emission when anything glows, a motion when anything moved. */
export type LensFrameTargets = { readonly glowing: boolean; readonly moving: boolean };

const sampled = (layer: number) => `textureSampleLevel(picture, linearClamp, uv, ${layer}u, 0.0)`;

/**
 * The composite's WGSL, drawn twice a layer (`laying`) into the frame's colour (location 0), its emission (1) when
 * `glowing`, and its motion (next) when `moving`: binds its uniform (0), the picture as an array (1) and a linear
 * clamped sampler (2). The motion is the frame px a point moves over the shutter, its distance, and its cover.
 */
export function lensCompositeWgsl({ glowing, moving }: LensFrameTargets, layers: LensPictureLayers, laying: LensLaying) {
  const emission = layers.emission !== null ? `${sampled(layers.emission)}.rgb` : 'vec3f(0.0)';
  const outputs = (colour: string, light: string, motion: string) => [colour, ...(glowing ? [light] : []), ...(moving ? [motion] : [])].join(', ');
  // The motion of a point p: the plane's own carries it to p ∓ v/2 as the shutter opens and closes, where the views
  // then put it.
  const motion = /* wgsl */ `
  var own = vec2f(0.0);
  var distance = u.distance;${layers.motion !== null ? /* wgsl */ `
  let moved = ${sampled(layers.motion)};
  if (moved.w > 1e-4) {
    own = moved.xy / moved.w;
    if (u.distances == 1u) { distance = moved.z / moved.w; }
  }` : ''}
  let travel = similar(u.close, p + own * 0.5) - similar(u.open, p - own * 0.5);`;
  const laid = {
    filter: /* wgsl */ `
  let through = ${layers.taken !== null ? `1.0 - ${sampled(layers.taken)}.rgb` : 'vec3f(1.0 - colour.a)'};
  return Laid(${outputs('vec4f(through, 1.0 - colour.a)', 'vec4f(through, 1.0 - colour.a)', 'vec4f(0.0)')});`,
    add: /* wgsl */ `${moving ? motion : ''}
  return Laid(${outputs('colour', `vec4f(${emission}, 0.0)`, 'vec4f(travel, distance, colour.a)')});`,
  }[laying];
  const locations = ['@location(0) colour: vec4f', ...(glowing ? ['@location(1) emission: vec4f'] : []), ...(moving ? [`@location(${glowing ? 2 : 1}) motion: vec4f`] : [])];
  return /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${LENS_COMPOSITE.wgsl}
@group(0) @binding(0) var<uniform> u: LensComposite;
@group(0) @binding(1) var picture: texture_2d_array<f32>;
@group(0) @binding(2) var linearClamp: sampler;
struct Laid { ${locations.join(', ')} }
fn similar(m: vec4f, p: vec2f) -> vec2f { return vec2f(m.x * p.x - m.y * p.y, m.y * p.x + m.x * p.y) + m.zw; }
@fragment fn lensComposite(@builtin(position) at: vec4f) -> Laid {
  // The frame pixel's centre back through the view to the plane: q = m·p + k, so p = (q − k)·conj(m) / |m|².
  let m = u.view.xy;
  let d = at.xy - u.view.zw;
  let p = vec2f(d.x * m.x + d.y * m.y, d.y * m.x - d.x * m.y) / dot(m, m);
  let uv = (p - u.origin) / u.size;
  // Past a clipped picture's edge it's clear: nothing is laid there, by either laying.
  if (u.clipped == 1u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) { discard; }
  let colour = ${sampled(0)};${laid}
}`;
}

/** The blend each laying draws its colour and emission with. */
export const LENS_LAYING_BLEND: Record<LensLaying, GPUBlendState> = {
  filter: { color: { srcFactor: 'zero', dstFactor: 'src', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'src-alpha', operation: 'add' } },
  add: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } },
};

/** A motion laid over the frame's by its cover, in w; the filter laying leaves it alone. */
export const LENS_MOTION_BLEND: GPUBlendState = {
  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

/** An exposure's share of its frame. */
export const LENS_SUM = gpuUniformLayout('LensSum', [['weight', 'f32']]);

/**
 * The sum's WGSL: adds an exposure's colour (1) and, when `glowing`, its emission (2), times `weight`, into the sum's
 * colour and emission (none for an exposure that doesn't glow).
 */
export function lensSumWgsl(glowing: boolean) {
  return /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${LENS_SUM.wgsl}
@group(0) @binding(0) var<uniform> u: LensSum;
@group(0) @binding(1) var colour: texture_2d<f32>;
${glowing ? '@group(0) @binding(2) var emission: texture_2d<f32>;' : ''}
struct Added { @location(0) colour: vec4f, @location(1) emission: vec4f }
@fragment fn lensSum(@builtin(position) at: vec4f) -> Added {
  let pixel = vec2u(at.xy);
  return Added(textureLoad(colour, pixel, 0) * u.weight, ${glowing ? 'textureLoad(emission, pixel, 0) * u.weight' : 'vec4f(0.0)'});
}`;
}

/**
 * The motion gather's tiles: `tile` px a side, each a reach of `reach` px at most. A point moving v over the shutter
 * is seen from v/2 before its place to v/2 after it, so a tile keeps the longest half-motion it holds.
 */
export const LENS_MOTION_TILES = gpuUniformLayout('LensMotionTiles', [['tile', 'u32'], ['reach', 'f32']]);

const halfMotionWgsl = /* wgsl */ `
fn halfMotion(m: vec4f, reach: f32) -> vec2f {
  let v = m.xy * 0.5;
  let l = length(v);
  return select(v, v * (reach / l), l > reach);
}`;

/** The tile pass's WGSL: binds its uniform (0), the frame's motion (1) and its tiles (2), one invocation a tile. */
export function lensMotionTilesWgsl(workgroup: number) {
  return /* wgsl */ `
${LENS_MOTION_TILES.wgsl}
@group(0) @binding(0) var<uniform> u: LensMotionTiles;
@group(0) @binding(1) var motion: texture_2d<f32>;
@group(0) @binding(2) var tiles: texture_storage_2d<rgba16float, write>;
${halfMotionWgsl}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn lensMotionTiles(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(tiles))) { return; }
  let size = textureDimensions(motion);
  var longest = vec2f(0.0);
  for (var y = id.y * u.tile; y < min(size.y, (id.y + 1u) * u.tile); y++) {
    for (var x = id.x * u.tile; x < min(size.x, (id.x + 1u) * u.tile); x++) {
      let v = halfMotion(textureLoad(motion, vec2u(x, y), 0), u.reach);
      if (dot(v, v) > dot(longest, longest)) { longest = v; }
    }
  }
  textureStore(tiles, id.xy, vec4f(longest, 0.0, 0.0));
}`;
}

/** The neighbourhood pass's WGSL: each tile's longest of its own and its eight neighbours' (1, read; 2, written). */
export function lensMotionNeighboursWgsl(workgroup: number) {
  return /* wgsl */ `
@group(0) @binding(1) var tiles: texture_2d<f32>;
@group(0) @binding(2) var near: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${workgroup}, ${workgroup}) fn lensMotionNeighbours(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(textureDimensions(tiles));
  if (any(vec2i(id.xy) >= size)) { return; }
  var longest = vec2f(0.0);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let at = vec2i(id.xy) + vec2i(dx, dy);
      if (any(at < vec2i(0)) || any(at >= size)) { continue; }
      let v = textureLoad(tiles, at, 0).xy;
      if (dot(v, v) > dot(longest, longest)) { longest = v; }
    }
  }
  textureStore(near, id.xy, vec4f(longest, 0.0, 0.0));
}`;
}

/**
 * The gather: `taps` samples along the neighbourhood's longest motion, each counted as far as its own motion or
 * this pixel's reaches it, nearer over farther (McGuire et al., 2012, "A Reconstruction Filter for Plausible Motion
 * Blur"); distances within `soft` of each other, relative, count as one depth.
 */
export const LENS_MOTION_GATHER = gpuUniformLayout('LensMotionGather', [['tile', 'u32'], ['taps', 'u32'], ['reach', 'f32'], ['soft', 'f32']]);

/**
 * The gather's WGSL: binds its uniform (0), the frame's colour (1), its motion (2), the neighbourhoods (3), the
 * gathered colour (4) and, when `glowing`, the emission (5) and gathered emission (6).
 */
export function lensMotionGatherWgsl(glowing: boolean, workgroup: number) {
  const each = (what: string) => (glowing ? what : '');
  return /* wgsl */ `
${LENS_MOTION_GATHER.wgsl}
@group(0) @binding(0) var<uniform> u: LensMotionGather;
@group(0) @binding(1) var colour: texture_2d<f32>;
@group(0) @binding(2) var motion: texture_2d<f32>;
@group(0) @binding(3) var near: texture_2d<f32>;
@group(0) @binding(4) var gathered: texture_storage_2d<rgba16float, write>;
${each(`@group(0) @binding(5) var emission: texture_2d<f32>;
@group(0) @binding(6) var gatheredEmission: texture_storage_2d<rgba16float, write>;`)}
${halfMotionWgsl}
fn cone(d: f32, reach: f32) -> f32 { return clamp(1.0 - d / reach, 0.0, 1.0); }
fn cylinder(d: f32, reach: f32) -> f32 { return 1.0 - smoothstep(0.95 * reach, 1.05 * reach, d); }
/** How surely a point at distance a is at or before one at b: 1 nearer, 0 past it by soft·b. */
fn before(a: f32, b: f32) -> f32 { return clamp(1.0 - (a - b) / max(u.soft * b, 1e-6), 0.0, 1.0); }
@compute @workgroup_size(${workgroup}, ${workgroup}) fn lensMotionGather(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(colour);
  if (any(id.xy >= size)) { return; }
  let x = vec2i(id.xy);
  let longest = textureLoad(near, id.xy / u.tile, 0).xy;
  let cx = textureLoad(colour, x, 0);${each(`
  let ex = textureLoad(emission, x, 0);`)}
  if (length(longest) <= 0.5) {
    textureStore(gathered, x, cx);${each(`
    textureStore(gatheredEmission, x, ex);`)}
    return;
  }
  let mx = textureLoad(motion, x, 0);
  let reachX = max(length(halfMotion(mx, u.reach)), 0.5);
  var weight = 1.0 / reachX;
  var sum = cx * weight;${each(`
  var sumEmission = ex * weight;`)}
  // A fixed jitter by pixel, the same every frame: a still frame's bytes depend only on what it shows.
  let jitter = fract(dot(vec2f(x), vec2f(0.7548776662, 0.5698402910))) - 0.5;
  for (var i = 0u; i < u.taps; i++) {
    let share = mix(-1.0, 1.0, (f32(i) + jitter + 1.0) / f32(u.taps + 1u));
    let y = clamp(vec2i(floor(vec2f(x) + 0.5 + longest * share)), vec2i(0), vec2i(size) - 1);
    if (all(y == x)) { continue; }
    let my = textureLoad(motion, y, 0);
    let reachY = max(length(halfMotion(my, u.reach)), 0.5);
    let d = length(vec2f(y - x));
    // y seen over x where it's nearer and its motion reaches x; x's own blur shows y behind it as far as it reaches.
    let w = before(my.z, mx.z) * cone(d, reachY) + before(mx.z, my.z) * cone(d, reachX) + cylinder(d, reachY) * cylinder(d, reachX) * 2.0;
    weight += w;
    sum += textureLoad(colour, y, 0) * w;${each(`
    sumEmission += textureLoad(emission, y, 0) * w;`)}
  }
  textureStore(gathered, x, sum / weight);${each(`
  textureStore(gatheredEmission, x, sumEmission / weight);`)}
}`;
}

/** A bloom's source from colour: its light past `threshold` (by luminance, its hue kept). */
export const LENS_GLOW = gpuUniformLayout('LensGlow', [['threshold', 'f32']]);

/** The glow pass's WGSL: binds its uniform (0), the colour (1) and the glow written (2). */
export function lensGlowWgsl(workgroup: number) {
  return /* wgsl */ `
${LENS_GLOW.wgsl}
@group(0) @binding(0) var<uniform> u: LensGlow;
@group(0) @binding(1) var colour: texture_2d<f32>;
@group(0) @binding(2) var glow: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${workgroup}, ${workgroup}) fn lensGlow(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(glow))) { return; }
  let c = max(textureLoad(colour, id.xy, 0).rgb, vec3f(0.0));
  let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  textureStore(glow, id.xy, vec4f(c * (max(0.0, luma - u.threshold) / max(luma, 1e-4)), 0.0));
}`;
}

/** The image's bloom: its strength. */
export const LENS_OUTPUT = gpuUniformLayout('LensOutput', [['strength', 'f32']]);

/**
 * How the image is written. `encoded`: sRGB, opaque, dithered into bytes when `dithered`; `linear`: linear light,
 * premultiplied, its alpha kept, for an output pass of the caller's (a tone map).
 */
export type LensImageEncoding = { readonly kind: 'encoded'; readonly dithered: boolean } | { readonly kind: 'linear' };

/**
 * The output's WGSL: the frame's colour (1) and, when `blooming`, its bloom (2) times `strength`, added in linear
 * light and written as `encoding` says.
 */
export function lensOutputWgsl(blooming: boolean, encoding: LensImageEncoding) {
  const light = blooming ? ' + max(textureLoad(bloom, pixel, 0).rgb, vec3f(0.0)) * u.strength' : '';
  const written = encoding.kind === 'linear' ? /* wgsl */ `
  let c = textureLoad(colour, pixel, 0);
  return vec4f(c.rgb${light}, c.a);` : /* wgsl */ `
  let linear = max(textureLoad(colour, pixel, 0).rgb, vec3f(0.0))${light};
  // An ordered dither, the same each frame, so a smooth flood doesn't band when the half floats become bytes.
  let dither = ${encoding.dithered ? '(fract(dot(vec2f(pixel), vec2f(0.7548776662, 0.5698402910))) - 0.5) / 255.0' : '0.0'};
  return vec4f(clamp(srgbEncoded(linear) + dither, vec3f(0.0), vec3f(1.0)), 1.0);`;
  return /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${GPU_SRGB_WGSL}
${LENS_OUTPUT.wgsl}
@group(0) @binding(0) var<uniform> u: LensOutput;
@group(0) @binding(1) var colour: texture_2d<f32>;
${blooming ? '@group(0) @binding(2) var bloom: texture_2d<f32>;' : ''}
@fragment fn lensOutput(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let pixel = vec2u(at.xy);${written}
}`;
}
