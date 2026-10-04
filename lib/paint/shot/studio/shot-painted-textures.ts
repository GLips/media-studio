// shot-painted-textures.ts: a shot's compiled painted textures drawn for its three sources, each a handle
// loadPaintedThreeSources reads, brought up to a frame's moment by `update`. Each selection a texture's source blends
// then is solved, laid on its paper at the document's size, resampled to the texture's size and summed by its weight
// in linear light, so a dissolve blends opaque colour; then gamma-encoded into the handle's first level, its mip chain
// below. A warm solves each texture at its frames, laying nothing.
//
// A texture isn't laid again when its solves keep the films it was last laid from and its reveals show what they last
// did. A moving reveal lays it, and its mip chain, every frame.

import { compilePaintingSelection, type PaintingSelectionCompiled } from '#lib/paint/document/models/painting-document-compile.ts';
import { paintingErrors, paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { solvePaintingSheets, type PaintingSheetsSolved } from '#lib/paint/document/studio/painting-sheets-solve.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampSheetRevealsKey } from '#lib/paint/painting/models/stamp-reveal.ts';
import { stampWrapsAcross, type StampAxis, type StampWrap } from '#lib/paint/painting/models/stamp-stage.ts';
import { stampBindGroup } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintSurface, type StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { drawStampSheetsStill } from '#lib/paint/painting/studio/stamp-sheet-composite.ts';
import { createStampUniformArena } from '#lib/paint/painting/studio/stamp-uniform-arena.ts';
import type { PaintedThreeTextureHandle, PaintedThreeTexturesSupplied } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { gpuMipLevelCount } from '#lib/platform/gpu/models/gpu-mip-levels.ts';
import { gpuUniformLayout, gpuUniformWriter } from '#lib/platform/gpu/models/gpu-uniform-layout.ts';
import { GPU_FULL_FRAME_WGSL, GPU_SRGB_WGSL } from '#lib/platform/gpu/models/gpu-wgsl.ts';
import type { PaintedShotPaintOptions } from '../models/shot-compile.ts';
import { compiledPaintedTextureSourceAt, type CompiledShotPaintedTexture } from '../models/shot-painted-texture-compile.ts';
import { paintedSourceShares, samePaintedSourceShares, type PaintedSourceShare } from '../models/shot-selection.ts';
import type { ShotSolve } from '../models/shot-progress.ts';
import { shotPaintedTextureMipChain, type ShotPaintedTextureMipChain } from './shot-painted-texture-mips.ts';
import type { ShotSolveProgress } from './shot-watch.ts';

/** One solve a warm makes: what it solves, and the solve, its films let go to the cache. */
export type ShotWarmSolve = { readonly solve: ShotSolve; readonly run: () => Promise<void> };

/**
 * A shot's painted textures as its three sources read them; `solveAt`, `update` with each texture's solve told to
 * `progress`, for a frame to make before its sources render; `warmSolves`, the solves a warm over `frames` makes; and
 * `dispose`, letting their textures go after the sources.
 */
export type ShotPaintedTextures = PaintedThreeTexturesSupplied & {
  readonly solveAt: (t: number, progress?: ShotSolveProgress) => Promise<void>;
  readonly warmSolves: (frames: readonly PaintMoment[]) => ShotWarmSolve[];
  readonly dispose: () => void;
};

/** One share of a texture's source solved: its compiled selection, its weight, and its sheets' solves, held until released. */
type ShotTextureShareSolved = { readonly compiled: PaintingSelectionCompiled; readonly weight: number; readonly sheets: PaintingSheetsSolved };

/** What a share's picture was laid from: its compiled selection, its weight, and the key of each of its sheets' films and their reveals. */
type ShotTextureShareLaid = { readonly compiled: PaintingSelectionCompiled; readonly weight: number; readonly films: string };

/**
 * A texture as it's drawn: its handle and its mip chain, the sum laid into it, the shares its source last read (null:
 * none yet), and what the sum was laid from (null: nothing yet).
 */
type ShotPaintedTextureSlot = {
  readonly texture: CompiledShotPaintedTexture;
  readonly handle: PaintedThreeTextureHandle;
  readonly mips: ShotPaintedTextureMipChain;
  readonly light: GPUTexture;
  read: readonly PaintedSourceShare[] | null;
  laid: readonly ShotTextureShareLaid[] | null;
};

const shotTextureShareLaid = ({ compiled, weight, sheets }: ShotTextureShareSolved): ShotTextureShareLaid => ({
  compiled, weight,
  films: sheets.solved.map(({ key, finished }, s) => `${key} ${finished ? 'finished' : 'open'} ${stampSheetRevealsKey(sheets.composite.sheets[s].reveals)}`).join('|'),
});

const sameShotTextureLaid = (a: readonly ShotTextureShareLaid[], b: readonly ShotTextureShareLaid[]) =>
  a.length === b.length && a.every(({ compiled, weight, films }, i) => compiled === b[i].compiled && weight === b[i].weight && films === b[i].films);

/** Taps a side a texture's texel averages its painting through, at most: past 8× smaller, a texel samples sparsely. */
const SHOT_TEXTURE_MOST_TAPS = 8;

const SHOT_TEXTURE_RESAMPLE = gpuUniformLayout('TextureResample', [['size', 'vec2f'], ['taps', 'vec2u'], ['weight', 'f32']]);

// A texel's share of a painting's light: its footprint's taps, each a bilinear read of the encoded painting decoded
// to linear light, averaged and weighed, summed into what's there by the target's blend.
const SHOT_TEXTURE_RESAMPLE_WGSL = /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${GPU_SRGB_WGSL}
${SHOT_TEXTURE_RESAMPLE.wgsl}
@group(0) @binding(0) var<uniform> u: TextureResample;
@group(0) @binding(1) var painted: texture_2d<f32>;
@group(0) @binding(2) var along: sampler;
@fragment fn resample(@builtin(position) at: vec4f) -> @location(0) vec4f {
  var sum = vec3f(0.0);
  for (var j = 0u; j < u.taps.y; j++) {
    for (var i = 0u; i < u.taps.x; i++) {
      let uv = (floor(at.xy) + (vec2f(f32(i), f32(j)) + 0.5) / vec2f(u.taps)) / u.size;
      sum += srgbDecoded(textureSampleLevel(painted, along, uv, 0.0).rgb);
    }
  }
  return vec4f(u.weight * sum / f32(u.taps.x * u.taps.y), u.weight);
}`;

const SHOT_TEXTURE_ENCODE_WGSL = /* wgsl */ `
${GPU_FULL_FRAME_WGSL}
${GPU_SRGB_WGSL}
@group(0) @binding(0) var light: texture_2d<f32>;
@fragment fn encode(@builtin(position) at: vec4f) -> @location(0) vec4f {
  return vec4f(srgbEncoded(textureLoad(light, vec2i(at.xy), 0).rgb), 1.0);
}`;

const SHOT_TEXTURE_SUM: GPUBlendState = { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' } };

/** The shares `texture`'s source blends at `moment`, refusing a source with an error there. */
function shotTextureSharesAt(texture: CompiledShotPaintedTexture, moment: PaintMoment): PaintedSourceShare[] {
  const { source, problems } = compiledPaintedTextureSourceAt(texture, moment), errors = paintingErrors(problems);
  if (errors.length) throw new Error(`shot: painted texture ${texture.id} at ${moment.at} s: ${errors.map(paintingProblemText).join('; ')}`);
  return paintedSourceShares(source);
}

/**
 * Compiled `textures` drawn on `owner`'s device for a shot's three sources. Refuses, as `update` reads a callback, a
 * source with an error at that moment (compiledPaintedTextureSourceAt).
 */
export function createShotPaintedTextures(owner: StampPaintGpuOwner, textures: readonly CompiledShotPaintedTexture[], { brushOf, costs }: PaintedShotPaintOptions): ShotPaintedTextures {
  const { webgpu, device } = owner, usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
  const resampleModule = device.createShaderModule({ code: SHOT_TEXTURE_RESAMPLE_WGSL }), encodeModule = device.createShaderModule({ code: SHOT_TEXTURE_ENCODE_WGSL });
  const resample = device.createRenderPipeline({ layout: 'auto', vertex: { module: resampleModule }, fragment: { module: resampleModule, targets: [{ format: 'rgba32float', blend: SHOT_TEXTURE_SUM }] } });
  const encode = device.createRenderPipeline({ layout: 'auto', vertex: { module: encodeModule }, fragment: { module: encodeModule, targets: [{ format: 'rgba16float' }] } });
  // A wrapped painting is read repeating across each axis it wraps, so a texel by a seam averages paint from both its
  // edges; one sampler a wrap, made once.
  const samplers = new Map<StampWrap | null, GPUSampler>();
  const along = (wrap: StampWrap | null) => {
    let sampler = samplers.get(wrap);
    if (!sampler) {
      const mode = (axis: StampAxis): GPUAddressMode => (stampWrapsAcross(wrap, axis) ? 'repeat' : 'clamp-to-edge');
      samplers.set(wrap, (sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: mode('x'), addressModeV: mode('y') })));
    }
    return sampler;
  };
  // Let go of on dispose: the handles, each texture's sum, and a picture a painting's size.
  const owned: GPUTexture[] = [], pictures = new Map<string, Promise<{ view: GPUTextureView; surface: StampPaintSurface }>>();
  const own = (width: number, height: number, format: GPUTextureFormat, mipLevelCount = 1) => {
    const texture = webgpu.createTexture({ size: [width, height], format, usage, mipLevelCount });
    owned.push(texture);
    return texture;
  };
  // Shared by every texture's draws: they run in turn, and each picture is resampled before the next is laid.
  const pictureOf = (width: number, height: number) => {
    const key = `${width}x${height}`;
    let made = pictures.get(key);
    if (!made) {
      const texture = own(width, height, 'rgba16float');
      pictures.set(key, (made = createStampPaintSurface(owner, { frame: texture }).then((surface) => ({ view: texture.createView(), surface }))));
    }
    return made;
  };
  const arena = createStampUniformArena(device, 1);
  const drawn = textures.map((texture): ShotPaintedTextureSlot => {
    const { id, widthPx, heightPx, wrap } = texture, handle = { id, texture: own(widthPx, heightPx, 'rgba16float', gpuMipLevelCount(widthPx, heightPx)), wrap };
    return { texture, handle, mips: shotPaintedTextureMipChain(device, handle.texture, wrap), light: own(widthPx, heightPx, 'rgba32float'), read: null, laid: null };
  });

  /** `run` over `shares` each solved, their films held until it settles. */
  const withSharesSolved = async <R,>(shares: readonly PaintedSourceShare[], run: (solved: readonly ShotTextureShareSolved[]) => Promise<R>): Promise<R> => {
    const solved: ShotTextureShareSolved[] = [];
    try {
      await gpuEachInTurn(shares, async ({ selection, weight }) => {
        const compiled = compilePaintingSelection(selection.painting, brushOf, { layers: selection.layers });
        const sheets = await solvePaintingSheets(owner, compiled, { ...(costs && { costs }), ...(selection.at !== undefined && { at: selection.at }) });
        solved.push({ compiled, weight, sheets });
      });
      return await run(solved);
    } finally {
      for (const { sheets } of solved) sheets.release();
    }
  };

  /** One share laid on its paper and summed by its weight into `light`, cleared first when `first`. */
  const sumShare = async ({ texture, light }: ShotPaintedTextureSlot, { compiled, weight, sheets }: ShotTextureShareSolved, first: boolean) => {
    const { width, height } = compiled.sheets[0].program, picture = await pictureOf(width, height);
    await drawStampSheetsStill(picture.surface, sheets.composite);
    await owner.checked(`summing painted texture ${texture.id}`, () => {
      const taps = [width / texture.widthPx, height / texture.heightPx].map((ratio) => Math.min(SHOT_TEXTURE_MOST_TAPS, Math.max(1, Math.ceil(ratio))));
      const slot = arena.slot((views) => {
        const put = gpuUniformWriter(SHOT_TEXTURE_RESAMPLE, views);
        put('size', [texture.widthPx, texture.heightPx]);
        put('taps', [taps[0], taps[1]]);
        put('weight', weight);
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: light.createView(), loadOp: first ? 'clear' : 'load', clearValue: [0, 0, 0, 0], storeOp: 'store' }] });
      pass.setPipeline(resample);
      pass.setBindGroup(0, stampBindGroup(device, resample, [slot, picture.view, along(texture.wrap)]));
      pass.draw(3);
      pass.end();
      arena.flush();
      device.queue.submit([encoder.finish()]);
      arena.reset();
    });
  };

  /**
   * `slot`'s shares at `moment` solved, then laid, summed, encoded into its handle and its chain downsampled, unless
   * they keep what it was laid from.
   */
  const drawAt = async (slot: ShotPaintedTextureSlot, moment: PaintMoment) => {
    const { texture, handle, mips, light } = slot, shares = shotTextureSharesAt(texture, moment);
    if (slot.read && samePaintedSourceShares(slot.read, shares)) return;
    await withSharesSolved(shares, async (solved) => {
      const laid = solved.map(shotTextureShareLaid);
      if (slot.laid && sameShotTextureLaid(slot.laid, laid)) return;
      await gpuEachInTurn(solved, (share, s) => sumShare(slot, share, s === 0));
      await owner.checked(`encoding painted texture ${texture.id} and its mip chain`, () => {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: handle.texture.createView({ mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(encode);
        pass.setBindGroup(0, stampBindGroup(device, encode, [light.createView()]));
        pass.draw(3);
        pass.end();
        mips.encode(encoder);
        device.queue.submit([encoder.finish()]);
      });
      slot.laid = laid;
    });
    slot.read = shares;
  };

  const solveAt = (t: number, progress?: ShotSolveProgress) => gpuEachInTurn(drawn, async (slot) => {
    progress?.solving({ what: `texture ${slot.texture.id}`, at: t });
    await drawAt(slot, paintMoment(t));
    progress?.solved();
  }).then(() => undefined);

  return {
    handles: drawn.map(({ handle }) => handle),
    update: (t) => solveAt(t),
    solveAt,
    // A frame reading what the one before it did solves alike, so it's skipped: a source that never changes solves once.
    warmSolves: (frames) => drawn.flatMap(({ texture }) => {
      let before: readonly PaintedSourceShare[] | null = null;
      return frames.flatMap((moment): ShotWarmSolve[] => {
        const shares = shotTextureSharesAt(texture, moment);
        if (before && samePaintedSourceShares(before, shares)) return [];
        before = shares;
        return [{ solve: { what: `texture ${texture.id}`, at: moment.at }, run: () => withSharesSolved(shares, () => Promise.resolve()) }];
      });
    }),
    dispose: () => {
      for (const texture of owned.splice(0)) texture.destroy();
    },
  };
}
