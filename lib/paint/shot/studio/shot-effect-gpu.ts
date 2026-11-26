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
import { SHOT_EFFECT_READS_MOST, type CompiledShotImage, type ShotEffect, type ShotEffectDefinition, type ShotEffectParams, type ShotEffectTime } from '../models/shot-effect.ts';

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

/** `effect`'s studio half: `wgsl` shading its reads, and `uniforms` packing its parameters. */
export function defineShotEffectGpu<P extends ShotEffectParams, I extends string, O extends I>(
  effect: ShotEffect<P, I, O>, gpu: { readonly wgsl: string; readonly uniforms: (params: P) => readonly number[] },
): ShotEffectGpu<P> {
  return { definition: effect.definition, wgsl: gpu.wgsl, uniforms: gpu.uniforms };
}

/**
 * What keeps `shot` from drawing its effects with `table`: an effect with no studio half in it, or one packing more
 * floats than SHOT_EFFECT_PARAMS_MOST. `studio paint check` says these without the GPU, as the renderer refuses them.
 */
export function shotEffectTableProblems(shot: CompiledPaintedShot, table: ShotEffectTable): PaintingProblem[] {
  const problems: PaintingProblem[] = [];
  const visit = (plane: string, image: CompiledShotImage) => {
    if (image.kind === 'painted') return;
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

const SHOT_EFFECT_PASS = gpuUniformLayout('ShotEffectPass', [['origin', 'vec2u'], ['extent', 'vec2u'], ['visibility', 'f32'], ['drawing', 'i32'], ['seconds', 'f32'], ['reads', { vec4fArray: SHOT_EFFECT_READS_MOST }]]);
const SHOT_EFFECT_PARAMS = gpuUniformLayout('ShotEffectParams', [['values', { vec4fArray: SHOT_EFFECT_PARAMS_MOST / 4 }]]);

/** The helpers an effect's WGSL reads its inputs and composites with, for reads whose pictures emit at `emission` (null: none). */
function shotEffectReadingWgsl(emission: readonly (number | null)[]) {
  const texel = emission.map((layer, i) => /* wgsl */ `
fn shotReadTexel${i}(t: vec2i) -> ShotFilm {
  let size = vec2i(textureDimensions(read${i}));
  if (any(t < vec2i(0)) || any(t >= size)) { return shotFilmClear(); }
  return ShotFilm(textureLoad(read${i}, t, 0u, 0).rgb, textureLoad(read${i}, t, 1u, 0).rgb, ${layer === null ? 'vec3f(0.0)' : `textureLoad(read${i}, t, ${layer}u, 0).rgb`});
}`).join('');
  return /* wgsl */ `
struct ShotFilm { light: vec3f, taken: vec3f, emission: vec3f }
const SHOT_READS = ${emission.length}u;
fn shotFilmClear() -> ShotFilm { return ShotFilm(vec3f(0.0), vec3f(0.0), vec3f(0.0)); }
fn shotFaded(film: ShotFilm, k: f32) -> ShotFilm { return ShotFilm(film.light * k, film.taken * k, film.emission * k); }
fn shotSum(a: ShotFilm, b: ShotFilm) -> ShotFilm { return ShotFilm(a.light + b.light, a.taken + b.taken, a.emission + b.emission); }
// What lies behind top shows through what top lets through, per channel.
fn shotOver(top: ShotFilm, under: ShotFilm) -> ShotFilm {
  let through = vec3f(1.0) - top.taken;
  return ShotFilm(top.light + through * under.light, vec3f(1.0) - through * (vec3f(1.0) - under.taken), top.emission + through * under.emission);
}
fn shotParam(i: u32) -> f32 { return shotParams.values[i / 4u][i % 4u]; }
fn shotDrawing() -> i32 { return shotPass.drawing; }
fn shotSeconds() -> f32 { return shotPass.seconds; }
${texel}
fn shotReadTexel(i: u32, t: vec2i) -> ShotFilm {
  switch i {
    ${emission.map((_, i) => `case ${i}u: { return shotReadTexel${i}(t); }`).join('\n    ')}
    default: { return shotFilmClear(); }
  }
}
// Read i's film at plane px p: carried back through its map to its picture's texels, filtered between four.
fn shotRead(i: u32, p: vec2f) -> ShotFilm {
  let m = shotPass.reads[i];
  let q = vec2f(m.x * p.x - m.y * p.y + m.z, m.y * p.x + m.x * p.y + m.w) - vec2f(0.5);
  let base = vec2i(floor(q));
  let f = q - floor(q);
  let top = shotSum(shotFaded(shotReadTexel(i, base), 1.0 - f.x), shotFaded(shotReadTexel(i, base + vec2i(1, 0)), f.x));
  let bottom = shotSum(shotFaded(shotReadTexel(i, base + vec2i(0, 1)), 1.0 - f.x), shotFaded(shotReadTexel(i, base + vec2i(1, 1)), f.x));
  return shotSum(shotFaded(top, 1.0 - f.y), shotFaded(bottom, f.y));
}`;
}

/** The pass's WGSL: `gpu`'s shading over reads emitting at `emission`, written into an output shaped `layers`, at the stage's `margin`. */
function shotEffectWgsl(gpu: ShotEffectGpu, emission: readonly (number | null)[], layers: StampPlanePictureLayers, margin: number) {
  return /* wgsl */ `
${SHOT_EFFECT_PASS.wgsl}
${SHOT_EFFECT_PARAMS.wgsl}
@group(0) @binding(0) var<uniform> shotPass: ShotEffectPass;
@group(0) @binding(1) var<uniform> shotParams: ShotEffectParams;
@group(0) @binding(2) var shotOutput: texture_storage_2d_array<rgba16float, write>;
${emission.map((_, i) => `@group(0) @binding(${3 + i}) var read${i}: texture_2d_array<f32>;`).join('\n')}
${shotEffectReadingWgsl(emission)}
${gpu.wgsl}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn shotEffectPass(@builtin(global_invocation_id) id: vec3u) {
  // Every binding used, so the pipeline's layout holds each the pass binds, whatever the effect reads.
  _ = shotParams.values[0];
${emission.map((_, i) => `  _ = textureDimensions(read${i});`).join('\n')}
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
    /**
     * `draw`'s output, kept under its key, or drawn into `encoder` and kept: a film, emitting when a read does. Every
     * read's picture is used by `encoder` (the cache's own rule), so none is given up before it's read.
     */
    draw(encoder: GPUCommandEncoder, { gpu, params, time, reads, box, visibility, key }: ShotEffectPassDraw): StampPlanePicture {
      const found = outputs.find(key, encoder);
      costs?.count(found ? 'effect hits' : 'effect misses');
      if (found) return { ...found.note, texture: found.textures[0] };
      const emits = reads.some(({ picture }) => !!picture && picture.emission !== null), layers = stampPlanePictureLayers('film', { emits, travels: false });
      const [texture] = outputs.make(key, encoder, [{
        width: box.w, height: box.h, layers: stampPlanePictureLayerCount(layers), format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      }], { ...layers, box }).textures;
      // shotEffectTableProblems held it to SHOT_EFFECT_PARAMS_MOST as the shot loaded.
      const packed = gpu.uniforms(params);
      // A read laying nothing reads from a picture of one clear texel, placed where no texel of the output maps.
      const empty = owner.target('shot effect nothing', { size: [1, 1, 2], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING }, encoder);
      const emission = reads.map(({ picture }) => picture?.emission ?? null);
      // Output plane px to the read's texels: its map undone, then into its picture's box on the stage.
      const back = reads.map(({ picture, map }) => (picture
        ? paintSimilarityAfter({ ma: 1, mb: 0, kx: margin - picture.box.x, ky: margin - picture.box.y }, paintSimilarityInverse(map))
        : { ma: 1, mb: 0, kx: -1e9, ky: -1e9 }));
      dispatchStampCompute(device, encoder, pipelineOf(shotEffectWgsl(gpu, emission, layers, margin)), [
        arena.slot((views) => {
          const put = gpuUniformWriter(SHOT_EFFECT_PASS, views);
          put('origin', [box.x, box.y]);
          put('extent', [box.w, box.h]);
          put('visibility', visibility);
          put('drawing', time.drawing);
          put('seconds', time.seconds);
          put('reads', Array.from({ length: SHOT_EFFECT_READS_MOST * 4 }, (_, word) => {
            const at = back[Math.floor(word / 4)];
            return at ? [at.ma, at.mb, at.kx, at.ky][word % 4] : 0;
          }));
        }),
        arena.slot((views) => gpuUniformWriter(SHOT_EFFECT_PARAMS, views)('values', Array.from({ length: SHOT_EFFECT_PARAMS_MOST }, (_, i) => packed[i] ?? 0))),
        stampArrayView(texture),
        ...reads.map(({ picture }) => stampArrayView(picture?.texture ?? empty)),
      ], box.w, box.h);
      return { ...layers, box, texture };
    },
    dispose: () => outputs.dispose(),
  };
}
