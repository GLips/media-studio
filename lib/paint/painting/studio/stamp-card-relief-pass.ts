// stamp-card-relief-pass.ts: a card's relief, its shadow and rim, on the GPU (stamp-card-relief.ts says what and in
// what order). Each card's coverage as laid (after place, poses, warps and masks) is drawn into a stage-sized level;
// its shadow is that blurred, offset away from the light and multiplied into what's behind before the card is laid;
// its rim, once its films are laid, is a band inside the coverage's edge: a cut line, a lip facing the light.
//
// A level's second channel gathers cards laid over it while its rim waits, so a parent's rim stays under a child
// card. On a clear plane the shadow reaches the planes behind as its filter, at one offset whatever their depth.

import { GPU_GAUSSIAN_PASS, gpuGaussianPassWgsl } from '#lib/platform/gpu/models/gpu-gaussian.ts';
import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import {
  STAMP_CARD_CUT_LINE, STAMP_CARD_LIP, STAMP_CARD_RIM_REACH, STAMP_CARD_SHADOW_STRENGTH, STAMP_CARD_SHADOW_TINT, stampCardLipToward, stampCardShadow, type StampCardReliefStep,
} from '../models/stamp-card-relief.ts';
import type { PaintLight } from '../models/stamp-form.ts';
import { STAMP_OPAQUE_COVER } from '../models/stamp-paint-recipe-compile.ts';
import { stampStageTexelsGrown, stampStageWgsl, type StampStage } from '../models/stamp-stage.ts';
import { stampPaintTargetWgsl, type StampPaintCompositor } from './stamp-paint-compositor.ts';
import { dispatchStampCompute, STAMP_WORKGROUP } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { STAMP_BILINEAR_OR_ZERO_WGSL, STAMP_CARD_UNION_WGSL, stampHexRgb } from './stamp-paint-lay-pass.ts';
import type { StampUniformArena } from './stamp-uniform-arena.ts';

/**
 * What casts: a card's union `edge` (r32float over stage texels `edgeBox`) laid over `box` through `rest` when moved;
 * or a premultiplied `picture` (a rig's pieces, stage-sized) over `box`. Either cut by `mask` (r32float over the
 * stage) when given, as its paint is.
 */
export type StampCardCaster =
  | { readonly kind: 'card'; readonly edge: GPUTextureView; readonly edgeBox: StampPixelBox; readonly rest: GPUTextureView | null; readonly box: StampPixelBox; readonly mask: GPUTextureView | null }
  | { readonly kind: 'picture'; readonly picture: GPUTextureView; readonly box: StampPixelBox; readonly mask: GPUTextureView | null };

/** Where a card's relief lays: onto `painting`, a target `compositor` keeps, under `light`. */
export type StampCardReliefOnto = { readonly compositor: StampPaintCompositor; readonly painting: GPUTextureView; readonly light: PaintLight };

/** Uniform slots a card's cast may take beside its occluding: its coverage, two blurs and its shadow. */
const CAST_SLOTS = 4;

/** Uniform slots a card's relief may take over a composite of `cards` card steps among `sheets` sheets, rims included. */
export const stampCardReliefSlots = (cards: number, sheets: number) => cards * (CAST_SLOTS + sheets + 1);

