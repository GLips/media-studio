// stamp-paint-renderer.ts: draws a compiled stamp painting (lib/picture/stamp-paint/models/stamp-paint-recipe.ts) at a
// moment, on the GPU. Each frame starts from bare paper and paints every group again, so a frame depends only on its
// time: nothing a tab drew before survives into the next, and only images and stamp buffers are kept between frames.
//
// A deposit is painted in four steps, each within the box its visible stamps reach:
//   1. its stamps, instanced, accumulate into a coverage mask: the brush's in red, its dual's in green. A glaze
//      brush's stroke is its densest stamp at each point, so it reaches at most its flow however densely it's stamped
//      and keeps its tip's edge; a build brush's stamps lay over each other, so its overlaps darken.
//   2. the mask is blurred, when the brush has wet or burnt edges: the rim is where the mask stands above its blur.
//   3. the coverage is resolved: edges, texturized grain, the dual combined by its blend, the paper's tooth, protected
//      regions, the clipping pass and the deposit's opacity.
//   4. the compositor lays it onto its group's layer (stamp-paint-compositor.ts), and a finished group onto the painting.
//
// Grain is read relative to its own mean paint (its smallest mip): where it holds less paint than on average it cuts
// the stamp in proportion, and where more it leaves it whole, so its texture shows at full strength without its
// overall tone thinning every stroke.

import type { StampBrushAsset, StampBrushLayer, StampDualBlend } from '../models/stamp-brush.ts';
import { visibleStampCountAt, type CompiledStampDeposit, type CompiledStampPaint, type StampRegion } from '../models/stamp-paint-recipe.ts';
import type { PlacedStamp } from '../models/stamp-placement.ts';
import { coarsestStampTipLevel, STAMP_TIP_HULL_SIDES, stampTipHull, type StampTipHull, type StampTipLevel } from '../models/stamp-tip-hull.ts';
import type { StampPaintPaper } from '../models/style.ts';
import { createFlatStampCompositor, type StampPaintCompositor } from './stamp-paint-compositor.ts';
import {
  bindPaintGlTarget, bindPaintGlTexture, createPaintGl, createPaintGlImageTexture, createPaintGlPingPong, createPaintGlProgram,
  createPaintGlTarget, deletePaintGlTarget, drawFullFrame, FULL_FRAME_VERTEX, type PaintGlBox, type PaintGlProgram, type PaintGlTarget,
} from './stamp-paint-gl.ts';

/** Floats per stamp in the instance buffer: x, y, diameter, rotation, alpha. */
const STAMP_FLOATS = 5;

/**
 * How far a grain's texture is stretched about its mean. The pack's grains are soft photographs that Procreate
 * sharpens with each brush's grain contrast, which the import drops; this stands in for it, set by eye against the
 * previews.
 */
const GRAIN_CONTRAST = 2.5;

const GRAIN_GLSL = `
float grainCut(sampler2D grain, vec2 uv, float depth, float contrast) {
  float paint = 1.0 - texture(grain, uv).r;
  float mean = 1.0 - textureLod(grain, vec2(0.5), 16.0).r;
  return mix(1.0, clamp(1.0 + (paint / max(mean, 0.01) - 1.0) * contrast, 0.0, 1.0), depth);
}
float grainCut(sampler2D grain, vec2 uv, float depth) {
  return grainCut(grain, uv, depth, ${GRAIN_CONTRAST.toFixed(1)});
}`;

// A stamp is drawn as its tip's hull (stamp-tip-hull.ts), a fan of triangles from its first vertex, in the tip's UV
// square. Its place on the tip is interpolated, not worked out from its pixel: Apple's GPUs fetch a texel at an
// interpolated place before the shader runs, and a computed one took twice as long.
const STAMP_VERTEX = `#version 300 es
layout(location = 0) in vec4 stamp;
layout(location = 1) in float alpha;
uniform vec2 resolution;
uniform float roundness;
uniform vec2 hull[${STAMP_TIP_HULL_SIDES}];
out vec2 tipUv;
out float stampAlpha;
void main() {
  tipUv = hull[gl_VertexID];
  vec2 offset = (tipUv - 0.5) * vec2(1.0, roundness) * stamp.z;
  float s = sin(stamp.w), c = cos(stamp.w);
  vec2 at = stamp.xy + vec2(c * offset.x - s * offset.y, s * offset.x + c * offset.y);
  stampAlpha = alpha;
  gl_Position = vec4(at / resolution * 2.0 - 1.0, 0.0, 1.0);
}`;

