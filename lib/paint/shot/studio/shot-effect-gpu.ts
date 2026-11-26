// shot-effect-gpu.ts: an effect's studio half, and the pass that draws every effect. A half is WGSL for
// `fn shotEffect(p: vec2f) -> ShotFilm`, the film at plane px `p`, its parameters packed as floats. The pass draws
// it into a picture cached under its key while the frame's encoder reads it, as its inputs are.
//
// Its helpers: `shotRead(i, p)`, read i's film at `p` through its map, filtered, clear past it;
// `shotOver`, `shotFaded`, `shotFilmClear`, `shotParam(i)`, SHOT_READS; `shotDrawing()`, `shotSeconds()`
// (ShotEffectVaries; 0 unless followed). A film is the light it adds, what it takes
// of what's behind per channel (1 − transmittance), and light it emits.
//
// Negative space: an output carries no group motion (its plane's lens blur still runs) nor coverage for a mask.

import { paintSimilarityAfter, paintSimilarityInverse, type PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { StampPixelBox } from '#lib/paint/painting/models/stamp-blur-region.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { dispatchStampCompute, STAMP_WORKGROUP, stampArrayView } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { stampPlanePictureLayerCount, stampPlanePictureLayers, type StampPlanePictureLayers } from '#lib/paint/painting/studio/stamp-paint-plane-passes.ts';
import type { StampPlanePicture } from '#lib/paint/painting/studio/stamp-plane-picture-pass.ts';
import type { StampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import type { CompiledPaintedShot } from '../models/shot-compile.ts';
import type { StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { SHOT_EFFECT_READS_MOST, type CompiledShotImage, type ShotEffectDefinition, type ShotEffectParams, type ShotEffectTime } from '../models/shot-effect.ts';

/** The most floats an effect packs its parameters into: one uniform slot's. */
export const SHOT_EFFECT_PARAMS_MOST = 64;

/**
 * An effect's studio half: its definition, the WGSL defining `fn shotEffect(p: vec2f) -> ShotFilm` (it may define
 * helpers of its own beside it), and its parameters packed as at most SHOT_EFFECT_PARAMS_MOST floats. Its WGSL
 * calls `shotRead(i, p)`, `shotOver(top, under)`, `shotFaded(film, k)`, `shotFilmClear()`, `shotParam(i)`, and
 * `shotDrawing()` / `shotSeconds()` (0 unless its definition's `varies` follows them); SHOT_READS counts its reads.
 */
export type ShotEffectGpu<P extends ShotEffectParams = ShotEffectParams> = {
  readonly definition: ShotEffectDefinition<P>;
  readonly wgsl: string;
  // A method, so a half of any parameters stands as one of ShotEffectParams in a table.
  uniforms(params: P): readonly number[];
};

/**
 * Define `fn shotEffect(p:vec2f)->ShotFilm`. Sample mapped inputs with `shotRead(i,p+offset)` (bilinear) or
 * `shotReadNearest(i,p+offset)` (one texel). Both read clear outside. `shotNoise(shotBlock(p,size),seed)` hashes
 * integer cells into [0,1). `shotPosterize(rgb,levels)` quantizes linear RGB. `shotLuma(rgb)` measures luminance.
 * `shotFrameSize()` gives visible pixels. Optional `uniforms(params)` supplies `shotParam(i)`.
 */
export function defineShotEffectGpu<P extends ShotEffectParams>(
  effect: { readonly definition: ShotEffectDefinition<P> }, gpu: { readonly wgsl: string; readonly uniforms?: (params: P) => readonly number[] },
): ShotEffectGpu<P> {
  return { definition: effect.definition, wgsl: gpu.wgsl, uniforms: gpu.uniforms ?? (() => []) };
}

/**
 * What keeps `shot` from drawing its effects with `table`: an effect with no studio half in it, or one packing more
 * floats than SHOT_EFFECT_PARAMS_MOST. `studio paint check` says these without the GPU, as the renderer refuses them.
 */
export function shotEffectTableProblems(shot: CompiledPaintedShot, table: ShotEffectTable): PaintingProblem[] {
  const problems: PaintingProblem[] = [];
  const visit = (plane: string, image: CompiledShotImage) => {
    if (image.kind !== 'effect') return;
    const gpu = table.get(image.definition);
    if (!gpu) problems.push(paintingProblem('error', plane, 'source', `draws the effect ${image.definition.name}, which has no studio half here: pass the half defineShotEffectGpu made of it in PaintedShot's effects`));
    else if (gpu.uniforms(image.params).length > SHOT_EFFECT_PARAMS_MOST) {
      problems.push(paintingProblem('error', plane, 'source', `${image.definition.name} packs ${gpu.uniforms(image.params).length} floats, past the ${SHOT_EFFECT_PARAMS_MOST} an effect may`));
    }
    for (const { input } of image.reads) visit(plane, input);
  };
  for (const plane of shot.planes) if (plane.kind === 'effect') visit(plane.id, plane.image);
  return problems;
}

/** The effects a shot can draw: each definition's studio half. Static: a project lists its own beside the built-ins. */
export type ShotEffectTable = ReadonlyMap<ShotEffectDefinition, ShotEffectGpu>;

/** A table of `halves`, each definition once, its name unique: two halves of one name would key each other's output. */
export function shotEffectTable(halves: readonly ShotEffectGpu[]): ShotEffectTable {
  const table = new Map<ShotEffectDefinition, ShotEffectGpu>(), names = new Map<string, ShotEffectDefinition>();
  for (const half of halves) {
    const named = names.get(half.definition.name);
    if (named && named !== half.definition) throw new Error(`shot effects: two effects are named ${half.definition.name}; an effect's name keys its output, so each takes its own`);
    names.set(half.definition.name, half.definition);
    table.set(half.definition, half);
  }
  return table;
}

const SHOT_EFFECT_PASS = gpuUniformLayout('ShotEffectPass', [['origin', 'vec2u'], ['extent', 'vec2u'], ['visibility', 'f32'], ['drawing', 'i32'], ['seconds', 'f32'], ['frame', 'vec2u'], ['sizes', { vec4fArray: SHOT_EFFECT_READS_MOST / 2 }]]);
const MAPS_PER_SLOT = SHOT_EFFECT_READS_MOST / 2;
const SHOT_EFFECT_MAPS = gpuUniformLayout('ShotEffectMaps', [['values', { vec4fArray: MAPS_PER_SLOT }]]);
const SHOT_EFFECT_PARAMS = gpuUniformLayout('ShotEffectParams', [['values', { vec4fArray: SHOT_EFFECT_PARAMS_MOST / 4 }]]);

type ReadBinding = { binding: number; layer: number; paper: boolean; emission: number | null; packed: boolean };

type ReadPicture<T> = Pick<StampPlanePicture, 'kind' | 'taken' | 'emission' | 'box'> & { readonly texture: T };

/** Binding and array-layer addresses for logical reads. Repeated textures cost one binding, clear reads none. */
export function shotEffectPacking<T>(reads: readonly (ReadPicture<T> | null)[]) {
  const pictures = [...new Map(reads.flatMap((picture) => picture ? [[picture.texture, picture] as const] : [])).values()];
  const direct = pictures.length <= 16 ? pictures : pictures.slice(0, 15);
  const bindings = new Map<T, ReadBinding>();
  direct.forEach((p, binding) => bindings.set(p.texture, { binding, layer: 0, paper: p.kind === 'paper', emission: p.emission, packed: false }));
  let layers = 0;
  const overflow = pictures.slice(direct.length).map((picture) => {
    const layer = layers, count = 1 + Number(picture.taken !== null) + Number(picture.emission !== null);
    bindings.set(picture.texture, { binding: direct.length, layer, paper: picture.kind === 'paper', emission: picture.emission, packed: true });
    layers += count;
    return { picture, layer, count };
  });
  return { direct, overflow, layers, bindings: reads.map((picture) => picture ? bindings.get(picture.texture)! : null) };
}

function shotEffectBindings(owner: StampPaintGpuOwner, encoder: GPUCommandEncoder, reads: readonly ShotEffectPassRead[]) {
  const { direct, overflow, layers, bindings } = shotEffectPacking(reads.map(({ picture }) => picture));
  const textures = direct.map(({ texture }) => texture);
  if (overflow.length) {
    const width = Math.max(...overflow.map(({ picture }) => picture.box.w)), height = Math.max(...overflow.map(({ picture }) => picture.box.h));
    const packed = owner.target('shot effect overflow', { size: [width, height, layers], format: 'rgba16float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING }, encoder);
    for (const { picture, layer, count } of overflow) {
      encoder.copyTextureToTexture({ texture: picture.texture }, { texture: packed, origin: [0, 0, layer] }, [picture.box.w, picture.box.h, count]);
    }
    textures.push(packed);
  }
  return { textures, bindings };
}

/** Specialize texture bindings while preserving logical read order and each crop's clear border. */
function shotEffectReadingWgsl(bindings: readonly (ReadBinding | null)[]) {
  const texel = bindings.map((read, i) => {
    if (!read) return `fn shotReadTexel${i}(t: vec2i) -> ShotFilm { return shotFilmClear(); }`;
    const { binding, layer, emission, paper, packed } = read;
    const rgb = (offset: number) => `textureLoad(read${binding}, t, ${layer + offset}, 0).rgb`;
    const size = packed ? `shotPass.sizes[${Math.floor(i / 2)}].${i % 2 ? 'zw' : 'xy'}` : `textureDimensions(read${binding})`;
    return /* wgsl */ `
fn shotReadTexel${i}(t: vec2i) -> ShotFilm {
  if (any(t < vec2i(0)) || any(t >= vec2i(${size}))) { return shotFilmClear(); }
  return ShotFilm(${rgb(0)}, ${paper ? 'vec3f(1.0)' : rgb(1)}, ${emission === null ? 'vec3f(0.0)' : rgb(emission)});
}`;
  }).join('\n');
  return /* wgsl */ `
struct ShotFilm { light: vec3f, taken: vec3f, emission: vec3f }
const SHOT_READS = ${bindings.length}u;
fn shotFilmClear() -> ShotFilm { return ShotFilm(vec3f(0.0), vec3f(0.0), vec3f(0.0)); }
fn shotFaded(film: ShotFilm, k: f32) -> ShotFilm { return ShotFilm(film.light * k, film.taken * k, film.emission * k); }
fn shotSum(a: ShotFilm, b: ShotFilm) -> ShotFilm { return ShotFilm(a.light + b.light, a.taken + b.taken, a.emission + b.emission); }
// What lies behind top shows through what top lets through, per channel.
fn shotOver(top: ShotFilm, under: ShotFilm) -> ShotFilm {
  let through = vec3f(1.0) - top.taken;
  return ShotFilm(top.light + through * under.light, vec3f(1.0) - through * (vec3f(1.0) - under.taken), top.emission + through * under.emission);
}
fn shotParam(i: u32) -> f32 { return shotParams.values[i / 4u][i % 4u]; }
fn shotFrameSize() -> vec2f { return vec2f(shotPass.frame); }
fn shotLuma(rgb: vec3f) -> f32 { return dot(rgb, vec3f(0.2126, 0.7152, 0.0722)); }
fn shotBlock(p: vec2f, size: vec2f) -> vec2i { return vec2i(floor(p / max(size, vec2f(1.0)))); }
fn shotNoise(cell: vec2i, seed: u32) -> f32 {
  var h = bitcast<u32>(cell.x) * 0x85ebca6bu + bitcast<u32>(cell.y) * 0xc2b2ae35u + seed;
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return f32((h ^ (h >> 16u)) >> 8u) / 16777216.0;
}
fn shotPosterize(rgb: vec3f, levels: f32) -> vec3f {
  let steps = max(1.0, round(levels) - 1.0);
  return round(clamp(rgb, vec3f(0.0), vec3f(1.0)) * steps) / steps;
}
fn shotDrawing() -> i32 { return shotPass.drawing; }
fn shotSeconds() -> f32 { return shotPass.seconds; }
${texel}
fn shotReadTexel(i: u32, t: vec2i) -> ShotFilm {
  switch i {
    ${bindings.map((_, i) => `case ${i}u: { return shotReadTexel${i}(t); }`).join('\n    ')}
    default: { return shotFilmClear(); }
  }
}
// Read i's film at plane px p: carried back through its map to its picture's texels, filtered between four.
fn shotReadPoint(i: u32, p: vec2f) -> vec2f {
  let m = select(shotMaps0.values[i % ${MAPS_PER_SLOT}u], shotMaps1.values[i % ${MAPS_PER_SLOT}u], i >= ${MAPS_PER_SLOT}u);
  return vec2f(m.x * p.x - m.y * p.y + m.z, m.y * p.x + m.x * p.y + m.w);
}
fn shotReadNearest(i: u32, p: vec2f) -> ShotFilm { return shotReadTexel(i, vec2i(floor(shotReadPoint(i, p)))); }
fn shotRead(i: u32, p: vec2f) -> ShotFilm {
  let q = shotReadPoint(i, p) - vec2f(0.5);
  let base = vec2i(floor(q));
  let f = q - floor(q);
  if (all(f == vec2f(0.0))) { return shotReadTexel(i, base); }
  let top = shotSum(shotFaded(shotReadTexel(i, base), 1.0 - f.x), shotFaded(shotReadTexel(i, base + vec2i(1, 0)), f.x));
  let bottom = shotSum(shotFaded(shotReadTexel(i, base + vec2i(0, 1)), 1.0 - f.x), shotFaded(shotReadTexel(i, base + vec2i(1, 1)), f.x));
  return shotSum(shotFaded(top, 1.0 - f.y), shotFaded(bottom, f.y));
}`;
}

/** The pass's WGSL: `gpu`'s shading over reads emitting at `emission`, written into an output shaped `layers`, at the stage's `margin`. */
function shotEffectWgsl(gpu: ShotEffectGpu, bindings: readonly (ReadBinding | null)[], textureCount: number, layers: StampPlanePictureLayers, margin: number) {
  return /* wgsl */ `
${SHOT_EFFECT_PASS.wgsl}
${SHOT_EFFECT_PARAMS.wgsl}
${SHOT_EFFECT_MAPS.wgsl}
@group(0) @binding(0) var<uniform> shotPass: ShotEffectPass;
@group(0) @binding(1) var<uniform> shotParams: ShotEffectParams;
@group(0) @binding(2) var shotOutput: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var<uniform> shotMaps0: ShotEffectMaps;
@group(0) @binding(4) var<uniform> shotMaps1: ShotEffectMaps;
${Array.from({ length: textureCount }, (_, i) => `@group(0) @binding(${5 + i}) var read${i}: texture_2d_array<f32>;`).join('\n')}
${shotEffectReadingWgsl(bindings)}
${gpu.wgsl}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn shotEffectPass(@builtin(global_invocation_id) id: vec3u) {
  // Every binding used, so the pipeline's layout holds each the pass binds, whatever the effect reads.
  _ = shotParams.values[0];
  _ = shotMaps0.values[0];
  _ = shotMaps1.values[0];
${Array.from({ length: textureCount }, (_, i) => `  _ = textureDimensions(read${i});`).join('\n')}
  if (any(id.xy >= shotPass.extent)) { return; }
  let texel = shotPass.origin + id.xy;
  let film = shotFaded(shotEffect(vec2f(texel) + vec2f(0.5 - ${margin.toFixed(1)})), shotPass.visibility);
  let through = clamp(vec3f(1.0) - film.taken, vec3f(0.0), vec3f(1.0));
  textureStore(shotOutput, id.xy, 0u, vec4f(film.light, 1.0 - dot(through, vec3f(0.2126, 0.7152, 0.0722))));
  textureStore(shotOutput, id.xy, ${layers.taken}u, vec4f(film.taken, 0.0));${layers.emission !== null ? `
  textureStore(shotOutput, id.xy, ${layers.emission}u, vec4f(film.emission, 0.0));` : ''}
}`;
}

/** One read an effect makes this frame: its input's picture (null: it lays nothing), and its map, input plane px to output plane px. */
export type ShotEffectPassRead = { readonly picture: StampPlanePicture | null; readonly map: PaintSimilarity };

/**
 * What one effect draws: its studio half, its parameters, what it reads of its moment, its reads, the stage texels
 * its output covers, the visibility it's laid at, and the key it's kept under.
 */
export type ShotEffectPassDraw = {
  readonly gpu: ShotEffectGpu; readonly params: ShotEffectParams; readonly time: ShotEffectTime; readonly reads: readonly ShotEffectPassRead[]; readonly box: StampPixelBox; readonly visibility: number; readonly key: string;
};

/**
 * The effect pass on `owner`'s device over `stage`, its outputs kept in the cache's `picture` store until `dispose`,
 * each found or drawn counted into `costs`.
 */
export function createShotEffectPass(
  owner: StampPaintGpuOwner, { stage, arena, costs }: { readonly stage: StampStage; readonly arena: StampUniformArena; readonly costs?: StampPaintCostTally | undefined },
) {
  const { device } = owner, { margin } = stage, outputs = owner.cache.store<StampPlanePictureLayers & { readonly box: StampPixelBox }>('picture');
  const pipelineOf = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  return {
    find(key: string, encoder: GPUCommandEncoder): StampPlanePicture | null {
      const found = outputs.find(key, encoder);
      if (found) costs?.count('effect hits');
      return found ? { ...found.note, texture: found.textures[0] } : null;
    },
    /**
     * `draw`'s output, kept under its key, or drawn into `encoder` and kept: a film, emitting when its definition or a read does. Every
     * read's picture is used by `encoder` (the cache's own rule), so none is given up before it's read.
     */
    draw(encoder: GPUCommandEncoder, { gpu, params, time, reads, box, visibility, key }: ShotEffectPassDraw): StampPlanePicture {
      costs?.count('effect misses');
      const emits = !!gpu.definition.emits || reads.some(({ picture }) => !!picture && picture.emission !== null), layers = stampPlanePictureLayers('film', { emits, travels: false });
      const [texture] = outputs.make(key, encoder, [{
        width: box.w, height: box.h, layers: stampPlanePictureLayerCount(layers), format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      }], { ...layers, box }).textures;
      // shotEffectTableProblems held it to SHOT_EFFECT_PARAMS_MOST as the shot loaded.
      const packed = gpu.uniforms(params);
      const { textures, bindings } = shotEffectBindings(owner, encoder, reads);
      // Output plane px to the read's texels: its map undone, then into its picture's box on the stage.
      const back = reads.map(({ picture, map }) => (picture
        ? paintSimilarityAfter({ ma: 1, mb: 0, kx: margin - picture.box.x, ky: margin - picture.box.y }, paintSimilarityInverse(map))
        : { ma: 1, mb: 0, kx: -1e9, ky: -1e9 }));
      dispatchStampCompute(device, encoder, pipelineOf(shotEffectWgsl(gpu, bindings, textures.length, layers, margin)), [
        arena.slot((views) => {
          const put = gpuUniformWriter(SHOT_EFFECT_PASS, views);
          put('origin', [box.x, box.y]);
          put('extent', [box.w, box.h]);
          put('visibility', visibility);
          put('drawing', time.drawing);
          put('seconds', time.seconds);
          put('frame', [stage.frame.width, stage.frame.height]);
          put('sizes', Array.from({ length: SHOT_EFFECT_READS_MOST }, (_, i) => [reads[i]?.picture?.box.w ?? 0, reads[i]?.picture?.box.h ?? 0]).flat());
        }),
        arena.slot((views) => gpuUniformWriter(SHOT_EFFECT_PARAMS, views)('values', Array.from({ length: SHOT_EFFECT_PARAMS_MOST }, (_, i) => packed[i] ?? 0))),
        stampArrayView(texture),
        ...[0, 1].map((bank) => arena.slot((views) => gpuUniformWriter(SHOT_EFFECT_MAPS, views)('values', Array.from({ length: MAPS_PER_SLOT }, (_, i) => {
          const m = back[bank * MAPS_PER_SLOT + i];
          return m ? [m.ma, m.mb, m.kx, m.ky] : [0, 0, 0, 0];
        }).flat()))),
        ...textures.map(stampArrayView),
      ], box.w, box.h);
      return { ...layers, box, texture };
    },
    dispose: () => outputs.dispose(),
  };
}
