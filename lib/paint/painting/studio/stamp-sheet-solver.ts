// stamp-sheet-solver.ts: a sheet program solved forward (ENGINE 3, 4): each application in order, its time decided
// against the paper the ones before it left (stamp-sheet-decide.ts), then landed into the wet field and its film, its
// water reaching every other film's paint by a proxy; a drying closes once all since the last has set, rimming each
// film that painted in it.
//
// Keys chain from the head through each entry as posed (ENGINE 4.2). A decision is remembered under the key after its
// entry, so a later solve through that prefix reads nothing back for it, though it paints it again: no film is kept
// partway. The films a solve ends with are kept under its last key (stamp-sheet-films.ts).

import { paintPigmentSeed } from '#lib/paint/materials/models/paint-paper.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import { stampPaintFieldEnds } from '../models/stamp-paint-field.ts';
import { stampBrushedMasksUnder } from '../models/stamp-brushed-mask.ts';
import type { CompiledStampDeposit, CompiledStampMask } from '../models/stamp-paint-recipe-compile.ts';
import type { StampBox } from '../models/stamp-region.ts';
import { stampSheetGrid, type StampSheetDecision } from '../models/stamp-sheet-schedule.ts';
import {
  stampSheetChainOffset, stampSheetDepositPosed, stampSheetMixedPainting, stampSheetPrewetPosed, type StampSheetPose, type StampSheetPoses, type StampSheetPrewet,
  type StampSheetProgram,
} from '../models/stamp-sheet-program.ts';
import { stampSheetEntryKey, stampSheetHeadKey } from '../models/stamp-sheet-state-key.ts';
import { stampBoxUnion } from '../models/stamp-stage.ts';
import { stampDepositSupport } from '../models/stamp-tip-support.ts';
import { createStampWashLedger, type StampWashLedger } from '../models/stamp-wash-ledger.ts';
import { stampDryingRimCoversLanding } from '../models/stamp-wet-rim.ts';
import { stampDrying, type StampDrying, type StampWashDrying, type StampWetLanding } from '../models/stamp-wetness.ts';
import { bindStampPaintBrushes } from './stamp-deposit-bank.ts';
import { stampPaintCompositorFor } from './stamp-paint-compositor-for.ts';
import { clearStampTarget, type StampPaintDevice } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { decideStampSheetEntry } from './stamp-sheet-decide.ts';
import { keepStampSheetFilms, type StampSheetFilmKept } from './stamp-sheet-films.ts';
import { loadStampSheetSolve, type StampSheetSolveGpu } from './stamp-sheet-load.ts';
import { createStampSheetSteps } from './stamp-sheet-steps.ts';
import { withStampSolveLease } from './stamp-solve-lease.ts';
import { planStampWetStage, type StampWetBank, type StampWetDepositMoment, type StampWetStagePlan } from './stamp-wet-stages.ts';

export type StampSheetSolveOptions = {
  /** Groups' poses, a still translation each; every group at rest when left out. */
  poses?: StampSheetPoses;
  /** How many entries are solved, from the first: all of them when left out. */
  through?: number;
  /** Whether the painting ends after them, its last drying closed: when they're all of it, unless said. */
  finish?: boolean;
};

/**
 * A solve: its last key (Kₖ after the entries solved), how many it solved and whether the painting ended there, the
 * films it kept, each entry's decision, and how many readbacks it took and decisions it remembered.
 */
export type StampSheetSolved = {
  key: string; through: number; finished: boolean; films: readonly StampSheetFilmKept[]; decisions: readonly StampSheetDecision[];
  stats: { readbacks: number; remembered: number };
};

/** How many decisions are remembered, the oldest forgotten first. */
const STAMP_SHEET_REMEMBERED = 65536;
const remembered = new Map<string, StampSheetDecision>();

function rememberStampSheetDecision(key: string, decision: StampSheetDecision) {
  remembered.set(key, decision);
  if (remembered.size > STAMP_SHEET_REMEMBERED) remembered.delete(remembered.keys().next().value!);
}

/** `program` solved on `owner`'s device as `options` say, once every solve asked for before it has finished. */
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

