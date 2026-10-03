// stamp-sheet-load.ts: a sheet program's solve on the GPU, loaded before its first application lands: its compositor,
// targets and passes, its deposits' marks, its regions and brushed masks, its proxies, and its wet stages with their
// scratch reserved for the largest box any of them is given (ENGINE 4.7), so nothing grows mid-solve. Synchronous: it
// runs inside one of the owner's checks.
//
// A wet stage moves paint in a film laid out as the film's group is (film f is group f): `filmOf` says whose film a
// deposit or proxy is. A proxy is a deposit's water landing in another film (one with a wet history, the only paint
// that's ever open), planned here as a (deposit, film) pair.

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { CompiledStampBrushedMask } from '../models/stamp-brushed-mask.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe-compile.ts';
import type { StampSheetProgram } from '../models/stamp-sheet-program.ts';
import { stampBoxUnion, stampStage } from '../models/stamp-stage.ts';
import { stampDepositWashLaw } from '../models/stamp-wet-landing.ts';
import { stampDepositWalled, type StampPaintMedia } from '../models/stamp-wetness.ts';
import { encodeStampBrushedMasks } from './stamp-brushed-mask-textures.ts';
import { loadStampDepositBank, type StampPaintBrushes } from './stamp-deposit-bank.ts';
import { createStampDepositDrawing, stampPaperTooth, type StampDepositBounds } from './stamp-deposit-drawing.ts';
import type { StampPaintCompositor, StampWashGroupLayer, StampWashLayer } from './stamp-paint-compositor.ts';
import type { StampPaintDevice } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { encodeStampRegionTextures, type StampRegionCoverage, type StampRegionTexture } from './stamp-region-textures.ts';
import { stampSheetFieldPasses } from './stamp-sheet-field-passes.ts';
import { stampSheetReductions } from './stamp-sheet-reductions.ts';
import { createStampSheetTargets } from './stamp-sheet-targets.ts';
import { createStampUniformArena } from './stamp-uniform-arena.ts';
import { putStampWetPrepare, stampWetField } from './stamp-wet-field.ts';
import { STAMP_WET_STAGES } from './stamp-wet-stage-list.ts';
import { stampWetStageReach, type StampWetWall } from './stamp-wet-stages.ts';

/** What a solve loads from: its program as posed, its compositor and media, its brushes and brushed masks. */
export type StampSheetLoadInput = {
  program: StampSheetProgram; compositor: StampPaintCompositor; media: StampPaintMedia<PaintMedium>; brushes: StampPaintBrushes; brushedMasks: readonly CompiledStampBrushedMask[];
};

/** A deposit's water as it lands in `film`, another film than its own: `proxy` stands for it there. */
export type StampSheetProxy = { film: number; proxy: CompiledStampDeposit };

/** Uniform slots one step of a solve may take: its brushed masks' marks at load, else a landing's and its films' settling. */
const stampSheetSlots = (films: number, marks: number) => Math.max(128, 64 + 2 * films, 4 * marks + 16);

/** `input`'s solve loaded through `device` (a scope of the solve's own) on `owner`'s targets, its first work submitted. */
export function loadStampSheetSolve(owner: StampPaintGpuOwner, device: StampPaintDevice, input: StampSheetLoadInput) {
  const { program, compositor, media, brushes, brushedMasks } = input;
  const stage = stampStage({ width: program.width, height: program.height });
  const posed = program.entries.map(({ deposit }) => deposit), prewets = program.washes.map(({ prewet }) => prewet);
  const wash = compositor.wash;
  if (!wash) throw new Error('stamp sheet: a sheet solve paints in pigment, whose compositor lays washes');
  const layouts = program.films.map(({ slots, name }, f): StampWashGroupLayer => {
    const layout = wash.group(f);
    if (layout.layers !== slots.paintLayers) throw new Error(`stamp sheet: film ${name} is laid out in ${slots.paintLayers} layers, and its compositor keeps ${layout.layers}`);
    return layout;
  });
  const filmOf = new Map(posed.map((deposit, k) => [deposit, program.washes[program.entries[k].wash].film]));
  const layoutOf = (deposit: CompiledStampDeposit) => {
    const film = filmOf.get(deposit);
    if (film === undefined) throw new Error(`stamp sheet: ${deposit.id} is no deposit or proxy of this solve`);
    return layouts[film];
  };
  const washLayer: StampWashLayer = {
    layersOf: (deposit) => layoutOf(deposit).layers, movedWgsl: (deposit) => layoutOf(deposit).movedWgsl, holdWgsl: (deposit) => layoutOf(deposit).holdWgsl,
  };

  const targets = createStampSheetTargets(owner, stage, compositor, program.films.length);
  const arena = createStampUniformArena(device, stampSheetSlots(program.films.length, brushedMasks.reduce((sum, { marks }) => sum + marks.length, 0)));
  const field = stampWetField(device, stage, { paper: targets.paper, rim: targets.rim, landing: targets.landing, scale: targets.scale }, targets.blank.view);
  const drawing = createStampDepositDrawing(device, {
    stage, compositor, arena, tipFootprint: brushes.tipFootprint,
    targets: {
      layer: targets.working, mask: targets.mask, cap: targets.cap, blurA: targets.blurA, blurB: targets.blurB, clip: targets.clip, blank: targets.blank, tints: null,
      press: targets.press?.view ?? null, before: targets.before,
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
  // Each deposit landing by the wash law with water to give, in every other film that can hold open paint.
  const proxies = new Map(posed.flatMap((deposit): [CompiledStampDeposit, StampSheetProxy[]][] => {
    const water = media.waterOf(deposit), own = filmOf.get(deposit)!;
    if (!bank.get(deposit)?.wash || water <= 0 || deposit.action.kind === 'lift') return [];
    const others = program.films.flatMap(({ slots }, film) => (film !== own && slots.open !== null ? [film] : []));
    return [[deposit, others.map((film) => ({ film, proxy: { ...deposit, id: `${deposit.id}|film${film}`, action: { kind: 'water', water } } }))]];
  }));
  for (const list of proxies.values()) for (const { film, proxy } of list) filmOf.set(proxy, film);

  // Every stage's scratch, for the most any box it's given covers: a drying's is its deposits' together.
  const washed = posed.flatMap((deposit) => (bank.get(deposit)?.wash ? [bank.get(deposit)!.box] : []));
  const touched = washed.reduce<StampPixelBox | null>((box, each) => stampBoxUnion(box, each), null);
  if (touched) {
    const extent = { w: touched.w, h: touched.h, layers: Math.max(1, ...layouts.map(({ layers }) => layers)) };
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
  // Clean films, dry paper everywhere and nothing seen since a drying: each prewet lands at its wash's start.
  targets.clear(encoder);
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
    stage, compositor, targets, arena, field, drawing, stages, bank, tooth, layouts, wetReach,
    reductions: stampSheetReductions(device, arena, { core: targets.core.view, clip: targets.clip.view, paper: targets.paper.view, open: targets.open.view, blank: targets.blank.view }),
    passes: stampSheetFieldPasses(device, stage, arena, { paper: targets.paper.view, rim: targets.rim.view, open: targets.open.view, blank: targets.blank.view }),
    /** The proxies `deposit`'s water lands as in other films: none for a deposit giving no water by the wash law. */
    proxiesOf: (deposit: CompiledStampDeposit): readonly StampSheetProxy[] => proxies.get(deposit) ?? [],
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
