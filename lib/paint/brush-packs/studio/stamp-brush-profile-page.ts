// stamp-brush-profile-page.ts: an import's profile measurement, the browser side, run by
// engine/measure-stamp-brush-profiles.ts through withBrowserModulePage. It paints each brush's probes
// (models/stamp-brush-profile-probes.ts) with the production renderer: its edge probes on its style's paper in its
// style's paint, their crops copied back from the bare paper and from the painted page. It hands back the profile's samples, or why the brush can't be measured. A GPU
// fault fails the call, never reads as a refusal. Images are served at /files/.

import { bindStampBrushImages, stampBrushImages, type StampBrush, type StampBrushAsset, type StampBrushImageSource, type StampBrushLayer, type StampBrushSupportSample } from '#lib/paint/brush/models/stamp-brush.ts';
import { STAMP_ORDERED_TILE, stampMarksOrderedBinsLength, stampMarksPlan } from '#lib/paint/painting/models/stamp-mark-load.ts';
import { stampTipFootprintOf, stampTipSupportOf, type StampTipFootprint } from '#lib/paint/painting/models/stamp-tip-support.ts';
import { StampPigmentSlotsExceeded } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import { compileStampPaintRecipe, stampPassDeposits, type CompiledStampDeposit, type CompiledStampPaint } from '#lib/paint/painting/models/stamp-paint-recipe-compile.ts';
import type { StampPixelBox } from '#lib/paint/painting/models/stamp-blur-region.ts';
import { createStampPaintRenderer } from '#lib/paint/painting/studio/stamp-paint-renderer.ts';
import type { StampPaintImage } from '#lib/paint/painting/studio/stamp-paint-gpu.ts';
import { createStampPaintGpuOwner, type StampPaintGpuOwner } from '#lib/paint/painting/studio/stamp-paint-gpu-owner.ts';
import { createStampPaintSurface, type StampPaintSurface } from '#lib/paint/painting/studio/stamp-paint-surface.ts';
import { stampPaintPackAssetUrl, type StampPaintPackUrls } from '../models/stamp-paint-pack-urls.ts';
import {
  refineStampBrushEdges, STAMP_BRUSH_PROFILE_SEEDS, stampEdgeProbeSeedsSettle, STAMP_PROBE_CANVAS_MOST, stampBrushEdgeNoise, stampBrushEdgeSample, stampBrushProbe, stampBrushProfileDiameters, StampBrushProbeRefusal, stampEdgeProbeSheet,
  stampProbeContrast, stampProbeEdgeOffsets, stampProbePaintings, stampProbeSections,
  type StampBrushProbe, type StampBrushProbeMedium, type StampBrushProfileMeasured, type StampMeasuredEdge,
  type StampProbeDepositLoad, type StampProbeSections,
} from '../models/stamp-brush-profile-probes.ts';

/** The packs' URLs the owners fetch images by, the current call's. */
let packUrls: StampPaintPackUrls = {};
/** A device owner fetching the current call's images. A lost device fails the reads (mapAsync rejects), never blank pixels. */
const probeOwner = () => createStampPaintGpuOwner((asset) => stampPaintPackAssetUrl(packUrls, asset));
/**
 * A surface, the texture it draws into, whose crops are copied back, and the owner of both. Each side has an owner
 * of its own: an owner keeps every target it made until it's disposed.
 */
type ProbeSurface = { owner: StampPaintGpuOwner; surface: StampPaintSurface; frame: GPUTexture };
/**
 * Surfaces by side, px, most recently used last: a probe canvas's size rounded up to the next of SURFACE_SIDES. A
 * surface's targets at the largest side take gigabytes, so only SURFACES_KEPT stay, the latest sides:
 * an import holding every size at once is what other work on the machine pushes into losing the device.
 */
const surfaces = new Map<number, Promise<ProbeSurface>>();
const SURFACE_SIDES = [512, 1024, 2048, 3072, 4096, STAMP_PROBE_CANVAS_MOST] as const, SURFACES_KEPT = 2;

/** The side of the surface a canvas `size` px square is painted on. */
const surfaceSideOf = (size: number) => SURFACE_SIDES.find((s) => s >= size)!;

