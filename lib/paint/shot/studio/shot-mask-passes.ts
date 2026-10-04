// shot-mask-passes.ts: a painted plane's presentation masks on the GPU (ENGINE 6.3). Before its sheets are laid, its
// masks multiply into one factor over the stage, 1 where all shows: each alphaOf mask's drawable's laid coverage. The
// lay takes each film's opacity, card's union and pieces picture times it, glow and all, never the ground.
//
// The lay also gathers what other planes' alphaOf masks read of this one: each step's cover, a channel per drawable
// read, four to a layer of one array, mixed by group fades as paint is. Its picture keeps those layers
// (shotPictureCoverage).

import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import type { PaintSimilarity } from '#lib/paint/animation/models/paint-similarity.ts';
import type { StampPixelBox } from '#lib/paint/painting/models/stamp-blur-region.ts';
import { STAMP_OPAQUE_COVER } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import { stampStageWgsl, type StampStage, type StampStageTexels } from '#lib/paint/painting/models/stamp-stage.ts';
import type { StampPaintCompositor } from '#lib/paint/painting/studio/stamp-paint-compositor.ts';
import { dispatchStampCompute, STAMP_WORKGROUP } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { STAMP_BILINEAR_OR_ZERO_WGSL, STAMP_CARD_UNION_WGSL, STAMP_NO_REST, type StampLayVariant } from '#lib/paint/painting/studio/stamp-paint-lay-pass.ts';
import { stampLaidCoverWgsl } from '#lib/paint/painting/studio/stamp-paint-plane-passes.ts';
import type { StampPlanePicture } from '#lib/paint/painting/studio/stamp-plane-picture-pass.ts';
import type { StampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';

/**
 * A drawable's coverage as an alphaOf mask reads it: channel `channel` (0 r .. 3 a) of a texture over its first
 * `extent` texels (none past them), times `weight`, `map` taking a stage texel's point (texel centres at .5) to the
 * texel point read there. A source plane's weight is its visibility, which its render leaves out.
 */
export type ShotMaskCoverage = {
  readonly view: GPUTextureView; readonly channel: number; readonly weight: number; readonly extent: { readonly w: number; readonly h: number }; readonly map: PaintSimilarity;
};

/** How many drawables' coverage one layer gathers: a channel each. */
const SHOT_READS_PER_LAYER = 4;

/** A vec4 of what `each` gives each channel. */
const shotChannels = (each: (channel: number) => number): [number, number, number, number] => [each(0), each(1), each(2), each(3)];

/** The layers gathering `reads` drawables' coverage take. */
export const shotCoverageLayers = (reads: number) => Math.ceil(reads / SHOT_READS_PER_LAYER);

/** Where read `read` of a plane lies among its coverage layers: its layer and channel. */
const shotCoverageSlot = (read: number) => ({ layer: Math.floor(read / SHOT_READS_PER_LAYER), channel: read % SHOT_READS_PER_LAYER });

/** Read `read`'s coverage kept in `picture`'s layers, as a mask reads it: its box's texel 0 at the box's first stage texel. */
export function shotPictureCoverage(picture: StampPlanePicture, read: number): ShotMaskCoverage {
  const { layer, channel } = shotCoverageSlot(read), { box } = picture;
  return {
    view: picture.texture.createView({ dimension: '2d', baseArrayLayer: picture.coverage!.layer + layer, arrayLayerCount: 1 }),
    channel, weight: 1, extent: { w: box.w, h: box.h }, map: { ma: 1, mb: 0, kx: -box.x, ky: -box.y },
  };
}

const SHOT_MASK_COVERAGE = gpuUniformLayout('ShotMaskCoverage', [['map', 'vec4f'], ['channel', 'vec4f'], ['extent', 'vec2u'], ['stage', 'vec2u'], ['invert', 'u32']]);
// A drawable's coverage (2, the channel `channel` picks and weighs) read where `map` takes each stage texel's point,
// inverted or not.
const COVERAGE_WGSL = /* wgsl */ `
${SHOT_MASK_COVERAGE.wgsl}
@group(0) @binding(0) var<uniform> u: ShotMaskCoverage;
@group(0) @binding(1) var mask: texture_storage_2d<r32float, read_write>;
@group(0) @binding(2) var source: texture_2d<f32>;
${STAMP_BILINEAR_OR_ZERO_WGSL}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn maskCoverage(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.stage)) { return; }
  let p = vec2f(id.xy) + 0.5;
  let s = vec2f(u.map.x * p.x - u.map.y * p.y + u.map.z, u.map.y * p.x + u.map.x * p.y + u.map.w);
  var shown = clamp(dot(stampBilinearOrZero(source, s, u.extent), u.channel), 0.0, 1.0);
  if (u.invert == 1u) { shown = 1.0 - shown; }
  textureStore(mask, id.xy, textureLoad(mask, id.xy) * shown);
}`;

/** What a step lays that a coverage gathers: a film through its rest map, a card's union, a rig's pieces, or a placed ground's reach. */
type ShotCoverKind = 'film' | 'card' | 'pieces' | 'ground';

const SHOT_COVER = gpuUniformLayout('ShotCover', [
  ['origin', 'vec2u'], ['extent', 'vec2u'], ['amount', 'f32'], ['edgeOrigin', 'vec2u'], ['edgeExtent', 'vec2u'], ['layer', 'u32'], ['member', 'vec4f'],
]);
// A step's cover over the coverage in layer `layer` of (1), for each drawable `member` marks: a + (1 − a) · cover, cut
// by the mask (2) as its paint was. Bound: a film's layer (3), rest map (4) and reveals' cut (5); a card's union (4)
// and rest map (5); pieces' render (3); a ground's rest map (4).
function coverWgsl(kind: ShotCoverKind, { masked, revealed }: Pick<StampLayVariant, 'masked' | 'revealed'>, stage: StampStage, compositor: StampPaintCompositor | null) {
  const declared = {
    film: () => stampLaidCoverWgsl(compositor!, 'moved group', STAMP_NO_REST, 'true', { revealed }),
    card: () => `@group(0) @binding(4) var edge: texture_2d<f32>;\n@group(0) @binding(5) var rest: texture_2d<f32>;\n${STAMP_BILINEAR_OR_ZERO_WGSL}\n${STAMP_CARD_UNION_WGSL}`,
    pieces: () => '@group(0) @binding(3) var pieces: texture_2d<f32>;',
    ground: () => '@group(0) @binding(4) var rest: texture_2d<f32>;',
  }[kind]();
  const cover = {
    film: 'clamp(coverAt(pixel), 0.0, 1.0) * u.amount * m',
    card: `min(1.0, cardUnionAt(pixel, u.edgeOrigin, u.edgeExtent, true).z * m * ${STAMP_OPAQUE_COVER.toFixed(1)})`,
    pieces: 'clamp(textureLoad(pieces, pixel, 0).a, 0.0, 1.0) * m',
    ground: `select(0.0, 1.0, textureLoad(rest, pixel, 0).x >= ${STAMP_NO_REST / 2}.0)`,
  }[kind];
  return /* wgsl */ `
${stampStageWgsl(stage)}
${SHOT_COVER.wgsl}
@group(0) @binding(0) var<uniform> u: ShotCover;
@group(0) @binding(1) var coverage: texture_storage_2d_array<rgba16float, read_write>;
${masked ? '@group(0) @binding(2) var mask: texture_2d<f32>;' : ''}
${declared}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn cover(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let m = ${masked ? 'textureLoad(mask, pixel, 0).r' : '1.0'};
  let c = min(1.0, ${cover});
  if (c <= 0.0) { return; }
  let a = textureLoad(coverage, pixel, u.layer);
  textureStore(coverage, pixel, u.layer, a + (1.0 - a) * c * u.member);
}`;
}

/** What a step's cover reads: its kind's textures, the stage texels it covers, and a film's opacity and reveals' cut (null: none). */
export type ShotCoverStep =
  | {
    readonly kind: 'film'; readonly compositor: StampPaintCompositor; readonly layer: GPUTextureView; readonly rest: GPUTextureView; readonly reveal: GPUTextureView | null;
    readonly opacity: number; readonly box: StampPixelBox;
  }
  | { readonly kind: 'card'; readonly edge: GPUTextureView; readonly edgeBox: StampStageTexels; readonly rest: GPUTextureView; readonly box: StampPixelBox }
  | { readonly kind: 'pieces'; readonly pieces: GPUTextureView; readonly box: StampPixelBox }
  | { readonly kind: 'ground'; readonly rest: GPUTextureView; readonly box: StampPixelBox };

/** Fills all of `view` (one layer) with `value`, a channel each. */
const fillShotTarget = (encoder: GPUCommandEncoder, view: GPUTextureView, value: [number, number, number, number]) =>
  encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', clearValue: value, storeOp: 'store' }] }).end();

/** Each coverage layer of `members` (one a drawable read, true where it takes what's laid), and its channels' marks; none for a layer none take. */
function shotCoverageMembers(members: readonly boolean[]): { readonly layer: number; readonly member: [number, number, number, number] }[] {
  return Array.from({ length: shotCoverageLayers(members.length) }, (_, layer) => ({
    layer, member: shotChannels((channel) => Number(members[layer * SHOT_READS_PER_LAYER + channel] ?? false)),
  })).filter(({ member }) => member.some(Boolean));
}

/** The textures `step`'s cover binds from 3, a gap where its kind binds nothing. */
function shotCoverTextures(step: ShotCoverStep): (GPUTextureView | null)[] {
  if (step.kind === 'film') return [step.layer, step.rest, step.reveal];
  if (step.kind === 'card') return [null, step.edge, step.rest];
  if (step.kind === 'pieces') return [step.pieces];
  return [null, step.rest];
}

/** A plane's masks and gathered coverage on `owner`'s device over `stage`, each pass's uniform from `arena`. */
export function createShotMaskPasses(owner: StampPaintGpuOwner, { stage, arena }: { readonly stage: StampStage; readonly arena: StampUniformArena }) {
  const { device } = owner, { width, height } = stage;
  const compute = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  return {
    /** A plane's mask, all shown: r32float over the stage, the lay's to multiply into. */
    begin(encoder: GPUCommandEncoder): GPUTexture {
      const mask = owner.target('shot mask', { size: [width, height], format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
      fillShotTarget(encoder, mask.createView(), [1, 1, 1, 1]);
      return mask;
    },
    /** Takes `mask` times `coverage` (none: nothing covered), or what it leaves when `invert`. */
    coverage(encoder: GPUCommandEncoder, mask: GPUTexture, coverage: ShotMaskCoverage | null, invert: boolean) {
      if (!coverage && invert) return;
      const source = coverage?.view ?? owner.target('shot mask nothing', { size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING }).createView();
      dispatchStampCompute(device, encoder, compute(COVERAGE_WGSL), [arena.slot((views) => {
        const put = gpuUniformWriter(SHOT_MASK_COVERAGE, views), map = coverage?.map;
        put('map', map ? [map.ma, map.mb, map.kx, map.ky] : [1, 0, 0, 0]);
        put('channel', shotChannels((channel) => (channel === coverage?.channel ? coverage.weight : 0)));
        put('extent', coverage ? [coverage.extent.w, coverage.extent.h] : [0, 0]);
        put('stage', [width, height]);
        put('invert', invert ? 1 : 0);
      }), mask.createView(), source], width, height);
    },
    /** Where `reads` drawables' coverage gathers as a plane is laid: stage-sized, four to a layer of an array. */
    coverageTarget(reads: number): GPUTexture {
      const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
      return owner.target('shot coverage', { size: [width, height, shotCoverageLayers(reads)], format: 'rgba16float', usage });
    },
    /** Starts each drawable's coverage in `coverage`: `whole[r]`, the back's ground showing wherever the frame does, or nothing. */
    startCoverage(encoder: GPUCommandEncoder, coverage: GPUTexture, whole: readonly boolean[]) {
      for (let layer = 0; layer < coverage.depthOrArrayLayers; layer++) {
        const view = coverage.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 });
        fillShotTarget(encoder, view, shotChannels((channel) => Number(whole[layer * SHOT_READS_PER_LAYER + channel] ?? false)));
      }
    },
    /** Lays `step`'s cover, cut by `mask` (null: none), over each drawable's in `coverage` that `takes` (one a read) marks. */
    cover(encoder: GPUCommandEncoder, coverage: GPUTexture, takes: readonly boolean[], step: ShotCoverStep, mask: GPUTexture | null) {
      const { box } = step, edgeBox = step.kind === 'card' ? step.edgeBox : null;
      const variant = { masked: mask !== null, revealed: step.kind === 'film' && step.reveal !== null };
      const pipeline = compute(coverWgsl(step.kind, variant, stage, step.kind === 'film' ? step.compositor : null));
      for (const { layer, member } of shotCoverageMembers(takes)) {
        dispatchStampCompute(device, encoder, pipeline, [
          arena.slot((views) => {
            const put = gpuUniformWriter(SHOT_COVER, views);
            put('origin', [box.x, box.y]);
            put('extent', [box.w, box.h]);
            put('amount', step.kind === 'film' ? step.opacity : 1);
            if (edgeBox) {
              put('edgeOrigin', [edgeBox.x, edgeBox.y]);
              put('edgeExtent', [edgeBox.w, edgeBox.h]);
            }
            put('layer', layer);
            put('member', member);
          }),
          coverage.createView({ dimension: '2d-array' }), mask?.createView() ?? null, ...shotCoverTextures(step),
        ], box.w, box.h);
      }
    },
  };
}
