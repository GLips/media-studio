// lens-passes.ts: the lens's passes on the GPU, from a frame's layers to its image (lens-compositor.ts runs them).
// Each exposure composites its layers far to near; exposures add into a sum; a frame that moved under one exposure
// is gathered along its motion; what glows is bloomed once; the image is written linear or encoded.
//
// Light is linear and premultiplied throughout, rgba16float between passes and rgba32float in the sum.

import { gpuUniformLayout } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_FULL_FRAME_WGSL, GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import { gpuInstanceRow } from '#lib/platform/gpu/studio/gpu-instance-ring.ts';
import { LENS_DEFOCUS_LEAST, LENS_GAUSSIAN_SIGMAS } from '../models/lens-focus.ts';

const LENS_DEFOCUS_LEAST_WGSL = LENS_DEFOCUS_LEAST.toFixed(3);

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
 * texels; `clipped`, clear past its edge, else edge texels held; `distance`, unless `distances` reads its texels';
 * `visibility`, the share of it laid.
 */
export const LENS_COMPOSITE = gpuUniformLayout('LensComposite', [
  ['view', 'vec4f'], ['open', 'vec4f'], ['close', 'vec4f'], ['origin', 'vec2f'], ['size', 'vec2f'], ['clipped', 'u32'], ['distances', 'u32'], ['distance', 'f32'],
  ['visibility', 'f32'],
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
 * What a laying reads of the layer or item being laid, as WGSL expressions: its views as the shutter opens and closes,
 * its distance, whether its motion layer gives its texels' distances (null: never), and how visible it is.
 */
type LensLaidAt = { readonly open: string; readonly close: string; readonly distance: string; readonly texels: string | null; readonly visibility: string };

/** The struct a laying returns, and the similarity it maps points by: shared by every pass laying a picture. */
function lensLaidHeadWgsl({ glowing, moving }: LensFrameTargets) {
  const locations = ['@location(0) colour: vec4f', ...(glowing ? ['@location(1) emission: vec4f'] : []), ...(moving ? [`@location(${glowing ? 2 : 1}) motion: vec4f`] : [])];
  return /* wgsl */ `
struct Laid { ${locations.join(', ')} }
fn similar(m: vec4f, p: vec2f) -> vec2f { return vec2f(m.x * p.x - m.y * p.y, m.y * p.x + m.x * p.y) + m.zw; }`;
}

/**
 * A fragment's laying (`laying`) of the picture at `uv`, plane point `p`, into the frame's colour, its emission when
 * `glowing` and its motion when `moving`: the motion is the frame px a point moves over the shutter, its distance, and
 * its cover. A visibility below 1 lays that share of the picture: its colour, emission and what it takes.
 */
function lensLaidWgsl({ glowing, moving }: LensFrameTargets, layers: LensPictureLayers, laying: LensLaying, at: LensLaidAt) {
  const shown = (wgsl: string) => `(${wgsl}) * ${at.visibility}`;
  const emission = layers.emission !== null ? shown(`${sampled(layers.emission)}.rgb`) : 'vec3f(0.0)';
  const outputs = (colour: string, light: string, motion: string) => [colour, ...(glowing ? [light] : []), ...(moving ? [motion] : [])].join(', ');
  // The motion of a point p: the plane's own carries it to p ∓ v/2 as the shutter opens and closes, where the views
  // then put it.
  const motion = /* wgsl */ `
  var own = vec2f(0.0);
  var distance = ${at.distance};${layers.motion !== null ? /* wgsl */ `
  let moved = ${sampled(layers.motion)};
  if (moved.w > 1e-4) {
    own = moved.xy / moved.w;${at.texels ? `
    if (${at.texels}) { distance = moved.z / moved.w; }` : ''}
  }` : ''}
  let travel = similar(${at.close}, p + own * 0.5) - similar(${at.open}, p - own * 0.5);`;
  const laid = {
    filter: /* wgsl */ `
  let through = ${layers.taken !== null ? `1.0 - ${shown(`${sampled(layers.taken)}.rgb`)}` : 'vec3f(1.0 - colour.a)'};
  return Laid(${outputs('vec4f(through, 1.0 - colour.a)', 'vec4f(through, 1.0 - colour.a)', 'vec4f(0.0)')});`,
    add: /* wgsl */ `${moving ? motion : ''}
  return Laid(${outputs('colour', `vec4f(${emission}, 0.0)`, 'vec4f(travel, distance, colour.a)')});`,
  }[laying];
  return /* wgsl */ `
  let colour = ${shown(sampled(0))};${laid}`;
}

/** The frame pixel's centre back through view `view` (a vec4f expression) to the plane: q = m·p + k, so p = (q − k)·conj(m) / |m|². */
const unviewedWgsl = (view: string, at: string) => /* wgsl */ `
  let m = ${view}.xy;
  let d = ${at}.xy - ${view}.zw;
  let p = vec2f(d.x * m.x + d.y * m.y, d.y * m.x - d.x * m.y) / dot(m, m);`;

/**
 * The composite's WGSL, drawn twice a layer (`laying`) into the frame's colour (location 0), its emission (1) when
 * `glowing`, and its motion (next) when `moving`: binds its uniform (0), the picture as an array (1) and a linear
 * clamped sampler (2).
 */
export function lensCompositeWgsl(has: LensFrameTargets, layers: LensPictureLayers, laying: LensLaying) {
  return /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${LENS_COMPOSITE.wgsl}
@group(0) @binding(0) var<uniform> u: LensComposite;
@group(0) @binding(1) var picture: texture_2d_array<f32>;
@group(0) @binding(2) var linearClamp: sampler;
${lensLaidHeadWgsl(has)}
@fragment fn lensComposite(@builtin(position) at: vec4f) -> Laid {${unviewedWgsl('u.view', 'at')}
  let uv = (p - u.origin) / u.size;
  // Past a clipped picture's edge it's clear: nothing is laid there, by either laying.
  if (u.clipped == 1u && (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))) { discard; }${lensLaidWgsl(has, layers, laying, {
    open: 'u.open', close: 'u.close', distance: 'u.distance', texels: 'u.distances == 1u', visibility: 'u.visibility',
  })}
}`;
}

/**
 * Where a frame of `frame` px shows items laying one picture: its first texel's corner at plane point `origin`, `size`
 * texels, clear past its edge. Each item's view, its views at the shutter's ends, its distance and visibility are its
 * instance's row (LENS_ITEM_ROW).
 */
export const LENS_ITEMS = gpuUniformLayout('LensItems', [['origin', 'vec2f'], ['size', 'vec2f'], ['frame', 'vec2f']]);

/**
 * An item's instance row, lensItemsWgsl's locations 0 to 3 in order: its view, open and close (each ma, mb, kx, ky),
 * then its distance and visibility.
 */
export const LENS_ITEM_ROW = gpuInstanceRow([4, 4, 4, 2]);

/**
 * The items' WGSL, drawn as a triangle strip of 4 vertices an item (its picture's box through its view), twice an
 * item (`laying`) into the composite's targets as lensCompositeWgsl draws a layer: binds its uniform (0), the
 * picture (1) and the sampler (2); its instance rows are LENS_ITEM_ROW. Its picture's motion layer is never read.
 */
export function lensItemsWgsl(has: LensFrameTargets, layers: LensPictureLayers & { readonly motion: null }, laying: LensLaying) {
  return /* wgsl */ `
${LENS_ITEMS.wgsl}
@group(0) @binding(0) var<uniform> u: LensItems;
@group(0) @binding(1) var picture: texture_2d_array<f32>;
@group(0) @binding(2) var linearClamp: sampler;
${lensLaidHeadWgsl(has)}
struct Item {
  @builtin(position) at: vec4f,
  @location(0) @interpolate(flat) view: vec4f,
  @location(1) @interpolate(flat) open: vec4f,
  @location(2) @interpolate(flat) close: vec4f,
  @location(3) @interpolate(flat) lit: vec2f,
}
@vertex fn lensItem(@builtin(vertex_index) corner: u32, @location(0) view: vec4f, @location(1) open: vec4f, @location(2) close: vec4f, @location(3) lit: vec2f) -> Item {
  let q = similar(view, u.origin + vec2f(f32(corner & 1u), f32(corner >> 1u)) * u.size) / u.frame;
  return Item(vec4f(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0), view, open, close, lit);
}
@fragment fn lensItemLaid(item: Item) -> Laid {${unviewedWgsl('item.view', 'item.at')}
  let uv = (p - u.origin) / u.size;
  // The quad is the picture's box; a pixel its edge cuts is laid only where its centre falls inside.
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { discard; }${lensLaidWgsl(has, layers, laying, {
    open: 'item.open', close: 'item.close', distance: 'item.lit.x', texels: null, visibility: 'item.lit.y',
  })}
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
 * The gather: `taps` samples on two lines through a pixel: the neighbourhood's longest motion, and the pixel's own
 * (across the longest when it's still). What lies in front (nearer, or level, `soft` relative, and faster) and sweeps
 * over the pixel covers it for its share of the shutter, over the average of what its own sweep passes.
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
/** \`h\`'s direction, else \`fallback\`'s: a still point's sweep is the pixel it's on, whichever way it's met. */
fn direction(h: vec2f, fallback: vec2f) -> vec2f {
  if (length(h) > 1e-3) { return h / length(h); }
  if (length(fallback) > 1e-6) { return fallback / length(fallback); }
  return vec2f(1.0, 0.0);
}
/** Whether a point at \`y\` moving \`h\` each way passes over the pixel centred at \`x\`: its sweep, a pixel's edges softened. */
fn passes(x: vec2f, y: vec2f, h: vec2f) -> f32 {
  let d = x - y;
  let unit = direction(h, d);
  let along = abs(dot(d, unit));
  let across = abs(d.x * unit.y - d.y * unit.x);
  return clamp(max(length(h), 0.5) - along + 0.5, 0.0, 1.0) * clamp(1.0 - across, 0.0, 1.0);
}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn lensMotionGather(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(colour);
  if (any(id.xy >= size)) { return; }
  let x = vec2i(id.xy);
  let centre = vec2f(x) + 0.5;
  let longest = textureLoad(near, id.xy / u.tile, 0).xy;
  let cx = textureLoad(colour, x, 0);${each(`
  let ex = textureLoad(emission, x, 0);`)}
  if (length(longest) <= 0.5) {
    textureStore(gathered, x, cx);${each(`
    textureStore(gatheredEmission, x, ex);`)}
    return;
  }
  let mx = textureLoad(motion, x, 0);
  let hx = halfMotion(mx, u.reach);
  let reachX = max(length(hx), 0.5);
  let lines = array<vec2f, 2>(longest, select(vec2f(-longest.y, longest.x), hx, length(hx) >= 0.5));
  let units = array<vec2f, 2>(normalize(lines[0]), normalize(lines[1]));
  let perLine = u.taps / 2u;
  var behind = cx;
  var behindWeight = 1.0;
  var front = vec4f(0.0);
  var cover = 0.0;${each(`
  var behindEmission = ex;
  var frontEmission = vec4f(0.0);`)}
  // A fixed jitter by pixel, the same every frame: a still frame's bytes depend only on what it shows. The lines'
  // taps sit half a cell apart, so where the lines are one they don't sample the same points.
  let jitter = (fract(dot(vec2f(x), vec2f(0.7548776662, 0.5698402910))) - 0.5) * 0.5;
  for (var i = 0u; i < u.taps; i++) {
    let line = i % 2u;
    let share = 2.0 * (f32(i / 2u) + 0.25 + 0.5 * f32(line) + jitter) / f32(perLine) - 1.0;
    let at = centre + lines[line] * share;
    let y = clamp(vec2i(floor(at)), vec2i(0), vec2i(size) - 1);
    if (all(y == x)) { continue; }
    // Sweeps are measured between pixel centres: from the tap's own point, a still neighbour would pass over x.
    let yc = vec2f(y) + 0.5;
    // Each tap stands for its cell of its line, this many px.
    let cell = 2.0 * length(lines[line]) / f32(perLine);
    let my = textureLoad(motion, y, 0);
    let hy = halfMotion(my, u.reach);
    let reachY = max(length(hy), 0.5);
    let nearer = (mx.z - my.z) / max(u.soft * mx.z, 1e-6);
    let level = clamp(1.0 - abs(nearer), 0.0, 1.0);
    let ahead = (1.0 - level) * step(0.0, nearer) + level * clamp(reachY - reachX, 0.0, 1.0);
    let cy = textureLoad(colour, y, 0);${each(`
    let ey = textureLoad(emission, y, 0);`)}
    // In front: the share of the shutter y's sweep spends over x, as much of its cell as lies along that sweep. Its
    // sweep is met by both lines; each takes the part it runs along (cos²), so one met twice counts once.
    let sweep = direction(hy, centre - yc);
    let along = vec2f(dot(units[0], sweep), dot(units[1], sweep));
    let mine = select(along.x * along.x, along.y * along.y, line == 1u) / max(dot(along, along), 1e-6);
    let covers = ahead * passes(centre, yc, hy) * mine * cell * abs(dot(units[line], sweep)) / (2.0 * reachY);
    front += cy * covers;
    cover += covers;
    // Behind: what x's own sweep passes over, weighed by how much of its line the cell holds.
    let seen = (1.0 - ahead) * passes(yc, centre, hx) * cell * abs(dot(units[line], direction(hx, yc - centre)));
    behind += cy * seen;
    behindWeight += seen;${each(`
    frontEmission += ey * covers;
    behindEmission += ey * seen;`)}
  }
  // Light in front past full cover is its own average, covering all.
  let laid = min(cover, 1.0) / max(cover, 1e-6);
  textureStore(gathered, x, front * laid + behind / behindWeight * (1.0 - min(cover, 1.0)));${each(`
  textureStore(gatheredEmission, x, frontEmission * laid + behindEmission / behindWeight * (1.0 - min(cover, 1.0)));`)}
}`;
}

/**
 * One direction of a per-pixel defocus over `size` texels: `axis` 0 across, 1 down, `reach` taps each side. A texel's sigma is
 * `aperture`·|1 − `focus`/d| at its distance d, held to `most`: within half the focus, nearer still blurs no wider.
 */
export const LENS_DEFOCUS = gpuUniformLayout('LensDefocus', [['size', 'vec2f'], ['focus', 'f32'], ['aperture', 'f32'], ['most', 'f32'], ['axis', 'u32'], ['reach', 'u32']]);

/**
 * A per-pixel defocus over a two-layer picture, colour (0) and motion (1, its distance setting the sigma): binds the
 * uniform (0), source (1) and storage result (2). Each texel's own gaussian is scattered by gathering: a tap weighs
 * its kernel's value over that kernel's sum, so light is spread, never gained or lost.
 */
export function lensDefocusWgsl(workgroup: number) {
  return /* wgsl */ `
${LENS_DEFOCUS.wgsl}
@group(0) @binding(0) var<uniform> u: LensDefocus;
@group(0) @binding(1) var source: texture_2d_array<f32>;
@group(0) @binding(2) var defocused: texture_storage_2d_array<rgba16float, write>;
fn sigmaOf(motion: vec4f) -> f32 {
  if (motion.w < 1e-4) { return 0.0; }
  return min(u.most, abs(u.aperture * (1.0 - u.focus / max(motion.z / motion.w, 1e-4))));
}
// Abramowitz and Stegun 7.1.26, within 1.5e-7.
fn erf(x: f32) -> f32 {
  let t = 1.0 / (1.0 + 0.3275911 * x);
  return 1.0 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * exp(-x * x);
}
fn kernelSum(sigma: f32, reach: i32) -> f32 {
  if (sigma >= 2.0) { return sigma * 2.5066283 * erf((f32(reach) + 0.5) / (sigma * 1.4142135)); }
  var sum = 0.0;
  for (var k = -reach; k <= reach; k++) { sum += exp(-0.5 * f32(k * k) / (sigma * sigma)); }
  return sum;
}
@compute @workgroup_size(${workgroup}, ${workgroup}) fn lensDefocus(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(u.size);
  let pixel = vec2i(id.xy);
  if (any(pixel >= size)) { return; }
  let step = select(vec2i(1, 0), vec2i(0, 1), u.axis == 1u);
  var colour = vec4f(0.0);
  var motion = vec4f(0.0);
  for (var i = -i32(u.reach); i <= i32(u.reach); i++) {
    let at = pixel + step * i;
    if (any(at < vec2i(0)) || any(at >= size)) { continue; }
    let tapMotion = textureLoad(source, at, 1, 0);
    let sigma = sigmaOf(tapMotion);
    var w = select(0.0, 1.0, i == 0);
    if (sigma >= ${LENS_DEFOCUS_LEAST_WGSL}) {
      let reach = i32(ceil(${LENS_GAUSSIAN_SIGMAS} * sigma));
      if (abs(i) > reach) { continue; }
      w = exp(-0.5 * f32(i * i) / (sigma * sigma)) / kernelSum(sigma, reach);
    }
    colour += textureLoad(source, at, 0, 0) * w;
    motion += tapMotion * w;
  }
  textureStore(defocused, pixel, 0, colour);
  textureStore(defocused, pixel, 1, motion);
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
 * How the image is written. `encoded`: sRGB, opaque, dithered into bytes when `dithered`; `premultiplied`: sRGB over
 * its alpha, premultiplied by it as a browser composites a canvas, light past its alpha dropped; `linear`: linear
 * light, premultiplied, its alpha kept, for an output pass of the caller's (a tone map).
 */
export type LensImageEncoding = { readonly kind: 'encoded' | 'premultiplied'; readonly dithered: boolean } | { readonly kind: 'linear' };

/**
 * The output's WGSL: the frame's colour (1) and, with `bloom`, its bloom (2) times `strength`, added in linear light
 * and written as `encoding` says. A `half` bloom is half the frame's size each way, read bilinear through the
 * sampler (3); a `whole` one, texel for texel.
 */
export function lensOutputWgsl(bloom: 'half' | 'whole' | null, encoding: LensImageEncoding) {
  const bloomAt = bloom === 'half' ? 'textureSampleLevel(bloom, linearClamp, (vec2f(pixel) + 0.5) / vec2f(textureDimensions(colour)), 0.0)' : 'textureLoad(bloom, pixel, 0)';
  const light = bloom ? ` + max(${bloomAt}.rgb, vec3f(0.0)) * u.strength` : '';
  // An ordered dither, the same each frame, so a smooth flood doesn't band when the half floats become bytes.
  const dither = `let dither = ${encoding.kind !== 'linear' && encoding.dithered ? '(fract(dot(vec2f(pixel), vec2f(0.7548776662, 0.5698402910))) - 0.5) / 255.0' : '0.0'};`;
  const written = {
    linear: /* wgsl */ `
  let c = textureLoad(colour, pixel, 0);
  return vec4f(c.rgb${light}, c.a);`,
    encoded: /* wgsl */ `
  let linear = max(textureLoad(colour, pixel, 0).rgb, vec3f(0.0))${light};
  ${dither}
  return vec4f(clamp(srgbEncoded(linear) + dither, vec3f(0.0), vec3f(1.0)), 1.0);`,
    // A browser lays a premultiplied canvas as c + (1 − a)·behind, in encoded colour, and wants c no more than a.
    premultiplied: /* wgsl */ `
  let c = textureLoad(colour, pixel, 0);
  let a = clamp(c.a, 0.0, 1.0);
  if (a <= 0.0) { return vec4f(0.0); }
  let linear = max(c.rgb, vec3f(0.0))${light};
  ${dither}
  return vec4f(clamp(srgbEncoded(linear / a) + dither, vec3f(0.0), vec3f(1.0)) * a, a);`,
  }[encoding.kind];
  return /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${GPU_SRGB_WGSL}
${LENS_OUTPUT.wgsl}
@group(0) @binding(0) var<uniform> u: LensOutput;
@group(0) @binding(1) var colour: texture_2d<f32>;
${bloom ? '@group(0) @binding(2) var bloom: texture_2d<f32>;' : ''}
${bloom === 'half' ? '@group(0) @binding(3) var linearClamp: sampler;' : ''}
@fragment fn lensOutput(@builtin(position) at: vec4f) -> @location(0) vec4f {
  let pixel = vec2u(at.xy);${written}
}`;
}