const STAMP_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D tip;
uniform sampler2D grain;
uniform bool rolling;
uniform float grainScale;
uniform float grainDepth;
uniform vec4 channel;
in vec2 tipUv;
in float stampAlpha;
out vec4 result;
${GRAIN_GLSL}
void main() {
  float coverage = 1.0 - texture(tip, tipUv).r;
  if (rolling) coverage *= grainCut(grain, (tipUv - 0.5) / grainScale + 0.5, grainDepth);
  result = channel * coverage * stampAlpha;
}`;

const BLUR_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec2 sourceSize;
uniform vec2 targetSize;
uniform vec2 direction;
uniform float sigma;
out vec4 result;
void main() {
  vec2 uv = gl_FragCoord.xy / targetSize;
  vec2 step = direction / sourceSize;
  int reach = int(min(40.0, ceil(sigma * 2.5)));
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -40; i <= 40; i++) {
    if (i < -reach || i > reach) continue;
    float w = exp(-0.5 * float(i * i) / (sigma * sigma));
    sum += texture(source, uv + step * float(i)) * w;
    total += w;
  }
  result = sum / total;
}`;

const RESOLVE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D mask;
uniform sampler2D blurred;
uniform vec2 resolution;
uniform vec2 edges;
uniform vec2 dualEdges;
uniform sampler2D grain;
uniform bool texturized;
uniform vec2 grainTile;
uniform float grainDepth;
uniform bool dual;
uniform int dualBlend;
uniform sampler2D dualGrain;
uniform bool dualTexturized;
uniform vec2 dualGrainTile;
uniform float dualGrainDepth;
uniform bool paper;
uniform sampler2D paperGrain;
uniform vec2 paperTile;
uniform float paperDepth;
uniform bool protectOn;
uniform sampler2D protect;
uniform bool clipped;
uniform sampler2D clip;
uniform float opacity;
out vec4 result;
${GRAIN_GLSL}

// A wet edge thins the body and gathers pigment in a rim; a burnt edge darkens the rim alone.
float edged(float a, float soft, vec2 strength) {
  if (strength.x <= 0.0 && strength.y <= 0.0) return a;
  float rim = clamp((a - soft) * 4.0, 0.0, 1.0);
  return clamp(a * (1.0 - 0.35 * strength.x) + rim * (0.7 * strength.x + 1.1 * strength.y), 0.0, 1.0);
}

