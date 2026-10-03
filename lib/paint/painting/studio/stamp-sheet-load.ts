// stamp-sheet-load.ts: a sheet program's solve on the GPU, loaded before its first application lands: its compositor,
// targets and passes, its deposits' marks, its regions and brushed masks, and its wet stages with their scratch
// reserved for the largest box any of them is given (ENGINE 4.7), so nothing grows mid-solve. Synchronous: it runs
// inside one of the owner's checks.
//
// A wet stage asks the compositor about the deposit it moves paint for, which answers as its film's first deposit
// does: `filmOf` says whose it is. A proxy standing for another film (the solver's water reaching that film's paint)
// is set in it as it's made.

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { CompiledStampBrushedMask } from '../models/stamp-brushed-mask.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe-compile.ts';
import type { StampSheetPrewet, StampSheetProgram } from '../models/stamp-sheet-program.ts';
import { stampBoxUnion, stampStage } from '../models/stamp-stage.ts';
import { stampDepositWashLaw } from '../models/stamp-wet-landing.ts';
import { stampDepositWalled, type StampPaintMedia } from '../models/stamp-wetness.ts';
import { encodeStampBrushedMasks } from './stamp-brushed-mask-textures.ts';
import { loadStampDepositBank, type StampPaintBrushes } from './stamp-deposit-bank.ts';
import { createStampDepositDrawing, stampPaperTooth, type StampDepositBounds } from './stamp-deposit-drawing.ts';
import type { StampPaintCompositor, StampWashLayer } from './stamp-paint-compositor.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';
import { encodeStampRegionTextures, type StampRegionCoverage, type StampRegionTexture } from './stamp-region-textures.ts';
import { stampSheetFieldPasses, type StampSheetFilmLayout } from './stamp-sheet-field-passes.ts';
import { stampSheetReductions } from './stamp-sheet-reductions.ts';
import { createStampSheetTargets } from './stamp-sheet-targets.ts';
import { createStampUniformArena } from './stamp-uniform-arena.ts';
import { putStampWetPrepare, stampWetField } from './stamp-wet-field.ts';
import { STAMP_WET_STAGES } from './stamp-wet-stage-list.ts';
import { stampWetStageReach, type StampWetWall } from './stamp-wet-stages.ts';

/** What a solve loads from: its program, each entry's deposit and each wash's prewet as posed, its compositor and media, its brushes and brushed masks. */
export type StampSheetLoadInput = {
  program: StampSheetProgram; posed: readonly CompiledStampDeposit[]; prewets: readonly (StampSheetPrewet | null)[];
  compositor: StampPaintCompositor; media: StampPaintMedia<PaintMedium>; brushes: StampPaintBrushes; brushedMasks: readonly CompiledStampBrushedMask[];
};

/** Uniform slots one step of a solve may take: its brushed masks' marks at load, else a landing's and its films' settling. */
const stampSheetSlots = (films: number, marks: number) => Math.max(128, 64 + 2 * films, 4 * marks + 16);

