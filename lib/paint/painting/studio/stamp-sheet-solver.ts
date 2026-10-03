// stamp-sheet-solver.ts: a sheet program, posed, solved forward (ENGINE 3, 4): each application in order, its time
// decided against the paper the ones before it left (stamp-sheet-decide.ts), then landed into the wet field and its
// film, its water reaching other films' open paint by a proxy; a drying closes once all since the last has set,
// rimming the films painted in it.
//
// A decision is remembered under the key after its entry (ENGINE 4.2): a later solve through that prefix reads nothing
// back for it, though it paints it again, as only a solve's last films are kept (stamp-sheet-films.ts). A prefix whose
// every decision is remembered and whose films are still kept under its last key solves nothing.

import { paintPigmentSeed } from '#lib/paint/materials/models/paint-paper.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { stampBrushedMasksUnder } from '../models/stamp-brushed-mask.ts';
import type { StampPaintCostTally } from '../models/stamp-paint-costs.ts';
import { stampPaintFieldEnds } from '../models/stamp-paint-field.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe-compile.ts';
import {
  stampSheetClosed, stampSheetDecided, stampSheetGrid, stampSheetLanded, stampSheetLandingAt, stampSheetMaySetBy, stampSheetPainted, stampSheetPrewetted, stampSheetRebased,
  stampSheetSetKnown, stampSheetSolveStart, type StampSheetDecision, type StampSheetSolveState,
} from '../models/stamp-sheet-schedule.ts';
import { stampSheetMixedPainting, type StampSheetProgram } from '../models/stamp-sheet-program.ts';
import { stampSheetEntryKey, stampSheetHeadKey } from '../models/stamp-sheet-state-key.ts';
import { STAMP_REST_IDENTITY } from '../models/stamp-rest-map.ts';
import { stampBoxUnion } from '../models/stamp-stage.ts';
import { stampDepositSupport } from '../models/stamp-tip-support.ts';
import { stampDryingRimCoversLanding } from '../models/stamp-wet-rim.ts';
import { stampDrying, stampFloodHeldWetness, type StampDrying, type StampWashDrying, type StampWetLanding } from '../models/stamp-wetness.ts';
import { bindStampPaintBrushes, type StampPaintBrushes } from './stamp-deposit-bank.ts';
import { stampPaintCompositorFor } from './stamp-paint-compositor-for.ts';
import { clearStampTarget, type StampPaintDevice } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { decideStampSheetEntry } from './stamp-sheet-decide.ts';
import { keepStampSheetFilms, keptStampSheetFilms, type StampSheetFilmKept } from './stamp-sheet-films.ts';
import { loadStampSheetSolve, type StampSheetSolveGpu } from './stamp-sheet-load.ts';
import { createStampSheetSteps, type StampSheetClock } from './stamp-sheet-steps.ts';
import { withStampSolveLease } from './stamp-solve-lease.ts';
import { planStampWetStage, type StampWetBank, type StampWetDepositMoment, type StampWetStagePlan } from './stamp-wet-stages.ts';

export type StampSheetSolveOptions = {
  /** How many entries are solved, from the first: all of them when left out. */
  through?: number;
  /** Whether the painting ends after them, its last drying closed: when they're all of it, unless said. */
  finish?: boolean;
  /** Where the solve counts what it cost: the solve, its readbacks, decisions made and reused, warnings. */
  costs?: StampPaintCostTally;
};

/** A solve: its last key (Kₖ after the entries solved), how many it solved and whether the painting ended there, the films it kept, each entry's decision. */
export type StampSheetSolved = { key: string; through: number; finished: boolean; films: readonly StampSheetFilmKept[]; decisions: readonly StampSheetDecision[] };

/** How many decisions are remembered, the oldest forgotten first. */
const STAMP_SHEET_REMEMBERED = 65536;
const remembered = new Map<string, StampSheetDecision>();

function rememberStampSheetDecision(key: string, decision: StampSheetDecision) {
  remembered.set(key, decision);
  if (remembered.size > STAMP_SHEET_REMEMBERED) remembered.delete(remembered.keys().next().value!);
}

/** The decisions remembered for the first `through` entries keyed `keys` (K₀ first), or null unless every one is. */
function stampSheetRemembered(keys: readonly string[], through: number): StampSheetDecision[] | null {
  const decisions = keys.slice(1, through + 1).map((key) => remembered.get(key));
  return decisions.every((decision): decision is StampSheetDecision => decision !== undefined) ? decisions : null;
}