// The dual brush's coverage d combined with the brush's m by its blend (as DUAL_BLENDS orders them), each coverage read
// as the brightness of white paint, as Procreate's layer blends read it; then held to where the brush has paint.
float combined(float m, float d) {
  float c = m * d;
  if (dualBlend == 0) c = d;
  else if (dualBlend == 2) c = m + d - m * d;
  else if (dualBlend == 3) c = m < 0.5 ? 2.0 * m * d : 1.0 - 2.0 * (1.0 - m) * (1.0 - d);
  else if (dualBlend == 4) c = min(m, d);
  else if (dualBlend == 5) c = max(m, d);
  else if (dualBlend == 6) c = d <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - m) / d);
  else if (dualBlend == 7) c = abs(m - d);
  else if (dualBlend == 8) c = max(0.0, m + d - 1.0);
  return c * clamp(m * 8.0, 0.0, 1.0);
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec2 uv = gl_FragCoord.xy / resolution;
  vec4 raw = texelFetch(mask, pixel, 0);
  vec4 soft = texture(blurred, uv);
  float m = edged(raw.r, soft.r, edges);
  if (texturized) m *= grainCut(grain, gl_FragCoord.xy / grainTile, grainDepth);
  if (dual) {
    float d = edged(raw.g, soft.g, dualEdges);
    if (dualTexturized) d *= grainCut(dualGrain, gl_FragCoord.xy / dualGrainTile, dualGrainDepth);
    m = combined(m, d);
  }
  // A paper's tooth was photographed, not drawn as a brush grain is, and needs no stretching.
  if (paper) m *= grainCut(paperGrain, gl_FragCoord.xy / paperTile, paperDepth, 1.0);
  if (protectOn) m *= 1.0 - texelFetch(protect, pixel, 0).r;
  if (clipped) m *= clamp(texelFetch(clip, pixel, 0).r, 0.0, 1.0);
  result = vec4(clamp(m, 0.0, 1.0) * opacity);
}`;

const REGION_VERTEX = `#version 300 es
layout(location = 0) in vec2 point;
uniform vec2 resolution;
void main() { gl_Position = vec4(point / resolution * 2.0 - 1.0, 0.0, 1.0); }`;

const REGION_FRAGMENT = `#version 300 es
precision highp float;
uniform bool ellipse;
uniform vec4 shape;
out vec4 result;
void main() {
  if (ellipse) {
    vec2 d = (gl_FragCoord.xy - shape.xy) / shape.zw;
    if (dot(d, d) > 1.0) discard;
  }
  result = vec4(1.0);
}`;

const PAPER_FRAGMENT = `#version 300 es
precision highp float;
uniform vec3 color;
uniform bool hasImage;
uniform sampler2D image;
uniform vec2 resolution;
uniform vec2 cover;
out vec4 result;
void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  result = vec4(hasImage ? texture(image, (uv - 0.5) * cover + 0.5).rgb : color, 1.0);
}`;

const OUTPUT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D painting;
uniform vec2 resolution;
out vec4 result;
void main() {
  // The painting's targets hold its top row first; the canvas shows its first row at the bottom.
  vec2 pixel = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y);
  vec3 color = texelFetch(painting, ivec2(pixel), 0).rgb;
  // An ordered dither, the same each frame, so a smooth wash doesn't band when the half floats become bytes.
  float dither = (fract(dot(floor(gl_FragCoord.xy), vec2(0.7548776662, 0.5698402910))) - 0.5) / 255.0;
  result = vec4(clamp(color + dither, 0.0, 1.0), 1.0);
}`;

const DUAL_BLENDS: readonly StampDualBlend[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'colorBurn', 'difference', 'linearHeight'];

const assetKey = ({ style, pack, file }: StampBrushAsset) => `${style}/${pack}/${file}`;

/** Every image a painting and its paper need, each once, with how it wraps: a grain tiles, a tip or photograph doesn't. */
function paintingImages(painting: CompiledStampPaint, paper: StampPaintPaper): [StampBrushAsset, 'tile' | 'clamp'][] {
  const assets = painting.groups.flatMap((group) => group.passes.flatMap((pass) => pass.deposits.flatMap(({ brush }) =>
    [brush, ...(brush.dual ? [brush.dual] : [])].flatMap((layer): [StampBrushAsset, 'tile' | 'clamp'][] => [[layer.tip.image, 'clamp'], ...(layer.grain ? [[layer.grain.image, 'tile'] satisfies [StampBrushAsset, 'tile']] : [])]))));
  if (paper.image) assets.push([paper.image, 'clamp']);
  if (paper.grain) assets.push([paper.grain.image, 'tile']);
  return [...new Map(assets.map((entry) => [assetKey(entry[0]), entry])).values()];
}

/** Where a deposit's stamps sit in the painting's instance buffer, in stamps, and the smallest of each (px across). */
type DepositStamps = { main: number; dual: number; smallest: number; smallestDual: number };

export type StampPaintRenderer = {
  /** Draws `painting` as it stands `t` seconds into its scene. */
  draw: (t: number) => void;
  /** Waits for the GPU to finish what's been drawn, by reading a pixel back: for timing a draw, which a render never needs. */
  finish: () => void;
  dispose: () => void;
};

type LoadedImage = { texture: WebGLTexture; width: number; height: number };

/**
 * A renderer for one painting on `canvas`, `width` by `height` of the painting's pixels. It resolves once every image
 * is loaded and on the GPU; `images` maps each image to its URL.
 */