/** `input`'s solve loaded through `device` (a scope of the solve's own), its first work encoded and submitted. */
export function loadStampSheetSolve(device: StampPaintDevice, input: StampSheetLoadInput) {
  const { program, posed, prewets, compositor, media, brushes, brushedMasks } = input;
  const stage = stampStage({ width: program.width, height: program.height });
  const filmOfEntry = program.entries.map((entry) => program.washes[entry.wash].film);
  const filmOf = new Map(posed.map((deposit, k) => [deposit, filmOfEntry[k]]));
  // A film's stand-in with its compositor: a deposit its painting holds (a direct wash's paint, any wet wash's).
  const representative = program.films.map((_, f) => posed.find((deposit, k) => filmOfEntry[k] === f && (program.washes[program.entries[k].wash].wetHistory || deposit.action.kind === 'paint')) ?? null);
  const wash = compositor.wash;
  if (!wash) throw new Error('stamp sheet: a sheet solve paints in pigment, whose compositor lays washes');
  const standIn = (deposit: CompiledStampDeposit) => representative[filmOf.get(deposit)!]!;
  const washLayer: StampWashLayer = {
    layersOf: (deposit) => wash.layersOf(standIn(deposit)),
    movedWgsl: (deposit) => wash.movedWgsl(standIn(deposit)),
    holdWgsl: (deposit) => wash.holdWgsl(standIn(deposit)),
  };
  const layouts = representative.map((deposit): StampSheetFilmLayout | null => deposit && { moved: wash.movedWgsl(deposit), layers: wash.layersOf(deposit) });

  const targets = createStampSheetTargets(device, stage, compositor, program.films.length);
  const arena = createStampUniformArena(device, stampSheetSlots(program.films.length, brushedMasks.reduce((sum, { marks }) => sum + marks.length, 0)));
  const field = stampWetField(device, stage, { paper: targets.paper, rim: targets.rim, landing: targets.landing, scale: targets.scale }, targets.blank.view);
  const drawing = createStampDepositDrawing(device, {
    stage, compositor, arena, tipFootprint: brushes.tipFootprint,
    targets: {
      layer: targets.working, mask: targets.mask, cap: targets.cap, blurA: targets.blurA, blurB: targets.blurB, clip: targets.clip, blank: targets.blank, tints: null,
      press: compositor.reads.press ? device.createTexture({ size: [stage.width, stage.height], format: 'r16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }).createView() : null,
      before: compositor.reads.before ? beforeTarget(device, targets.working.texture) : null,
      wet: { field, touch: targets.touch.view, footprint: targets.footprint, fresh: targets.fresh },
    },
  });
  const stages = drawing.wash!.loadStages(STAMP_WET_STAGES, washLayer);

  // A deposit's water reaches into every film's paint, so its box is as wide as its stages reach in any film's medium.
  const filmMedia = [...new Set(program.films.map(({ medium }) => medium))];
  const wetReach = (deposit: CompiledStampDeposit, medium: PaintMedium, water: number) =>
    Math.max(stampWetStageReach(STAMP_WET_STAGES, deposit, medium, water), ...filmMedia.map((other) => stampWetStageReach(STAMP_WET_STAGES, deposit, other, water)));
  const bank = loadStampDepositBank(device, { stage, tipFootprint: brushes.tipFootprint, compositor, wetReach }, posed.map((deposit, k) => {
    const entry = program.entries[k];
    return {
      deposit, identity: deposit, brush: brushes.deposits.get(deposit)!, medium: entry.medium,
      wash: stampDepositWashLaw(deposit, entry.medium, program.washes[entry.wash].wetHistory, media),
    };
  }));
  // Every stage's scratch, for the most any box it's given covers: a drying's is its deposits' together.
  const washed = posed.flatMap((deposit) => (bank.get(deposit)?.wash ? [bank.get(deposit)!.box] : []));
  const touched = washed.reduce<StampPixelBox | null>((box, each) => stampBoxUnion(box, each), null);
  if (touched) {
    const extent = { w: touched.w, h: touched.h, layers: Math.max(1, ...layouts.map((layout) => layout?.layers ?? 1)) };
    for (const loaded of [...stages.deposit, ...stages.drying]) loaded.reserve(extent);
  }

  // Each flood's barrier within its `within`s, each other deposit's `within`, each prewet's region, each fluid.
  const coverages: StampRegionCoverage[] = [];
  const coverageOf = <K,>(entries: readonly (readonly [K, StampRegionCoverage])[]) => entries.map(([key, coverage]) => [key, coverages.push(coverage) - 1] as const);
  const barriers = coverageOf(posed.flatMap((deposit) => (deposit.kind === 'flood' ? [[deposit, { area: deposit.flood.barrier, clips: deposit.within ?? [] }] as const] : [])));
  const withins = coverageOf(posed.flatMap((deposit) => {
    const [area, ...clips] = deposit.within ?? [];
    return area ? [[deposit, { area, clips }] as const] : [];
  }));
  const prewetAreas = coverageOf(prewets.flatMap((prewet, w) => (prewet ? [[w, { area: prewet.area, clips: [] }] as const] : [])));
  const fluids = [...posed.flatMap(({ mask }) => (mask ? [mask] : [])), ...prewets.flatMap((prewet) => (prewet?.held ? [prewet.held] : []))];
  const tooth = stampPaperTooth(program.paper, brushes.image, stage.frame);
  const encoder = device.createCommandEncoder();
  const brushed = encodeStampBrushedMasks(device, encoder, drawing, brushedMasks, brushes.marks, tooth);
  const made = encodeStampRegionTextures(device, encoder, { stage, blank: targets.blank.view }, { coverages, fluids, brushed });
  // Dry paper everywhere, nothing seen since a drying: each prewet lands at its wash's start.
  field.prepare(encoder, arena.slot((views) => putStampWetPrepare(views, { stage, preparation: null })), null, null);
  arena.flush();
  device.queue.submit([encoder.finish()]);
  arena.reset();
  const texturesOf = <K,>(indices: readonly (readonly [K, number])[]) => new Map(indices.map(([key, index]) => [key, made.coverages[index]]));
  const regions = { barriers: texturesOf(barriers), withins: texturesOf(withins), prewets: texturesOf(prewetAreas), fluids: made.fluids };

  /** The region `deposit` lands within: a flood's barrier, else its `within`; null for none or off the stage. */
  const barrierOf = (deposit: CompiledStampDeposit) => (deposit.kind === 'flood' ? regions.barriers.get(deposit) : regions.withins.get(deposit)) ?? null;
  const walls = new WeakMap<StampRegionTexture, StampWetWall>();
  return {
    stage, compositor, targets, arena, field, drawing, stages, bank, tooth, filmOf, layouts, wetReach,
    reductions: stampSheetReductions(device, arena, { touch: targets.touch.view, clip: targets.clip.view, paper: targets.paper.view, open: targets.open.view, blank: targets.blank.view }),
    passes: stampSheetFieldPasses(device, stage, arena, { paper: targets.paper.view, rim: targets.rim.view, open: targets.open.view, blank: targets.blank.view }),
    /** Wash `w`'s prewet region, null for none on the stage. */
    prewetRegion: (w: number) => regions.prewets.get(w) ?? null,
    /** A fluid's state as a region, null for none on the stage. */
    fluidOf: (mask: CompiledStampDeposit['mask']) => (mask ? regions.fluids.get(mask) ?? null : null),
    /** Where `deposit` may lay paint past its stamps, `clipped` to its wash's clip base or not. */
    boundsOf: (deposit: CompiledStampDeposit, clipped: boolean): StampDepositBounds => ({
      fluid: deposit.mask ? regions.fluids.get(deposit.mask) ?? null : null, within: deposit.kind === 'flood' || deposit.within ? { region: barrierOf(deposit) } : null, clipped,
    }),
    /** The wall `deposit` dries against (StampWetBank's wallOf): a walled flood's barrier, else its `within`. */
    wallOf: (deposit: CompiledStampDeposit): StampWetWall | null => {
      const region = stampDepositWalled(deposit) ? barrierOf(deposit) : regions.withins.get(deposit) ?? null;
      if (!region) return null;
      if (!walls.has(region)) walls.set(region, { view: region.view, box: region.box });
      return walls.get(region)!;
    },
  };
}

export type StampSheetSolveGpu = ReturnType<typeof loadStampSheetSolve>;

/** What a compositor reading the layer before a deposit reads, shaped as `layer`. */
function beforeTarget(device: StampPaintDevice, layer: GPUTexture) {
  const texture = device.createTexture({ size: [layer.width, layer.height, layer.depthOrArrayLayers], format: layer.format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
  return { texture, view: texture.createView({ dimension: '2d-array' }) };
}