/** A surface at least `size` px square. Each call may dispose the least recently used: a page holds none across calls. */
async function surfaceOf(size: number): Promise<ProbeSurface> {
  const side = surfaceSideOf(size), kept = surfaces.get(side);
  surfaces.delete(side);
  // Disposed before another is made, so no more than SURFACES_KEPT ever hold the GPU at once.
  const evicted = [...surfaces].slice(0, Math.max(0, surfaces.size - SURFACES_KEPT + 1));
  for (const [old] of evicted) surfaces.delete(old);
  await Promise.all(evicted.map(async ([, made]) => {
    const { owner, surface, frame } = await made;
    surface.dispose();
    frame.destroy();
    owner.dispose();
  }));
  const made = kept ?? probeOwner().then(async (owner) => {
    const frame = owner.webgpu.createTexture({ size: [side, side], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    return { owner, surface: await createStampPaintSurface(owner, { frame }), frame };
  });
  surfaces.set(side, made);
  return made;
}

/**
 * A brush's tips at any diameter as an owner of their own uploads them, the very bytes the renderer's stamps sample,
 * a bristle tip drawn at each diameter as a deposit there draws it; the owner is disposed with them.
 */
type ProbeTips = {
  boundAt: (diameter: number) => StampBrush<StampPaintImage>; footprintOf: (layer: BoundLayer) => StampTipFootprint;
  supportAt: (diameter: number) => StampBrushSupportSample; dispose: () => void;
};
type BoundLayer = StampBrushLayer<StampPaintImage>;

async function probeTipsOf(brush: StampBrush): Promise<ProbeTips> {
  const owner = await probeOwner(), assets = stampBrushImages(brush);
  const loaded = await owner.images(assets.map(({ image, wrap }) => ({ asset: image, kind: wrap === 'tile' ? 'grain' as const : 'tip' as const })));
  const byKey = new Map(assets.map(({ image }, i) => [assetKey(image), loaded[i]]));
  const image = (source: StampBrushImageSource) => ('draw' in source ? owner.drawnImage(source.key, source.draw) : byKey.get(assetKey(source))!);
  const bound = new Map<number, StampBrush<StampPaintImage>>();
  const boundAt = (diameter: number) => bound.get(diameter) ?? bound.set(diameter, bindStampBrushImages(brush, diameter, image)).get(diameter)!;
  const footprintOf = (layer: BoundLayer) => stampTipFootprintOf(layer.tip, owner.tipLevels), supportOf = (layer: BoundLayer) => stampTipSupportOf(footprintOf(layer));
  return {
    boundAt, footprintOf,
    supportAt: (diameter) => {
      const at = boundAt(diameter);
      return { main: supportOf(at), dual: at.dual ? supportOf(at.dual) : null };
    },
    dispose: () => owner.dispose(),
  };
}

/**
 * `painting`'s deposits' loads by their own IDs, painted on a canvas `size` px square: their stamps, and the bin
 * entries an ordered layer's take, binned as the renderer bins them.
 */
function probeLoads(painting: CompiledStampPaint, tips: ProbeTips, size: number): Map<string, StampProbeDepositLoad> {
  const tiles = Math.ceil(surfaceSideOf(size) / STAMP_ORDERED_TILE);
  return new Map([...depositsOf(painting)].map(([id, deposit]) => {
    const at = tips.boundAt(deposit.diameter), layers = [{ layer: at, marks: deposit.stamps }, ...(at.dual ? [{ layer: at.dual, marks: deposit.dualStamps }] : [])];
    const bins = layers.reduce((sum, { layer, marks }) => sum + (stampMarksPlan(marks, layer.accumulation).kind === 'ordered'
      ? stampMarksOrderedBinsLength(marks, tips.footprintOf(layer), tiles, tiles, 0) : 0), 0);
    return [id, { stamps: deposit.stamps.length + deposit.dualStamps.length, bins }];
  }));
}

/** `crops` of what `frame` holds once the GPU has drawn what's been submitted: RGBA bytes each, row by row. */
async function cropsOf({ owner, frame }: ProbeSurface, crops: readonly StampPixelBox[]): Promise<Uint8ClampedArray[]> {
  const rows = crops.map(({ w }) => Math.ceil((w * 4) / 256) * 256), offsets = crops.map((_, i) => rows.slice(0, i).reduce((sum, row, j) => sum + row * crops[j].h, 0));
  const size = offsets.at(-1)! + rows.at(-1)! * crops.at(-1)!.h;
  const buffer = owner.webgpu.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  try {
    await owner.checked('reading back the probes', () => {
      const encoder = owner.webgpu.createCommandEncoder();
      crops.forEach(({ x, y, w, h }, i) => encoder.copyTextureToBuffer({ texture: frame, origin: { x, y } }, { buffer, offset: offsets[i], bytesPerRow: rows[i], rowsPerImage: h }, [w, h]));
      owner.webgpu.queue.submit([encoder.finish()]);
    });
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    return crops.map(({ w, h }, i) => {
      const bytes = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) bytes.set(mapped.subarray(offsets[i] + y * rows[i], offsets[i] + y * rows[i] + w * 4), y * w * 4);
      return bytes;
    });
  } finally {
    buffer.destroy();
  }
}

/**
 * A brush's visible offsets by heading at `diameter`: its edge probes painted page by page (in parts where the
 * renderer can't hold a page at once), each read as its contrast with the bare paper (the painting of no probes).
 */
async function measureEdges(probe: StampBrushProbe, tips: ProbeTips, diameter: number, medium: StampBrushProbeMedium): Promise<StampMeasuredEdge> {
  const sheet = stampEdgeProbeSheet(probe, diameter, medium), read: StampProbeSections[] = [], bare = compileStampPaintRecipe(sheet.recipe(new Set()));
  const drawn = async (at: ProbeSurface, painting: CompiledStampPaint, crops: readonly StampPixelBox[]) => {
    const renderer = await createStampPaintRenderer(at.surface, painting);
    try {
      await renderer.draw({ kind: 'once', t: 0 });
      return await cropsOf(at, crops);
    } finally {
      renderer.dispose();
    }
  };
  const paint = async (at: ProbeSurface, painting: CompiledStampPaint, ids: readonly string[]) => {
    const pieces = sheet.pieces.filter(({ probe: p }) => ids.includes(sheet.probes[p].id)), crops = pieces.map(({ crop }) => crop);
    const paper = await drawn(at, bare, crops), painted = await drawn(at, painting, crops);
    read.push(...stampProbeSections(sheet, pieces.map((piece, i) => ({ piece, contrast: stampProbeContrast(paper[i], painted[i]) }))));
  };
  // One page and part at a time: each holds the GPU's memory until it's disposed.
  const paintSeeds = (seeds: readonly string[]) => sheet.pages.reduce(async (done, page) => {
    await done;
    const ids = page.ids.filter((id) => seeds.includes(sheet.probes.find((p) => p.id === id)!.seed));
    if (!ids.length) return;
    const at = await surfaceOf(page.size), whole = compileStampPaintRecipe(sheet.recipe(new Set(ids)));
    const parts = stampProbePaintings(probeLoads(whole, tips, page.size));
    await parts.reduce(async (painted, part) => {
      await painted;
      await paint(at, parts.length === 1 ? whole : compileStampPaintRecipe(sheet.recipe(new Set(part))), part);
    }, Promise.resolve());
  }, Promise.resolve());
  const [first, ...rest] = STAMP_BRUSH_PROFILE_SEEDS;
  await paintSeeds([first]);
  // A sparse brush's first seed may leave a side no crossing that every seed together finds: the rest are drawn.
  const settled = (() => {
    try {
      return { diameter, ...stampProbeEdgeOffsets(sheet, read) };
    } catch (error) {
      if (error instanceof StampBrushProbeRefusal) return null;
      throw error;
    }
  })();
  if (settled && stampEdgeProbeSeedsSettle(settled)) return settled;
  await paintSeeds(rest);
  return { diameter, ...stampProbeEdgeOffsets(sheet, read) };
}

/** A probe painting's deposits by their own IDs. */
const depositsOf = (painting: CompiledStampPaint) => new Map<string, CompiledStampDeposit>(painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass).map((d) => [d.id.split('/').at(-1)!, d] as const))));