/** K₀ to K_`through` for `program`'s entries posed by `offsets`: each entry's datum and its pose. */
async function stampSheetKeys(program: StampSheetProgram, offsets: readonly StampSheetPose[], through: number): Promise<string[]> {
  const chain = async (keys: string[]): Promise<string[]> => {
    const k = keys.length - 1;
    if (k === through) return keys;
    return chain([...keys, await stampSheetEntryKey(keys[k], `${program.entries[k].datum}|${offsets[k].x},${offsets[k].y}`)]);
  };
  return chain([await stampSheetHeadKey(program.head)]);
}

const pixelBoxMeets = (a: StampPixelBox | null, b: StampPixelBox) => !!a && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const ledgerBox = ({ x, y, w, h }: StampPixelBox): StampBox => ({ x0: x, y0: y, x1: x + w, y1: y + h });

async function solveLeased(owner: StampPaintGpuOwner, program: StampSheetProgram, { poses = new Map(), through = program.entries.length, finish }: StampSheetSolveOptions): Promise<StampSheetSolved> {
  checkStampSheetWashRuns(program);
  if (!(Number.isInteger(through) && through >= 0 && through <= program.entries.length)) throw new Error(`stamp sheet: a solve goes through 0 to ${program.entries.length} entries, not ${through}`);
  const moved = new Map<CompiledStampMask, CompiledStampMask>();
  const offsets = program.entries.map(({ chain }) => stampSheetChainOffset(chain, poses));
  const posed = program.entries.map((entry, k) => stampSheetDepositPosed(entry, offsets[k], moved));
  const firstOf = program.washes.map((_, w) => program.entries.findIndex((entry) => entry.wash === w));
  const prewets = program.washes.map((wash, w) => wash.prewet && stampSheetPrewetPosed(wash.prewet, offsets[firstOf[w]], moved));
  const keys = await stampSheetKeys(program, offsets, through);
  const choice = stampPaintCompositorFor(stampSheetMixedPainting(program, posed));
  if (!choice.wet) throw new Error('stamp sheet: a sheet solve paints in pigment, its films each in a medium');
  const brushedMasks = stampBrushedMasksUnder([...posed.map(({ mask }) => mask), ...prewets.map((prewet) => prewet?.held)]);
  const brushes = await bindStampPaintBrushes(owner, { deposits: posed, marks: brushedMasks.flatMap(({ marks }) => marks), paper: program.paper });
  const scope = owner.scope();
  try {
    const gpu = await owner.checked('loading a sheet solve', () => loadStampSheetSolve(scope.device, {
      program, posed, prewets, compositor: choice.compositorOn(scope.device), media: choice.media, brushes, brushedMasks,
    }));
    const indexOf = new Map(posed.map((deposit, k) => [deposit, k]));
    const mediumOf = (deposit: CompiledStampDeposit) => program.entries[indexOf.get(deposit)!].medium;
    const drying = stampDrying(program.water.wetting, program.paper);
    const ledger = createStampWashLedger({
      id: 'sheet', mediumOf, drying, preparation: null, waterOf: choice.media.waterOf,
      supportOf: (deposit) => stampDepositSupport(deposit, brushes.tipsOf(deposit)), reachOf: (deposit, water) => gpu.wetReach(deposit, mediumOf(deposit), water),
    });
    const run = stampSheetRun(owner, scope.device, { program, posed, prewets, gpu, drying, ledger, indexOf, waterOf: choice.media.waterOf });
    const decisions = await run.entries(keys, through);
    const films = await run.steps.step('keeping the films', (encoder) => {
      if (finish ?? through === program.entries.length) run.close(encoder, run.now(), 'end');
      gpu.targets.putBack(encoder);
      const kept = program.films.map((_, f) => ({ texture: gpu.targets.film(f).texture, box: run.painted[f] }));
      return keepStampSheetFilms(owner, encoder, `${keys[through]}|${(finish ?? through === program.entries.length) ? 'finished' : 'open'}`, kept);
    });
    return {
      key: keys[through], through, finished: finish ?? through === program.entries.length, films, decisions: decisions.list,
      stats: { readbacks: run.steps.stats.readbacks, remembered: decisions.remembered },
    };
  } finally {
    scope.destroy();
  }
}