export async function createStampPaintRenderer(
  canvas: HTMLCanvasElement, painting: CompiledStampPaint, paper: StampPaintPaper, width: number, height: number, imageUrl: (asset: StampBrushAsset) => string,
): Promise<StampPaintRenderer> {
  const gl = createPaintGl(canvas);
  const images = new Map<string, LoadedImage>();
  const assets = paintingImages(painting, paper);
  const decoded = await Promise.all(assets.map(async ([asset]) => {
    const image = new Image();
    image.src = imageUrl(asset);
    await image.decode();
    return image;
  }));
  for (const [i, [asset, wrap]] of assets.entries()) {
    // The paper's photograph is the one image whose colour is read.
    const channels = paper.image && assetKey(asset) === assetKey(paper.image) ? 'colour' : 'red';
    images.set(assetKey(asset), { texture: createPaintGlImageTexture(gl, decoded[i], wrap, channels), width: decoded[i].width, height: decoded[i].height });
  }
  const image = (asset: StampBrushAsset) => images.get(assetKey(asset))!;

  // Each tip's paint at every mip level, read back as the GPU samples it; its hulls are made as draws ask for them.
  const tipLevels = new Map<string, StampTipLevel[]>();
  const readback = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, readback);
  for (const [asset, wrap] of assets) {
    const { texture, width: w, height: h } = image(asset);
    if (wrap !== 'clamp' || (paper.image && assetKey(asset) === assetKey(paper.image))) continue;
    const levels: StampTipLevel[] = [];
    for (let level = 0; level <= Math.floor(Math.log2(Math.max(w, h))); level++) {
      const lw = Math.max(1, w >> level), lh = Math.max(1, h >> level), texels = new Uint8Array(lw * lh * 4);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, level);
      gl.readPixels(0, 0, lw, lh, gl.RGBA, gl.UNSIGNED_BYTE, texels);
      levels.push({ width: lw, height: lh, rows: Array.from({ length: lh }, (_, y) => {
        let first = -1, last = -1;
        for (let x = 0; x < lw; x++) {
          if (texels[(y * lw + x) * 4] === 255) continue;
          if (first < 0) first = x;
          last = x;
        }
        return first < 0 ? null : [first, last];
      }) });
    }
    tipLevels.set(assetKey(asset), levels);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(readback);
  const hulls = new Map<string, StampTipHull>();
  /** The hull `layer`'s tip is drawn in when its smallest stamp is `smallest` px across. */
  function tipHull(layer: StampBrushLayer, smallest: number): StampTipHull {
    const levels = tipLevels.get(assetKey(layer.tip.image))!;
    const coarsest = coarsestStampTipLevel(levels[0], smallest, layer.tip.roundness, levels.length);
    const key = `${assetKey(layer.tip.image)}@${coarsest}`;
    if (!hulls.has(key)) hulls.set(key, stampTipHull(levels, coarsest));
    return hulls.get(key)!;
  }

  // Every deposit's stamps, then its dual's, in one buffer; a draw points its attributes at its own.
  const placed = new Map<CompiledStampDeposit, DepositStamps>();
  let total = 0;
  for (const group of painting.groups) for (const pass of group.passes) for (const deposit of pass.deposits) {
    const smallest = (stamps: readonly PlacedStamp[]) => stamps.reduce((least, s) => Math.min(least, s.diameter), Infinity);
    placed.set(deposit, { main: total, dual: total + deposit.stamps.length, smallest: smallest(deposit.stamps), smallestDual: smallest(deposit.dualStamps) });
    total += deposit.stamps.length + deposit.dualStamps.length;
  }
  const data = new Float32Array(Math.max(1, total) * STAMP_FLOATS);
  const write = (stamps: readonly PlacedStamp[], at: number) => stamps.forEach((s, i) => data.set([s.x, s.y, s.diameter, s.rotation, s.alpha], (at + i) * STAMP_FLOATS));
  for (const [deposit, { main, dual }] of placed) {
    write(deposit.stamps, main);
    write(deposit.dualStamps, dual);
  }
  const stampBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, stampBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const stampVao = gl.createVertexArray()!;
  // The fan's triangles, by corner: indexed, so each corner is shaded once a stamp, not once for each triangle it's in.
  const fanBuffer = gl.createBuffer()!;
  gl.bindVertexArray(stampVao);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fanBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array(Array.from({ length: STAMP_TIP_HULL_SIDES - 2 }, (_, i) => [0, i + 1, i + 2]).flat()), gl.STATIC_DRAW);
  const regionBuffer = gl.createBuffer()!;
  const regionVao = gl.createVertexArray()!;
  gl.bindVertexArray(regionVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, regionBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const emptyVao = gl.createVertexArray()!;
  gl.bindVertexArray(null);

  const programs = {
    stamp: createPaintGlProgram(gl, STAMP_VERTEX, STAMP_FRAGMENT),
    blur: createPaintGlProgram(gl, FULL_FRAME_VERTEX, BLUR_FRAGMENT),
    resolve: createPaintGlProgram(gl, FULL_FRAME_VERTEX, RESOLVE_FRAGMENT),
    region: createPaintGlProgram(gl, REGION_VERTEX, REGION_FRAGMENT),
    paper: createPaintGlProgram(gl, FULL_FRAME_VERTEX, PAPER_FRAGMENT),
    output: createPaintGlProgram(gl, FULL_FRAME_VERTEX, OUTPUT_FRAGMENT),
  };
  const halfW = Math.ceil(width / 2), halfH = Math.ceil(height / 2);
  const targets = {
    painting: createPaintGlPingPong(gl, width, height),
    layer: createPaintGlPingPong(gl, width, height),
    mask: createPaintGlTarget(gl, width, height),
    blurA: createPaintGlTarget(gl, halfW, halfH),
    blurB: createPaintGlTarget(gl, halfW, halfH),
    coverage: createPaintGlTarget(gl, width, height),
    clip: createPaintGlTarget(gl, width, height),
    protect: createPaintGlTarget(gl, width, height),
    region: createPaintGlTarget(gl, width, height),
  };
  const compositor: StampPaintCompositor = createFlatStampCompositor(gl);
  const whole: PaintGlBox = { x: 0, y: 0, w: width, h: height };
  const resolution = [width, height] as const;

  const clear = (target: PaintGlTarget, box: PaintGlBox) => {
    bindPaintGlTarget(gl, target, box);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  function drawStamps(layer: StampBrushLayer, first: number, count: number, smallest: number, channel: readonly number[]) {
    if (!count) return;
    const program = programs.stamp;
    program.use();
    gl.bindVertexArray(stampVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, stampBuffer);
    const stride = STAMP_FLOATS * 4, offset = first * stride;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, offset + 16);
    gl.vertexAttribDivisor(1, 1);
    gl.uniform2fv(program.uniform('resolution'), resolution);
    gl.uniform1f(program.uniform('roundness'), layer.tip.roundness);
    const hull = tipHull(layer, smallest);
    gl.uniform2fv(program.uniform('hull'), hull);
    gl.uniform4fv(program.uniform('channel'), channel);
    bindPaintGlTexture(gl, program, 'tip', 0, image(layer.tip.image).texture);
    const rolling = layer.grain?.mode === 'rolling' && layer.grain.depth > 0;
    gl.uniform1i(program.uniform('rolling'), rolling ? 1 : 0);
    bindPaintGlTexture(gl, program, 'grain', 1, rolling ? image(layer.grain!.image).texture : null);
    gl.uniform1f(program.uniform('grainScale'), layer.grain?.scale ?? 1);
    gl.uniform1f(program.uniform('grainDepth'), layer.grain?.depth ?? 0);
    gl.enable(gl.BLEND);
    // A glaze stroke is as dense as its densest stamp at each point, so it never builds past its flow within itself and
    // keeps its tip's edge; a build stroke's stamps each lay over what it has so far: c ← s + c(1 − s).
    if (layer.accumulation === 'glaze') gl.blendEquation(gl.MAX);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    gl.colorMask(channel[0] > 0, channel[1] > 0, false, false);
    gl.drawElementsInstanced(gl.TRIANGLES, (hull.length / 2 - 2) * 3, gl.UNSIGNED_BYTE, 0, count);
    gl.colorMask(true, true, true, true);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  function blurMask(sigma: number, box: PaintGlBox) {
    const half = { x: Math.floor(box.x / 2), y: Math.floor(box.y / 2), w: Math.ceil(box.w / 2) + 1, h: Math.ceil(box.h / 2) + 1 };
    const program = programs.blur;
    const pass = (source: PaintGlTarget, target: PaintGlTarget, direction: readonly number[]) => {
      bindPaintGlTarget(gl, target, half);
      program.use();
      gl.bindVertexArray(emptyVao);
      bindPaintGlTexture(gl, program, 'source', 0, source.texture);
      gl.uniform2fv(program.uniform('sourceSize'), [source.width, source.height]);
      gl.uniform2fv(program.uniform('targetSize'), [target.width, target.height]);
      gl.uniform2fv(program.uniform('direction'), direction);
      gl.uniform1f(program.uniform('sigma'), Math.max(0.5, sigma / 2));
      drawFullFrame(gl);
    };
    // Sampling the full-size mask at half size, at a texel's corner, averages four pixels: a box before the blur.
    pass(targets.mask, targets.blurA, [2, 0]);
    pass(targets.blurA, targets.blurB, [0, 1]);
  }

  function drawProtect(regions: readonly StampRegion[], box: PaintGlBox) {
    clear(targets.protect, box);
    const program = programs.region;
    program.use();
    gl.bindVertexArray(regionVao);
    gl.uniform2fv(program.uniform('resolution'), resolution);
    for (const region of regions) {
      if (region.kind === 'ellipse') {
        bindPaintGlTarget(gl, targets.protect, box);
        gl.uniform1i(program.uniform('ellipse'), 1);
        gl.uniform4fv(program.uniform('shape'), [region.x, region.y, region.radiusX, region.radiusY]);
        const { x, y, radiusX: rx, radiusY: ry } = region;
        gl.bindBuffer(gl.ARRAY_BUFFER, regionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x - rx, y - ry, x + rx, y - ry, x + rx, y + ry, x - rx, y + ry]), gl.DYNAMIC_DRAW);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.MAX);
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
      } else {
        // Even-odd fill without a stencil: each fan triangle inverts what's under it, so a pixel inside an odd number of
        // them ends up set, whatever the polygon's shape. Then the region joins the others by max.
        clear(targets.region, box);
        bindPaintGlTarget(gl, targets.region, box);
        gl.uniform1i(program.uniform('ellipse'), 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, regionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(region.points.flatMap((p) => [p.x, p.y])), gl.DYNAMIC_DRAW);
        gl.enable(gl.BLEND);
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ZERO);
        const fan = new Float32Array((region.points.length - 2) * 6);
        for (let i = 1; i + 1 < region.points.length; i++) {
          const [a, b, c] = [region.points[0], region.points[i], region.points[i + 1]];
          fan.set([a.x, a.y, b.x, b.y, c.x, c.y], (i - 1) * 6);
        }
        gl.bufferData(gl.ARRAY_BUFFER, fan, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, fan.length / 2);
        gl.blendEquation(gl.MAX);
        gl.blendFunc(gl.ONE, gl.ONE);
        copyInto(targets.region, targets.protect, box);
        program.use();
        gl.bindVertexArray(regionVao);
        gl.uniform2fv(program.uniform('resolution'), resolution);
      }
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  const copyProgram = createPaintGlProgram(gl, FULL_FRAME_VERTEX, `#version 300 es
precision highp float;
uniform sampler2D source;
out vec4 result;
void main() { result = texelFetch(source, ivec2(gl_FragCoord.xy), 0); }`);
  /** Draws `source` into `target` through whatever blend is set. */
  function copyInto(source: PaintGlTarget, target: PaintGlTarget, box: PaintGlBox) {
    bindPaintGlTarget(gl, target, box);
    copyProgram.use();
    gl.bindVertexArray(emptyVao);
    bindPaintGlTexture(gl, copyProgram, 'source', 0, source.texture);
    drawFullFrame(gl);
  }

  function resolveCoverage(deposit: CompiledStampDeposit, clipped: boolean, protectOn: boolean, blurred: boolean, box: PaintGlBox) {
    const { brush } = deposit;
    const program = programs.resolve;
    bindPaintGlTarget(gl, targets.coverage, box);
    program.use();
    gl.bindVertexArray(emptyVao);
    gl.uniform2fv(program.uniform('resolution'), resolution);
    bindPaintGlTexture(gl, program, 'mask', 0, targets.mask.texture);
    bindPaintGlTexture(gl, program, 'blurred', 1, blurred ? targets.blurB.texture : targets.mask.texture);
    const edgesOf = (layer: StampBrushLayer) => blurred ? [layer.wetEdge?.strength ?? 0, layer.burntEdge?.strength ?? 0] : [0, 0];
    gl.uniform2fv(program.uniform('edges'), edgesOf(brush));
    const grainOf = (layer: StampBrushLayer, prefix: string, unit: number) => {
      const on = layer.grain?.mode === 'texturized' && layer.grain.depth > 0;
      gl.uniform1i(program.uniform(prefix === 'grain' ? 'texturized' : 'dualTexturized'), on ? 1 : 0);
      bindPaintGlTexture(gl, program, prefix, unit, on ? image(layer.grain!.image).texture : null);
      if (!on) return;
      const { width: w, height: h } = image(layer.grain!.image);
      const size = layer.grain!.scale * deposit.diameter;
      gl.uniform2fv(program.uniform(`${prefix}Tile`), [size, size * (h / w)]);
      gl.uniform1f(program.uniform(`${prefix}Depth`), layer.grain!.depth);
    };
    grainOf(brush, 'grain', 2);
    gl.uniform1i(program.uniform('dual'), brush.dual ? 1 : 0);
    if (brush.dual) {
      gl.uniform2fv(program.uniform('dualEdges'), edgesOf(brush.dual));
      gl.uniform1i(program.uniform('dualBlend'), DUAL_BLENDS.indexOf(brush.dual.blend));
      grainOf(brush.dual, 'dualGrain', 3);
    } else {
      bindPaintGlTexture(gl, program, 'dualGrain', 3, null);
    }
    const tooth = paper.grain && paper.grain.depth > 0 ? paper.grain : undefined;
    gl.uniform1i(program.uniform('paper'), tooth ? 1 : 0);
    bindPaintGlTexture(gl, program, 'paperGrain', 4, tooth ? image(tooth.image).texture : null);
    if (tooth) {
      const { width: w, height: h } = image(tooth.image);
      gl.uniform2fv(program.uniform('paperTile'), [tooth.scale * width, tooth.scale * width * (h / w)]);
      gl.uniform1f(program.uniform('paperDepth'), tooth.depth);
    }
    gl.uniform1i(program.uniform('protectOn'), protectOn ? 1 : 0);
    bindPaintGlTexture(gl, program, 'protect', 5, targets.protect.texture);
    gl.uniform1i(program.uniform('clipped'), clipped ? 1 : 0);
    bindPaintGlTexture(gl, program, 'clip', 6, targets.clip.texture);
    gl.uniform1f(program.uniform('opacity'), deposit.opacity);
    drawFullFrame(gl);
  }

  /** The pixels a deposit's first `count` stamps (and dual stamps) reach, padded for its edges' blur, or null. */
  function depositBox(deposit: CompiledStampDeposit, count: number, dualCount: number, pad: number): PaintGlBox | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const reach = (stamps: readonly PlacedStamp[], n: number) => {
      for (let i = 0; i < n; i++) {
        const s = stamps[i], r = s.diameter * 0.75;
        x0 = Math.min(x0, s.x - r); y0 = Math.min(y0, s.y - r); x1 = Math.max(x1, s.x + r); y1 = Math.max(y1, s.y + r);
      }
    };
    reach(deposit.stamps, count);
    reach(deposit.dualStamps, dualCount);
    const x = Math.max(0, Math.floor(x0 - pad)), y = Math.max(0, Math.floor(y0 - pad));
    const w = Math.min(width, Math.ceil(x1 + pad)) - x, h = Math.min(height, Math.ceil(y1 + pad)) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  }

  function drawPaper() {
    const program = programs.paper;
    bindPaintGlTarget(gl, targets.painting.read, whole);
    program.use();
    gl.bindVertexArray(emptyVao);
    gl.uniform3fv(program.uniform('color'), [1, 3, 5].map((i) => parseInt(paper.color.slice(i, i + 2), 16) / 255));
    gl.uniform2fv(program.uniform('resolution'), resolution);
    gl.uniform1i(program.uniform('hasImage'), paper.image ? 1 : 0);
    bindPaintGlTexture(gl, program, 'image', 0, paper.image ? image(paper.image).texture : null);
    if (paper.image) {
      // Cover: the photograph fills the painting, cropped along whichever side it has to spare.
      const { width: w, height: h } = image(paper.image);
      const fit = Math.max(width / w, height / h);
      gl.uniform2fv(program.uniform('cover'), [width / (w * fit), height / (h * fit)]);
    }
    gl.disable(gl.BLEND);
    drawFullFrame(gl);
  }

  function draw(t: number) {
    drawPaper();
    for (const group of painting.groups) {
      clear(targets.layer.read, whole);
      let painted: PaintGlBox | null = null;
      for (const pass of group.passes) {
        if (!pass.clipTo) clear(targets.clip, whole);
        for (const deposit of pass.deposits) {
          const count = visibleStampCountAt(deposit, t);
          if (!count) continue;
          const dualCount = visibleStampCountAt(deposit, t, 'dualStamps');
          const { brush } = deposit;
          const hasEdges = (layer?: StampBrushLayer) => !!layer && ((layer.wetEdge?.strength ?? 0) > 0 || (layer.burntEdge?.strength ?? 0) > 0);
          const blurred = hasEdges(brush) || hasEdges(brush.dual);
          // An edge's width is a share of the stamp's radius; the rim is where the mask stands above a blur that wide.
          const sigma = Math.max(1, Math.max(...[brush, brush.dual].flatMap((layer) => [layer?.wetEdge?.width ?? 0, layer?.burntEdge?.width ?? 0])) * deposit.diameter / 2);
          const box = depositBox(deposit, count, dualCount, blurred ? sigma * 3 : 2);
          if (!box) continue;
          clear(targets.mask, box);
          bindPaintGlTarget(gl, targets.mask, box);
          const entry = placed.get(deposit)!;
          drawStamps(brush, entry.main, count, entry.smallest, [1, 0, 0, 0]);
          if (brush.dual) {
            bindPaintGlTarget(gl, targets.mask, box);
            drawStamps(brush.dual, entry.dual, dualCount, entry.smallestDual, [0, 1, 0, 0]);
          }
          if (blurred) blurMask(sigma, box);
          const protectOn = deposit.protectedBy.length > 0;
          if (protectOn) drawProtect(deposit.protectedBy, box);
          resolveCoverage(deposit, !!pass.clipTo, protectOn, blurred, box);
          compositor.deposit(targets.layer, targets.coverage, deposit.material, deposit.blend, box);
          if (!pass.clipTo) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
            copyInto(targets.coverage, targets.clip, box);
            gl.disable(gl.BLEND);
          }
          painted = painted ? union(painted, box) : box;
        }
      }
      if (painted) compositor.group(targets.painting, targets.layer.read, group.composite, group.opacity, painted);
    }
    const program = programs.output;
    bindPaintGlTarget(gl, null, whole, { width, height });
    program.use();
    gl.bindVertexArray(emptyVao);
    bindPaintGlTexture(gl, program, 'painting', 0, targets.painting.read.texture);
    gl.uniform2fv(program.uniform('resolution'), resolution);
    drawFullFrame(gl);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
  }

  return {
    draw,
    finish: () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)),
    dispose() {
      for (const program of [...Object.values(programs), copyProgram]) gl.deleteProgram(program.program);
      compositor.dispose();
      for (const target of Object.values(targets)) {
        if ('read' in target) {
          deletePaintGlTarget(gl, target.read);
          deletePaintGlTarget(gl, target.write);
        } else {
          deletePaintGlTarget(gl, target);
        }
      }
      for (const { texture } of images.values()) gl.deleteTexture(texture);
      gl.deleteBuffer(stampBuffer);
      gl.deleteBuffer(fanBuffer);
      gl.deleteBuffer(regionBuffer);
      for (const vao of [stampVao, regionVao, emptyVao]) gl.deleteVertexArray(vao);
      // Scrubbing the Studio mounts a painting per scene, and Chrome drops contexts past about 16 live ones.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

const union = (a: PaintGlBox, b: PaintGlBox): PaintGlBox => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