const assetKey = ({ style, pack, file }: StampBrushAsset) => `${style}/${pack}/${file}`;

/** `brush`'s profile samples, measured from its source as the pack's import resolved it, in its style's `medium`. */
async function measureStampBrushProfile(brush: StampBrush, urls: StampPaintPackUrls, medium: StampBrushProbeMedium): Promise<StampBrushProfileMeasured> {
  packUrls = urls;
  // Its support first: how far its probes can reach sizes their crops, and its tips bin their stamps.
  const tips = await probeTipsOf(brush);
  try {
    const probe = stampBrushProbe(brush, tips.supportAt);
    const measured = await refineStampBrushEdges(stampBrushProfileDiameters(probe), (diameter) => measureEdges(probe, tips, diameter, medium));
    return { samples: measured.map(({ diameter, ...edge }) => ({ diameter, edge: stampBrushEdgeSample(edge), edgeNoise: stampBrushEdgeNoise(edge.noise), support: tips.supportAt(diameter) })) };
  } catch (error) {
    // A brush whose colour varies lays a pigment per colour in a pigment style; past what a wash holds, no fill of it
    // could be laid there either.
    if (error instanceof StampBrushProbeRefusal || error instanceof StampPigmentSlotsExceeded) return { refused: error.message };
    throw error;
  } finally {
    tips.dispose();
  }
}

/** The browser measuring, as provenance records it. */
const stampProfileBrowser = () => navigator.userAgent;

Object.assign(globalThis, { measureStampBrushProfile, stampProfileBrowser });