/**
 * What a run lays, posed, through its loaded GPU work, its paper drying as `drying` says, `ledger` keeping its water:
 * each entry's deposit by its index in `indexOf`, and the water each carries.
 */
type StampSheetRunInput = {
  program: StampSheetProgram; posed: readonly CompiledStampDeposit[]; prewets: readonly (StampSheetPrewet | null)[]; gpu: StampSheetSolveGpu; drying: StampDrying;
  ledger: StampWashLedger; indexOf: ReadonlyMap<CompiledStampDeposit, number>; waterOf: (deposit: CompiledStampDeposit) => number;
};

/** A solve's run over its loaded GPU work: its films' painted boxes, what's landed since the last drying, its clip bases. */
function stampSheetRun(owner: StampPaintGpuOwner, device: StampPaintDevice, { program, posed, prewets, gpu, drying, ledger, indexOf, waterOf }: StampSheetRunInput) {
  const steps = createStampSheetSteps(owner, device, gpu, drying);
  const { targets, passes } = gpu;
  const painted: (StampPixelBox | null)[] = program.films.map(() => null);
  const touched: StampPixelBox[][] = program.washes.map(() => []);
  const clipBases = new Map<number, GPUTextureView>(), clippedTo = new Set(program.washes.map(({ clipTo }) => clipTo));
  let tau = 0, since: StampPixelBox | null = null, landedSince = false, knownSetAt = -Infinity;
  const paintedInto = (film: number, box: StampPixelBox | null) => {
    painted[film] = stampBoxUnion(painted[film], box);
  };
  /** Each film but `except` painted over `box`, settled where the paper has, before water lands there at `at`. */
  const settleUnder = (encoder: GPUCommandEncoder, box: StampPixelBox, at: number, except: number | null) => {
    program.films.forEach((_, f) => {
      if (f !== except && pixelBoxMeets(painted[f], box)) passes.settle(encoder, targets.film(f).view, gpu.layouts[f]!, box, at, drying);
    });
  };
  /** Whether everything landed since the last drying has set by `at`: read back only once it could have. */
  const setBy = async (at: number) => {
    if (!landedSince || at < knownSetAt) return false;
    knownSetAt = (await steps.latestSetOver(since ? [since] : [])) ?? -Infinity;
    return at >= knownSetAt;
  };

  /** Closes the drying of what's landed since the last at `at`: each film that painted in it rimmed, then the field's sight cleared. */
  const close = (encoder: GPUCommandEncoder, at: number, closes: StampWashDrying['closes']) => {
    const before = ledger.dryings.length;
    ledger.dry(at, closes, 0);
    since = null;
    landedSince = false;
    knownSetAt = -Infinity;
    if (ledger.dryings.length === before) return;
    const closed = ledger.dryings.at(-1)!;
    program.films.forEach((_, f) => {
      const own = closed.deposits.filter((deposit) => program.washes[program.entries[indexOf.get(deposit)!].wash].film === f);
      if (!own.length) return;
      const rim = program.washes[program.entries[indexOf.get(own.at(-1)!)!].wash].rim;
      const film: StampWashDrying = { ...closed, id: `${closed.id}|film${f}`, deposits: own, rim };
      const bank: StampWetBank = { device, landings: ledger.landings, dryings: [film], boxOf: (deposit) => gpu.bank.get(deposit)?.box ?? null, wallOf: gpu.wallOf };
      targets.swap(encoder, f);
      for (const stage of gpu.stages.drying) paintedInto(f, planStampWetStage(stage, bank).encode(encoder, { drying: film, seed: paintPigmentSeed(film.id) }));
    });
    gpu.field.dried(encoder);
  };

  /** Wash `w`'s start at `at` (the GPU's time): its clip base, then its prewet's water over every film's paint settled. */
  const startWash = (encoder: GPUCommandEncoder, w: number, at: number) => {
    const { clipTo } = program.washes[w];
    if (clipTo === null) clearStampTarget(encoder, targets.clip.view);
    else passes.clipBase(encoder, clipBases.get(clipTo)!, targets.clip.view, 0);
    const prewet = prewets[w], region = gpu.prewetRegion(w);
    if (!prewet || !region) return;
    settleUnder(encoder, region.box, at, null);
    passes.prewet(encoder, { region, fluid: gpu.fluidOf(prewet.held), water: prewet.water }, at, drying);
  };

  /**
   * A plan carrying `deposit`'s water into every other film's paint it meets in `box`: its deposit stages run again
   * for a proxy of it in each, a water of its own, with that film swapped in. Null for no such paint.
   */
  const reachInto = (deposit: CompiledStampDeposit, film: number, landing: StampWetLanding, box: StampPixelBox): StampWetStagePlan<StampWetDepositMoment> | null => {
    const proxies = program.films.flatMap(({ medium }, other) => {
      if (other === film || !pixelBoxMeets(painted[other], box)) return [];
      const proxy: CompiledStampDeposit = { ...deposit, id: `${deposit.id}|film${other}`, action: { kind: 'water', water: landing.water } };
      gpu.filmOf.set(proxy, other);
      const found = { ...landing, medium };
      const bank: StampWetBank = { device, landings: new Map([[proxy, found]]), dryings: [], boxOf: () => box, wallOf: () => gpu.wallOf(deposit) };
      return [{ other, proxy, found, plans: gpu.stages.deposit.map((stage) => planStampWetStage(stage, bank)) }];
    });
    const reaches = proxies.flatMap(({ proxy, plans }) => plans.map((plan) => plan.landingReach?.(proxy) ?? null).filter((reach) => reach !== null));
    if (!proxies.length) return null;
    return {
      extent: null,
      encode: (encoder, moment) => {
        for (const { other, proxy, found, plans } of proxies) {
          targets.swap(encoder, other);
          for (const plan of plans) paintedInto(other, plan.encode(encoder, { ...moment, deposit: proxy, landing: found, seed: paintPigmentSeed(proxy.id) }));
        }
        return null;
      },
      landingReach: (asked) => (asked === deposit && reaches.length ? Math.max(...reaches) : null),
    };
  };

  /** Lands entry `k` at `at` (the GPU's time for `tau`): drawn into its film, by the wash law when it's laid by one. */
  const land = (encoder: GPUCommandEncoder, k: number, at: number) => {
    const entry = program.entries[k], deposit = posed[k], loaded = gpu.bank.get(deposit)!, { film, clipTo } = program.washes[entry.wash];
    const bounds = gpu.boundsOf(deposit, clipTo !== null), draw = { paintAt: 0, tooth: gpu.tooth, bounds, trace: null };
    if (!loaded.wash) {
      targets.swap(encoder, film);
      paintedInto(film, gpu.drawing.drawDeposit(encoder, deposit, loaded, { ...draw, wet: null }));
      return;
    }
    const landing = ledger.land(deposit, tau), { box } = loaded;
    const found: StampWetLanding = { ...landing, tau: at };
    if (box) settleUnder(encoder, box, at, film);
    targets.swap(encoder, film);
    const bank: StampWetBank = { device, landings: new Map([[deposit, found]]), dryings: [], boxOf: () => box, wallOf: gpu.wallOf };
    const own = gpu.stages.deposit.map((stage) => planStampWetStage(stage, bank));
    const reached = box && found.water > 0 && deposit.action.kind !== 'lift' ? reachInto(deposit, film, found, box) : null;
    const wet = { landing: found, plans: { deposit: reached ? [...own, reached] : own, drying: [] }, seed: paintPigmentSeed(deposit.id), rimmed: stampDryingRimCoversLanding(deposit, landing) };
    paintedInto(film, gpu.drawing.drawDeposit(encoder, deposit, loaded, { ...draw, wet }));
    if (!box) return;
    since = stampBoxUnion(since, box);
    landedSince = true;
    touched[entry.wash].push(box);
  };

  /** Entry `k` decided (or remembered under `key`, the key after it) and landed. */
  const entry = async (k: number, key: string, unscheduled: readonly string[]): Promise<{ decision: StampSheetDecision; known: boolean }> => {
    const { wash: w, name, on, bloom } = program.entries[k], wash = program.washes[w], deposit = posed[k], loaded = gpu.bank.get(deposit)!;
    const known = remembered.get(key) ?? null, starts = program.entries.findIndex((other) => other.wash === w) === k;
    let tau0 = tau, closesAtStart = false;
    if (starts) {
      // A wash meets its film's earlier washes set.
      const earlier = touched.flatMap((boxes, v) => (v < w && program.washes[v].film === wash.film && boxes.length ? [boxes.reduce<StampPixelBox | null>(stampBoxUnion, null)!] : []));
      tau0 = known ? known.tau0 : stampSheetGrid(tau, (await steps.latestSetOver(earlier)) ?? tau);
      const wets = !!prewets[w] && !!gpu.prewetRegion(w);
      closesAtStart = known ? known.closes.start : wets && await setBy(tau0);
      await steps.step(`starting wash ${wash.name}`, (encoder) => {
        const at = steps.after(encoder, tau0);
        if (closesAtStart) close(encoder, tau0, 'set');
        startWash(encoder, w, at);
      });
      const prewet = prewets[w], region = gpu.prewetRegion(w);
      if (prewet && region) {
        const ends = stampPaintFieldEnds(prewet.water);
        ledger.wet({ at: tau0, level: Math.max(ends.first, ends.second), box: ledgerBox(region.box) });
        since = stampBoxUnion(since, region.box);
        touched[w].push(region.box);
      }
    }
    const core = loaded.box && { box: loaded.box, fluid: gpu.fluidOf(deposit.mask), within: gpu.boundsOf(deposit, wash.clipTo !== null).within, clipped: wash.clipTo !== null };
    const decided = known ?? await decideStampSheetEntry(steps, {
      name, on, bloom: bloom ? waterOf(deposit) : null, core, unscheduled,
      touch: (encoder) => {
        if (loaded.box) gpu.drawing.drawTouch(encoder, deposit, loaded, loaded.box);
      },
      open: (encoder) => {
        clearStampTarget(encoder, targets.open.view);
        painted.forEach((box, f) => {
          if (box) passes.markOpen(encoder, targets.film(f).view, gpu.layouts[f]!, box);
        });
      },
    }, tau0);
    tau = decided.tau;
    const closesAtLanding = known ? known.closes.landing : !!loaded.wash && await setBy(tau);
    const ends = program.entries.findLastIndex((other) => other.wash === w) === k;
    await steps.step(`landing ${name}`, (encoder) => {
      const at = steps.after(encoder, tau);
      if (closesAtLanding) close(encoder, tau, 'set');
      land(encoder, k, at);
      if (!ends || !clippedTo.has(w)) return;
      const base = targets.savedClip();
      passes.clipBase(encoder, targets.clip.view, base.view, wash.clipTo === null ? 0 : 1);
      clipBases.set(w, base.view);
    });
    const wetted = touched[w].reduce<StampPixelBox | null>(stampBoxUnion, null);
    const measured = !known && ends && wetted ? await steps.latestSetOver([wetted]) : null;
    const washSet = known ? known.washSet : measured;
    return { decision: { tau0, tau, closes: { start: closesAtStart, landing: closesAtLanding }, washSet, warnings: decided.warnings }, known: !!known };
  };

  return {
    steps, painted, close,
    /** The time the last entry landed, model s. */
    now: () => tau,
    /** Entries 0 to `through` solved in order, `keys` K₀ to K_`through`; each decision, and how many were remembered. */
    async entries(keys: readonly string[], through: number) {
      const list: StampSheetDecision[] = [];
      let known = 0;
      const from = async (k: number): Promise<void> => {
        if (k === through) return;
        const solved = await entry(k, keys[k + 1], program.entries.slice(k + 1, through).map(({ name }) => name));
        if (solved.known) known++;
        else rememberStampSheetDecision(keys[k + 1], solved.decision);
        list.push(solved.decision);
        return from(k + 1);
      };
      await from(0);
      return { list, remembered: known };
    },
  };
}