/**
 * `program` (posed: painting-pose.ts) solved on `owner`'s device as `options` say, once every solve asked for before
 * it has finished.
 */
export function solveStampSheet(owner: StampPaintGpuOwner, program: StampSheetProgram, options: StampSheetSolveOptions = {}): Promise<StampSheetSolved> {
  return withStampSolveLease(owner, () => solveLeased(owner, program, options));
}

/** Throws unless each wash's entries run together: an unclocked order lays a wash whole before the next. */
function checkStampSheetWashRuns(program: StampSheetProgram) {
  program.entries.forEach((entry, k) => {
    if (k > 0 && program.entries[k - 1].wash !== entry.wash && program.entries.slice(0, k).some((before) => before.wash === entry.wash)) {
      throw new Error(`stamp sheet: wash ${program.washes[entry.wash].name}'s applications are split by another wash's; a solve lays each wash whole`);
    }
  });
}

/** K₀ to K_`through` for `program`'s entries: each its datum and pose after the key before it. */
async function stampSheetKeys(program: StampSheetProgram, through: number): Promise<string[]> {
  const chain = async (keys: string[]): Promise<string[]> => {
    const k = keys.length - 1;
    if (k === through) return keys;
    return chain([...keys, await stampSheetEntryKey(keys[k], program.entries[k])]);
  };
  return chain([await stampSheetHeadKey(program.head)]);
}

const pixelBoxMeets = (a: StampPixelBox | null, b: StampPixelBox) => !!a && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

async function solveLeased(owner: StampPaintGpuOwner, program: StampSheetProgram, { through = program.entries.length, finish, costs }: StampSheetSolveOptions): Promise<StampSheetSolved> {
  checkStampSheetWashRuns(program);
  if (!(Number.isInteger(through) && through >= 0 && through <= program.entries.length)) throw new Error(`stamp sheet: a solve goes through 0 to ${program.entries.length} entries, not ${through}`);
  const keys = await stampSheetKeys(program, through), finished = finish ?? through === program.entries.length;
  const filmKey = `${keys[through]}|${finished ? 'finished' : 'open'}`, known = stampSheetRemembered(keys, through);
  const kept = known && keptStampSheetFilms(owner, filmKey, program.films.length);
  costs?.count(kept ? 'film hits' : 'film misses', program.films.length);
  if (known && kept) return { key: keys[through], through, finished, films: kept, decisions: known };
  const choice = stampPaintCompositorFor(stampSheetMixedPainting(program));
  if (!choice.wet) throw new Error('stamp sheet: a sheet solve paints in pigment, its films each in a medium');
  const posed = program.entries.map(({ deposit }) => deposit);
  const brushedMasks = stampBrushedMasksUnder([...posed.map(({ mask }) => mask), ...program.washes.map(({ prewet }) => prewet?.held)]);
  const brushes = await bindStampPaintBrushes(owner, { deposits: posed, marks: brushedMasks.flatMap(({ marks }) => marks), paper: program.paper });
  const scope = owner.scope();
  try {
    const gpu = await owner.checked('loading a sheet solve', () => loadStampSheetSolve(owner, scope.device, {
      program, compositor: choice.compositorOn(scope.device), media: choice.media, brushes, brushedMasks,
    }));
    const drying = stampDrying(program.water.wetting, program.paper);
    const run = stampSheetRun(owner, scope.device, { program, gpu, drying, brushes, waterOf: choice.media.waterOf, costs: costs ?? null });
    const decisions = await run.entries(keys, through);
    const films = await run.steps.step('keeping the films', (encoder) => {
      if (finished) run.finish(encoder);
      gpu.targets.putBack(encoder);
      const finals = program.films.map((_, f) => ({ texture: gpu.targets.film(f).texture, box: run.state().painted[f] }));
      return keepStampSheetFilms(owner, encoder, filmKey, finals);
    });
    costs?.solved({ program: program.name, from: through ? program.entries[0].name : 'no entry', entries: through });
    return { key: keys[through], through, finished, films, decisions };
  } finally {
    scope.destroy();
  }
}