const CARD_CAST = gpuUniformLayout('CardCast', [['origin', 'vec2u'], ['extent', 'vec2u'], ['edgeOrigin', 'vec2u'], ['edgeExtent', 'vec2u'], ['moved', 'u32']]);
// A caster's coverage over its box into a level: (cover, 0, 0, 0), its waiting-rim channel cleared.
const castWgsl = (stage: StampStage, kind: StampCardCaster['kind'], masked: boolean) => /* wgsl */ `
${stampStageWgsl(stage)}
${CARD_CAST.wgsl}
@group(0) @binding(0) var<uniform> u: CardCast;
@group(0) @binding(1) var level: texture_storage_2d<rgba16float, write>;
${kind === 'card' ? `@group(0) @binding(2) var edge: texture_2d<f32>;
@group(0) @binding(3) var rest: texture_2d<f32>;
${STAMP_BILINEAR_OR_ZERO_WGSL}
${STAMP_CARD_UNION_WGSL}` : '@group(0) @binding(2) var picture: texture_2d<f32>;'}
${masked ? '@group(0) @binding(4) var mask: texture_2d<f32>;' : ''}
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn cardCast(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let m = ${masked ? 'textureLoad(mask, pixel, 0).r' : '1.0'};
  let cover = ${kind === 'card'
    ? `min(1.0, cardUnionAt(pixel, u.edgeOrigin, u.edgeExtent, u.moved == 1u).z * m * ${STAMP_OPAQUE_COVER.toFixed(1)})`
    : 'clamp(textureLoad(picture, pixel, 0).a, 0.0, 1.0) * m'};
  textureStore(level, pixel, vec4f(cover, 0.0, 0.0, 0.0));
}`;

const CARD_OCCLUDE = gpuUniformLayout('CardOcclude', [['origin', 'vec2u'], ['extent', 'vec2u']]);
// A card laid over a level whose rim waits: its coverage joins the level's second channel by max.
const occludeWgsl = /* wgsl */ `
${CARD_OCCLUDE.wgsl}
@group(0) @binding(0) var<uniform> u: CardOcclude;
@group(0) @binding(1) var waiting: texture_storage_2d<rgba16float, read_write>;
@group(0) @binding(2) var laid: texture_2d<f32>;
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn cardOcclude(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let was = textureLoad(waiting, pixel);
  textureStore(waiting, pixel, vec4f(was.r, max(was.g, textureLoad(laid, pixel, 0).r), was.ba));
}`;

/**
 * `boxedTexel(source, t, lo, hi)`: `source`'s texel `t`, nothing outside `lo`..`hi` (exclusive), where a level or blur
 * holds stale texels past the box it was last written over; `boxedBilinear` reads it bilinearly at texel point `s`.
 */
const BOXED_WGSL = /* wgsl */ `
fn boxedTexel(source: texture_2d<f32>, t: vec2i, lo: vec2i, hi: vec2i) -> vec4f {
  if (any(t < lo) || any(t >= hi)) { return vec4f(0.0); }
  return textureLoad(source, vec2u(t), 0);
}
fn boxedBilinear(source: texture_2d<f32>, s: vec2f, lo: vec2i, hi: vec2i) -> vec4f {
  let q = s - 0.5;
  let b = vec2i(floor(q));
  let f = q - floor(q);
  let top = mix(boxedTexel(source, b, lo, hi), boxedTexel(source, b + vec2i(1, 0), lo, hi), f.x);
  let bottom = mix(boxedTexel(source, b + vec2i(0, 1), lo, hi), boxedTexel(source, b + vec2i(1, 1), lo, hi), f.x);
  return mix(top, bottom, f.y);
}`;

const CARD_SHADOW = gpuUniformLayout('CardShadow', [['origin', 'vec2u'], ['extent', 'vec2u'], ['blurOrigin', 'vec2u'], ['blurExtent', 'vec2u'], ['offset', 'vec2f'], ['tint', 'vec3f'], ['strength', 'f32']]);
// The blurred coverage read `offset` back toward the light, multiplied into what's behind toward the tint.
const shadowWgsl = (compositor: StampPaintCompositor, stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('painting', 2, compositor.targets.painting, 'read_write')}
${GPU_SRGB_WGSL}
${compositor.shade}
${BOXED_WGSL}
${CARD_SHADOW.wgsl}
@group(0) @binding(0) var<uniform> u: CardShadow;
@group(0) @binding(1) var blurred: texture_2d<f32>;
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn cardShadow(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let lo = vec2i(u.blurOrigin);
  let density = boxedBilinear(blurred, vec2f(pixel) + 0.5 - u.offset, lo, lo + vec2i(u.blurExtent)).r;
  let amount = clamp(density, 0.0, 1.0) * u.strength;
  if (amount <= 0.0) { return; }
  layShade(pixel, u.tint, amount);
}`;

const CARD_RIM = gpuUniformLayout('CardRim', [['origin', 'vec2u'], ['extent', 'vec2u'], ['boxOrigin', 'vec2u'], ['boxExtent', 'vec2u'], ['lipToward', 'vec2f'], ['tone', 'f32']]);
const arrayView = (texture: GPUTexture) => texture.createView({ dimension: '2d-array' });
const wgslColor = (hex: string) => `vec3f(${stampHexRgb(hex).map((c) => c.toFixed(4)).join(', ')})`;
// A card's rim from its level: each texel's distance inside the coverage's edge (to the nearest texel under half
// cover), its outward normal toward that texel. A folded face takes its tone first, paper and paint alike; then the
// cut line and the lip where the normal faces the light, all thinned by what was laid over the card since.
const rimWgsl = (compositor: StampPaintCompositor, stage: StampStage) => /* wgsl */ `
${stampStageWgsl(stage)}
${stampPaintTargetWgsl('painting', 2, compositor.targets.painting, 'read_write')}
${GPU_SRGB_WGSL}
${compositor.card}
${compositor.shade}
${BOXED_WGSL}
${CARD_RIM.wgsl}
@group(0) @binding(0) var<uniform> u: CardRim;
@group(0) @binding(1) var level: texture_2d<f32>;
const RIM_REACH = ${STAMP_CARD_RIM_REACH};
fn coverAt(t: vec2i) -> f32 { return boxedTexel(level, t, vec2i(u.boxOrigin), vec2i(u.boxOrigin + u.boxExtent)).r; }
fn band(d: f32, width: f32) -> f32 { return 1.0 - smoothstep(width - 0.5, width + 0.5, d); }
@compute @workgroup_size(${STAMP_WORKGROUP}, ${STAMP_WORKGROUP}) fn cardRim(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= u.extent)) { return; }
  let pixel = u.origin + id.xy;
  let p = vec2i(pixel);
  let held = boxedTexel(level, p, vec2i(u.boxOrigin), vec2i(u.boxOrigin + u.boxExtent));
  let shown = held.r * (1.0 - clamp(held.g, 0.0, 1.0));
  if (shown <= 0.0) { return; }
  if (u.tone < 1.0) { layShade(pixel, vec3f(u.tone), shown); }
  var inside = f32(RIM_REACH) + 1.0;
  var outward = vec2f(0.0);
  if (held.r <= 0.5) {
    inside = 0.0;
    outward = -vec2f(coverAt(p + vec2i(1, 0)) - coverAt(p - vec2i(1, 0)), coverAt(p + vec2i(0, 1)) - coverAt(p - vec2i(0, 1)));
  } else {
    for (var dy = -RIM_REACH; dy <= RIM_REACH; dy++) {
      for (var dx = -RIM_REACH; dx <= RIM_REACH; dx++) {
        let c = coverAt(p + vec2i(dx, dy));
        if (c >= 0.5) { continue; }
        let d = length(vec2f(f32(dx), f32(dy))) - 0.5 + c;
        if (d < inside) {
          inside = d;
          outward = vec2f(f32(dx), f32(dy));
        }
      }
    }
  }
  let line = ${STAMP_CARD_CUT_LINE.amount.toFixed(2)} * band(inside, ${STAMP_CARD_CUT_LINE.width.toFixed(2)}) * shown;
  if (line > 0.0) { layCard(pixel, ${wgslColor(STAMP_CARD_CUT_LINE.color)}, line); }
  let facing = select(0.0, max(0.0, dot(normalize(outward), u.lipToward)), dot(outward, outward) > 0.0);
  let lip = ${STAMP_CARD_LIP.amount.toFixed(2)} * facing * band(inside, ${STAMP_CARD_LIP.width.toFixed(2)}) * shown;
  if (lip > 0.0) { layCard(pixel, ${wgslColor(STAMP_CARD_LIP.color)}, lip); }
}`;

/** A card's relief, its shadow and rim, on `owner`'s device over `stage`, each pass's uniform from `arena`. */
export function createStampCardRelief(owner: StampPaintGpuOwner, { stage, arena }: { readonly stage: StampStage; readonly arena: StampUniformArena }) {
  const { device } = owner;
  const compute = (code: string) => device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }) } });
  const pipelines = new Map<string, GPUComputePipeline>();
  const pipelineOf = (key: string, code: () => string) => {
    let made = pipelines.get(key);
    if (!made) pipelines.set(key, (made = compute(code())));
    return made;
  };
  // Pipelines laying onto a painting are made for its compositor, each compositor told apart by a number of its own.
  const compositorIds = new WeakMap<StampPaintCompositor, number>();
  let compositorsSeen = 0;
  const compositorKey = (compositor: StampPaintCompositor) => {
    if (!compositorIds.has(compositor)) compositorIds.set(compositor, compositorsSeen++);
    return compositorIds.get(compositor)!;
  };
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
  const stageTarget = (name: string, encoder: GPUCommandEncoder) => owner.target(`relief ${name}`, { size: [stage.width, stage.height], format: 'rgba16float', usage }, encoder);
  /** The box each level's coverage was last drawn over, while its rim waits. */
  const boxes = new Map<number, StampPixelBox>();

  /** Blurs `level`'s coverage over `box` by `sigma`, `taps` each side: the result and the texels it covers. */
  function blur(encoder: GPUCommandEncoder, level: GPUTexture, box: StampPixelBox, sigma: number, taps: number) {
    const across = stampStageTexelsGrown(stage, box, taps), down = stampStageTexelsGrown(stage, across, taps);
    const wide = { ...across, y: box.y, h: box.h }, a = stageTarget('blur across', encoder), b = stageTarget('blur down', encoder);
    const pipeline = pipelineOf('blur', () => gpuGaussianPassWgsl({ layers: 1, read: 'texels', workgroup: STAMP_WORKGROUP }));
    const pass = (source: GPUTexture, into: GPUTexture, axis: 0 | 1, read: StampPixelBox, written: StampPixelBox) => dispatchStampCompute(device, encoder, pipeline, [
      arena.slot((views) => {
        const put = gpuUniformWriter(GPU_GAUSSIAN_PASS, views);
        put('sigma', sigma);
        put('reach', taps);
        put('axis', axis);
        put('read', [read.x, read.y, read.w, read.h]);
        put('box', [written.x, written.y, written.w, written.h]);
      }),
      arrayView(source), arrayView(into),
    ], written.w, written.h);
    pass(level, a, 0, box, wide);
    pass(a, b, 1, wide, { ...wide, y: down.y, h: down.h });
    return { blurred: b, box: { ...wide, y: down.y, h: down.h } };
  }

  return {
    /** Starts a lay: no rim waits. */
    begin() {
      boxes.clear();
    },
    /**
     * The relief's `step` (a cast) for `caster`, onto `onto`, before the card itself is laid: its coverage drawn, its
     * shadow cast when its look says, and marked over the levels whose rims wait under it. Returns the stage texels
     * its shadow darkened; null for none.
     */
    cast(encoder: GPUCommandEncoder, step: Extract<StampCardReliefStep, { kind: 'cast' }>, caster: StampCardCaster, onto: StampCardReliefOnto): StampPixelBox | null {
      const { box } = caster, level = stageTarget(`level ${step.level}`, encoder), masked = caster.mask !== null;
      dispatchStampCompute(device, encoder, pipelineOf(`cast ${caster.kind} ${masked}`, () => castWgsl(stage, caster.kind, masked)), [
        arena.slot((views) => {
          const put = gpuUniformWriter(CARD_CAST, views);
          put('origin', [box.x, box.y]);
          put('extent', [box.w, box.h]);
          if (caster.kind === 'card') {
            put('edgeOrigin', [caster.edgeBox.x, caster.edgeBox.y]);
            put('edgeExtent', [caster.edgeBox.w, caster.edgeBox.h]);
            put('moved', caster.rest ? 1 : 0);
          }
        }),
        level.createView(),
        ...(caster.kind === 'card' ? [caster.edge, caster.rest ?? owner.blank('r8unorm').createView()] : [caster.picture, null]),
        caster.mask,
      ], box.w, box.h);
      for (const waiting of step.occludes) {
        dispatchStampCompute(device, encoder, pipelineOf('occlude', () => occludeWgsl), [
          arena.slot((views) => {
            const put = gpuUniformWriter(CARD_OCCLUDE, views);
            put('origin', [box.x, box.y]);
            put('extent', [box.w, box.h]);
          }),
          stageTarget(`level ${waiting}`, encoder).createView(), level.createView(),
        ], box.w, box.h);
      }
      if (step.rim !== 'none') boxes.set(step.level, box);
      const shadow = step.look.shadow ? stampCardShadow(onto.light, step.look.lift) : null;
      if (!shadow) return null;
      const blurred = blur(encoder, level, box, shadow.sigma, shadow.taps);
      const { x: ox, y: oy } = shadow.offset;
      const x0 = Math.max(0, Math.floor(blurred.box.x + ox)), y0 = Math.max(0, Math.floor(blurred.box.y + oy));
      const x1 = Math.min(stage.width, Math.ceil(blurred.box.x + blurred.box.w + ox)), y1 = Math.min(stage.height, Math.ceil(blurred.box.y + blurred.box.h + oy));
      if (x1 <= x0 || y1 <= y0) return null;
      const laid = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { compositor } = onto;
      dispatchStampCompute(device, encoder, pipelineOf(`shadow ${compositorKey(compositor)}`, () => shadowWgsl(compositor, stage)), [
        arena.slot((views) => {
          const put = gpuUniformWriter(CARD_SHADOW, views);
          put('origin', [laid.x, laid.y]);
          put('extent', [laid.w, laid.h]);
          put('blurOrigin', [blurred.box.x, blurred.box.y]);
          put('blurExtent', [blurred.box.w, blurred.box.h]);
          put('offset', [ox, oy]);
          put('tint', stampHexRgb(STAMP_CARD_SHADOW_TINT));
          put('strength', STAMP_CARD_SHADOW_STRENGTH);
        }),
        blurred.blurred.createView(), onto.painting,
      ], laid.w, laid.h);
      return laid;
    },
    /**
     * The rim of the card whose coverage `level` holds, onto `onto`, once its films are laid; `tone` (0..1.05) its
     * face's shade under the light as folded (paintCardShade), 1 for one square to the paper.
     */
    rim(encoder: GPUCommandEncoder, level: number, onto: StampCardReliefOnto, tone = 1) {
      const box = boxes.get(level);
      if (!box) return;
      boxes.delete(level);
      // A texel round the box, for the edge's antialiasing just past what was drawn.
      const laid = stampStageTexelsGrown(stage, box, 1), { compositor } = onto, toward = stampCardLipToward(onto.light);
      dispatchStampCompute(device, encoder, pipelineOf(`rim ${compositorKey(compositor)}`, () => rimWgsl(compositor, stage)), [
        arena.slot((views) => {
          const put = gpuUniformWriter(CARD_RIM, views);
          put('origin', [laid.x, laid.y]);
          put('extent', [laid.w, laid.h]);
          put('boxOrigin', [box.x, box.y]);
          put('boxExtent', [box.w, box.h]);
          put('lipToward', [toward.x, toward.y]);
          put('tone', tone);
        }),
        stageTarget(`level ${level}`, encoder).createView(), onto.painting,
      ], laid.w, laid.h);
    },
  };
}

export type StampCardRelief = ReturnType<typeof createStampCardRelief>;