/** What a run lays through its loaded GPU work, its paper drying as `drying` says: its brushes, each deposit's water, where it counts costs. */
type StampSheetRunInput = {
  program: StampSheetProgram; gpu: StampSheetSolveGpu; drying: StampDrying; brushes: StampPaintBrushes; waterOf: (deposit: CompiledStampDeposit) => number;
  costs: StampPaintCostTally | null;
};

/** A solve's run over its loaded GPU work: its state, and the clip bases a later wash clips to. */
function stampSheetRun(owner: StampPaintGpuOwner, device: StampPaintDevice, { program, gpu, drying, brushes, waterOf, costs }: StampSheetRunInput) {
  let state: StampSheetSolveState = stampSheetSolveStart(program.films.length, program.washes.length);
  const clock: StampSheetClock = {
    base: () => state.base,
    after: (encoder, tau) => {
      const rebased = stampSheetRebased(state, tau);
      if (rebased.shift) gpu.passes.rebase(encoder, rebased.shift);
      state = rebased.state;
      return Math.fround(tau - state.base);
    },
  };
  const steps = createStampSheetSteps(owner, device, gpu, drying, clock, costs);
  const { targets, passes } = gpu;
  const filmOfEntry = (k: number) => program.washes[program.entries[k].wash].film;
  const firstOf = program.washes.map((_, w) => program.entries.findIndex((entry) => entry.wash === w));
  const lastOf = program.washes.map((_, w) => program.entries.findLastIndex((entry) => entry.wash === w));
  // Films with a wet history: the only paint that's ever open, so the only paint settled, marked open or reached.
  const openFilms = program.films.flatMap(({ slots }, f) => (slots.open === null ? [] : [f]));
  const clipBases = new Map<number, GPUTextureView>(), clippedTo = new Set(program.washes.map(({ clipTo }) => clipTo));
  const paintedInto = (film: number, box: StampPixelBox | null) => {
    state = stampSheetPainted(state, film, box);
  };
  /** Each open film but `except` painted over `box`, settled where the paper has, before water lands there at `at`. */
  const settleUnder = (encoder: GPUCommandEncoder, box: StampPixelBox, at: number, except: number | null) => {
    for (const f of openFilms) if (f !== except && pixelBoxMeets(state.painted[f], box)) passes.settle(encoder, targets.film(f).view, gpu.layouts[f], box, at, drying);
  };
  /** Whether everything landed since the last drying has set by `at`: read back only once it could have. */
  const setBy = async (at: number) => {
    if (!stampSheetMaySetBy(state, at)) return false;
    const latest = await steps.latestSetOver(state.since ? [state.since] : []);
    state = stampSheetSetKnown(state, latest);
    return at >= state.knownSetAt;
  };

  /** Closes the drying of what's landed since the last at `at`: each film that painted in it rimmed, then the field's sight cleared. */
  const close = (encoder: GPUCommandEncoder, at: number, closes: StampWashDrying['closes']) => {
    const { state: next, closed } = stampSheetClosed(state, at, closes, drying);
    state = next;
    if (!closed) return;
    const id = closed.ordinal ? `sheet|dry${closed.ordinal}` : 'sheet';
    const landings = new Map(closed.since.map(({ entry, landing }) => [program.entries[entry].deposit, landing]));
    program.films.forEach((_, f) => {
      const own = closed.since.filter(({ entry }) => filmOfEntry(entry) === f);
      if (!own.length) return;
      const rim = program.washes[program.entries[own.at(-1)!.entry].wash].rim;
      const film: StampWashDrying = { id: `${id}|film${f}`, deposits: own.map(({ entry }) => program.entries[entry].deposit), rim, at, closes, wettest: closed.wettest };
      const bank: StampWetBank = { device, landings, dryings: [film], boxOf: (deposit) => gpu.bank.get(deposit)?.box ?? null, wallOf: gpu.wallOf };
      targets.swap(encoder, f);
      for (const stage of gpu.stages.drying) paintedInto(f, planStampWetStage(stage, bank).encode(encoder, { drying: film, seed: paintPigmentSeed(film.id) }));
    });
    gpu.field.dried(encoder);
  };

  /** Wash `w`'s start at `at` (the GPU's time): its clip base, then its prewet's water over every film's paint settled. */
  const startWash = (encoder: GPUCommandEncoder, w: number, at: number) => {
    const { clipTo, prewet } = program.washes[w];
    if (clipTo === null) clearStampTarget(encoder, targets.clip.view);
    else passes.clipBase(encoder, clipBases.get(clipTo)!, targets.clip.view, 0);
    const region = gpu.prewetRegion(w);
    if (!prewet || !region) return;
    settleUnder(encoder, region.box, at, null);
    passes.prewet(encoder, { region, fluid: gpu.fluidOf(prewet.held), water: prewet.water, rest: prewet.rest ?? STAMP_REST_IDENTITY }, at, drying);
  };

  /**
   * A plan carrying `deposit`'s water into every other film's paint it meets in `box`: its deposit stages run again
   * for its proxy in each, with that film swapped in. Null for no such paint.
   */
  const reachInto = (deposit: CompiledStampDeposit, landing: StampWetLanding, box: StampPixelBox): StampWetStagePlan<StampWetDepositMoment> | null => {
    const reaching = gpu.proxiesOf(deposit).flatMap(({ film, proxy }) => {
      if (!pixelBoxMeets(state.painted[film], box)) return [];
      const found = { ...landing, medium: program.films[film].medium };
      const bank: StampWetBank = { device, landings: new Map([[proxy, found]]), dryings: [], boxOf: () => box, wallOf: () => gpu.wallOf(deposit) };
      return [{ film, proxy, found, plans: gpu.stages.deposit.map((stage) => planStampWetStage(stage, bank)) }];
    });
    if (!reaching.length) return null;
    const reaches = reaching.flatMap(({ proxy, plans }) => plans.map((plan) => plan.landingReach?.(proxy) ?? null).filter((reach) => reach !== null));
    return {
      extent: null,
      encode: (encoder, moment) => {
        for (const { film, proxy, found, plans } of reaching) {
          targets.swap(encoder, film);
          for (const plan of plans) paintedInto(film, plan.encode(encoder, { ...moment, deposit: proxy, landing: found, seed: paintPigmentSeed(proxy.id) }));
        }
        return null;
      },
      landingReach: (asked) => (asked === deposit && reaches.length ? Math.max(...reaches) : null),
    };
  };

  /** Lands entry `k` at the decided τ, `at` the GPU's time for it: drawn into its film, by the wash law when it's laid by one. */
  const land = (encoder: GPUCommandEncoder, k: number, at: number) => {
    const entry = program.entries[k], { deposit } = entry, loaded = gpu.bank.get(deposit)!, { film, clipTo } = program.washes[entry.wash];
    const bounds = gpu.boundsOf(deposit, clipTo !== null), draw = { paintAt: 0, tooth: gpu.tooth, bounds, trace: null };
    if (!loaded.wash) {
      targets.swap(encoder, film);
      paintedInto(film, gpu.drawing.drawDeposit(encoder, deposit, loaded, { ...draw, wet: null }));
      return;
    }
    const water = waterOf(deposit), support = stampDepositSupport(deposit, brushes.tipsOf(deposit));
    const landing = stampSheetLandingAt(state.water, state.tau, { water, medium: entry.medium, support, reach: gpu.wetReach(deposit, entry.medium, water) }, drying);
    const { box } = loaded, found: StampWetLanding = { ...landing, tau: at };
    if (box) settleUnder(encoder, box, at, film);
    targets.swap(encoder, film);
    const bank: StampWetBank = { device, landings: new Map([[deposit, found]]), dryings: [], boxOf: () => box, wallOf: gpu.wallOf };
    const own = gpu.stages.deposit.map((stage) => planStampWetStage(stage, bank));
    const reached = box && reachInto(deposit, found, box);
    const wet = { landing: found, plans: { deposit: reached ? [...own, reached] : own, drying: [] }, seed: paintPigmentSeed(deposit.id), rimmed: stampDryingRimCoversLanding(deposit, landing) };
    paintedInto(film, gpu.drawing.drawDeposit(encoder, deposit, loaded, { ...draw, wet }));
    state = stampSheetLanded(state, { entry: k, wash: entry.wash, landing, support, lifts: deposit.action.kind === 'lift', held: stampFloodHeldWetness(deposit, landing), box });
  };

  /** Entry `k` decided (or remembered under `key`, the key after it) and landed. */
  const entry = async (k: number, key: string, unscheduled: readonly string[]): Promise<{ decision: StampSheetDecision; known: boolean }> => {
    const { wash: w, name, on, bloom, deposit } = program.entries[k], wash = program.washes[w], loaded = gpu.bank.get(deposit)!, clipped = wash.clipTo !== null;
    const known = remembered.get(key) ?? null;
    let tau0 = state.tau, closesAtStart = false;
    if (firstOf[w] === k) {
      // A wash meets its film's earlier washes set.
      const earlier = state.wetted.flatMap((boxes, v) => (v < w && program.washes[v].film === wash.film && boxes.length ? [boxes.reduce<StampPixelBox | null>(stampBoxUnion, null)!] : []));
      tau0 = known ? known.tau0 : stampSheetGrid(state.tau, (await steps.latestSetOver(earlier)) ?? state.tau);
      const region = gpu.prewetRegion(w);
      closesAtStart = known ? known.closes.start : !!wash.prewet && !!region && await setBy(tau0);
      await steps.step(`starting wash ${wash.name}`, (encoder) => {
        const at = clock.after(encoder, tau0);
        if (closesAtStart) close(encoder, tau0, 'set');
        startWash(encoder, w, at);
      });
      if (wash.prewet && region) {
        const ends = stampPaintFieldEnds(wash.prewet.water);
        state = stampSheetPrewetted(state, { wash: w, at: tau0, level: Math.max(ends.first, ends.second), box: region.box });
      }
    }
    const core = loaded.box && { box: loaded.box, fluid: gpu.fluidOf(deposit.mask), within: gpu.boundsOf(deposit, clipped).within, clipped };
    const decided = known ?? await decideStampSheetEntry(steps, {
      name, on, bloom: bloom ? waterOf(deposit) : null, core, unscheduled,
      touch: (encoder) => {
        if (loaded.box) gpu.drawing.drawTouch(encoder, deposit, loaded, loaded.box, targets.core.view);
      },
      open: (encoder) => {
        clearStampTarget(encoder, targets.open.view);
        for (const f of openFilms) {
          const box = state.painted[f];
          if (box) passes.markOpen(encoder, targets.film(f).view, gpu.layouts[f], box);
        }
      },
    }, tau0);
    costs?.count(known ? 'decisions reused' : 'decisions made');
    for (const warning of decided.warnings) costs?.warned(warning);
    const { tau } = decided;
    state = stampSheetDecided(state, tau);
    const closesAtLanding = known ? known.closes.landing : !!loaded.wash && await setBy(tau);
    const ends = lastOf[w] === k;
    await steps.step(`landing ${name}`, (encoder) => {
      const at = clock.after(encoder, tau);
      if (closesAtLanding) close(encoder, tau, 'set');
      land(encoder, k, at);
      if (!ends || !clippedTo.has(w)) return;
      const base = targets.savedClip(w);
      passes.clipBase(encoder, targets.clip.view, base.view, clipped ? 1 : 0);
      clipBases.set(w, base.view);
    });
    const wetted = state.wetted[w].reduce<StampPixelBox | null>(stampBoxUnion, null);
    const measured = !known && ends && wetted ? await steps.latestSetOver([wetted]) : null;
    const washSet = known ? known.washSet : measured;
    return { decision: { tau0, tau, closes: { start: closesAtStart, landing: closesAtLanding }, washSet, warnings: decided.warnings }, known: !!known };
  };

  return {
    steps,
    /** The solve's state now. */
    state: () => state,
    /** Ends the painting at the last τ (ENGINE 4.4): its last drying closed, then every film's open share settled. */
    finish(encoder: GPUCommandEncoder) {
      close(encoder, state.tau, 'end');
      for (const f of openFilms) {
        const box = state.painted[f];
        if (box) passes.settleAll(encoder, targets.film(f).view, gpu.layouts[f], box);
      }
    },
    /** Entries 0 to `through` solved in order, `keys` K₀ to K_`through`: each decision. */
    async entries(keys: readonly string[], through: number) {
      const list: StampSheetDecision[] = [];
      const from = async (k: number): Promise<void> => {
        if (k === through) return;
        const solved = await entry(k, keys[k + 1], program.entries.slice(k + 1, through).map(({ name }) => name));
        if (!solved.known) rememberStampSheetDecision(keys[k + 1], solved.decision);
        list.push(solved.decision);
        return from(k + 1);
      };
      await from(0);
      return list;
    },
  };
}
