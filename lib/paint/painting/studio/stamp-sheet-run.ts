// stamp-sheet-run.ts: a sheet solve's run over its loaded GPU work (ENGINE 3, 4): each entry decided against the paper
// the entries before it left (stamp-sheet-decide.ts), then landed into the wet field and its film; a drying closes
// once all since the last has set. Its state is one value the schedule's transitions move on.
//
// The clock (ENGINE 3.5): a scale maps model time to scene seconds from S at τc, the unclocked run's end; `instant`
// sets the sheet before each clocked entry; `never` dries nothing (rate 0). A scene second known exactly (an origin,
// an `at`, a predecessor's) is carried rather than mapped there and back.

import { paintPigmentSeed } from '#lib/paint/materials/models/paint-paper.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampPaintCostTally } from '../models/stamp-paint-costs.ts';
import { stampPaintFieldEnds } from '../models/stamp-paint-field.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe-compile.ts';
import {
  stampSheetAtTooEarly, stampSheetClockStarted, stampSheetClosed, stampSheetDecided, stampSheetDrawn, stampSheetGrid, stampSheetLanded, stampSheetLandingAt,
  stampSheetMaySetBy, stampSheetModelAt, stampSheetNeverSets, stampSheetPainted, stampSheetPrewetted, stampSheetRebased, stampSheetSceneAt, stampSheetSetKnown,
  stampSheetSolveStart, stampSheetStartsWet, stampSheetStateResized, type StampSheetDecision, type StampSheetMoment, type StampSheetRegime, type StampSheetSolveState,
} from '../models/stamp-sheet-schedule.ts';
import type { StampSheetProgram } from '../models/stamp-sheet-program.ts';
import { StampSheetRefusal } from '../models/stamp-sheet-refusal.ts';
import { STAMP_REST_IDENTITY } from '../models/stamp-rest-map.ts';
import { stampBoxUnion } from '../models/stamp-stage.ts';
import { stampDepositSupport } from '../models/stamp-tip-support.ts';
import { stampDryingRimCoversLanding } from '../models/stamp-wet-rim.ts';
import { stampFloodHeldWetness, type StampDrying, type StampWashDrying, type StampWetLanding } from '../models/stamp-wetness.ts';
import type { StampPaintBrushes } from './stamp-deposit-bank.ts';
import { clearStampTarget, type StampPaintDevice } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import {
  holdStampSheetCheckpoint, keepStampSheetCheckpoint, restoreStampSheetCheckpoint, stampSheetCheckpointKept, type StampSheetCheckpoint, type StampSheetPieceTarget,
} from './stamp-sheet-checkpoints.ts';
import { createStampSheetClips } from './stamp-sheet-clips.ts';
import { decideStampSheetEntry } from './stamp-sheet-decide.ts';
import type { StampSheetSolveGpu } from './stamp-sheet-load.ts';
import { createStampSheetSteps, type StampSheetTimeBase } from './stamp-sheet-steps.ts';
import { planStampWetStage, type StampWetBank, type StampWetDepositMoment, type StampWetStagePlan } from './stamp-wet-stages.ts';

/** What a run lays through its loaded GPU work, its paper drying as `drying` says: its brushes, each deposit's water, where it counts costs. */
export type StampSheetRunInput = {
  program: StampSheetProgram; gpu: StampSheetSolveGpu; drying: StampDrying; brushes: StampPaintBrushes; waterOf: (deposit: CompiledStampDeposit) => number;
  costs: StampPaintCostTally | null;
};

/**
 * What running an entry came to: its decision and whether it was remembered; whether it landed, as it doesn't past
 * its prefix's `at`; and whether its wash started, which a prefix stopping before it must undo.
 */
export type StampSheetEntryRun = { decision: StampSheetDecision; known: boolean; lands: boolean; started: boolean };

const pixelBoxMeets = (a: StampPixelBox | null, b: StampPixelBox) => !!a && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A solve's run over its loaded GPU work. */
export function stampSheetRun(owner: StampPaintGpuOwner, device: StampPaintDevice, { program, gpu, drying, brushes, waterOf, costs }: StampSheetRunInput) {
  let state: StampSheetSolveState = stampSheetSolveStart(program.films.length, program.washes.length);
  const timeBase: StampSheetTimeBase = {
    base: () => state.base,
    after: (encoder, tau) => {
      const rebased = stampSheetRebased(state, tau);
      if (rebased.shift) gpu.passes.rebase(encoder, rebased.shift);
      state = rebased.state;
      return Math.fround(tau - state.base);
    },
  };
  const steps = createStampSheetSteps(owner, device, gpu, drying, timeBase, costs);
  const { targets, passes } = gpu, { clock, washes, entries } = program;
  const clips = createStampSheetClips(program, targets, passes);
  const filmOfEntry = (k: number) => washes[entries[k].wash].film;
  const firstOf = washes.map((_, w) => entries.findIndex((entry) => entry.wash === w));
  const lastOf = washes.map((_, w) => entries.findLastIndex((entry) => entry.wash === w));
  // Films with a wet history: the only paint that's ever open, so the only paint settled, marked open or reached.
  const openFilms = program.films.flatMap(({ slots }, f) => (slots.open === null ? [] : [f]));
  const touchedBox = (w: number) => state.touched[w].reduce<StampPixelBox | null>(stampBoxUnion, null);
  /** Where wash `w`'s clip coverage can be: what it touched, and the base it started from. */
  const clipBox = (w: number): StampPixelBox | null => {
    const { clipTo } = washes[w];
    return stampBoxUnion(touchedBox(w), clipTo === null ? null : clipBox(clipTo));
  };
  const paintedInto = (film: number, box: StampPixelBox | null) => {
    state = stampSheetPainted(state, film, box);
  };

  /** The scene second entry `k` lands at if it lands at model time `tau`: `exact` when that's known, null in the unclocked run. */
  const sceneOf = (k: number, tau: number, exact: number | null): number | null => {
    const { orderTime } = entries[k];
    if (orderTime === null) return null;
    if (clock.kind !== 'scale') return orderTime;
    return exact ?? stampSheetSceneAt(clock, state.clockStart!, tau);
  };
  /** How entry `k`'s paper dries as it's decided. */
  const regimeOf = (k: number): StampSheetRegime => {
    if (clock.kind === 'never') return 'never';
    return clock.kind === 'instant' && entries[k].orderTime !== null ? 'instant' : 'drying';
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
  /** Of washes `among`, in order, the one whose touched paper sets latest (the later on a tie), and when; null for none. */
  const latestSetting = async (among: readonly number[]): Promise<{ wash: number; at: number } | null> => {
    const from = async (rest: readonly number[], found: { wash: number; at: number } | null): Promise<{ wash: number; at: number } | null> => {
      if (!rest.length) return found;
      const [wash, ...after] = rest, at = await steps.latestSetOver([touchedBox(wash)!]);
      return from(after, at !== null && (!found || at > found.at) ? { wash, at } : found);
    };
    return from(among.toReversed(), null);
  };

  /** Closes the drying of what's landed since the last at `at`: each film that painted in it rimmed, then the field's sight cleared. */
  const close = (encoder: GPUCommandEncoder, at: number, closes: StampWashDrying['closes']) => {
    const { state: next, closed } = stampSheetClosed(state, at, closes, drying);
    state = next;
    if (!closed) return;
    const id = closed.ordinal ? `sheet|dry${closed.ordinal}` : 'sheet';
    const landings = new Map(closed.since.map(({ entry, landing }) => [entries[entry].deposit, landing]));
    program.films.forEach((_, f) => {
      const own = closed.since.filter(({ entry }) => filmOfEntry(entry) === f);
      if (!own.length) return;
      const { rim } = washes[entries[own.at(-1)!.entry].wash];
      const film: StampWashDrying = { id: `${id}|film${f}`, deposits: own.map(({ entry }) => entries[entry].deposit), rim, at, closes, wettest: closed.wettest };
      const bank: StampWetBank = { device, landings, dryings: [film], boxOf: (deposit) => gpu.bank.get(deposit)?.box ?? null, wallOf: gpu.wallOf };
      targets.swap(encoder, f);
      for (const stage of gpu.stages.drying) paintedInto(f, planStampWetStage(stage, bank).encode(encoder, { drying: film, seed: paintPigmentSeed(film.id) }));
    });
    gpu.field.dried(encoder);
  };

  /** Wash `w`'s start at `at` (the GPU's time): its clip, then its prewet's water over every film's paint settled. */
  const startWash = (encoder: GPUCommandEncoder, w: number, at: number) => {
    clips.start(encoder, w);
    const { prewet } = washes[w], region = gpu.prewetRegion(w);
    if (!prewet || !region) return;
    settleUnder(encoder, region.box, at, null);
    passes.prewet(encoder, { region, fluid: gpu.fluidOf(prewet.held), water: prewet.water, rest: prewet.rest ?? STAMP_REST_IDENTITY }, at, drying);
  };

  /**
   * When wash `w`, its first entry `k`'s, can start (ENGINE 3.5), and the scene second that is when it's known
   * exactly: once its layer's earlier wet washes have set, or at its numeric origin on a scale clock, refused before
   * they have. Refused where they never will. A direct wash has no water to wait on.
   */
  const washStartAt = async (k: number, w: number): Promise<{ tau: number; exact: number | null }> => {
    const wash = washes[w], earlier = washes.flatMap(({ film, wetHistory }, v) => (v < w && film === wash.film && wetHistory && state.touched[v].length ? [v] : []));
    const set = await steps.latestSetOver(earlier.map((v) => touchedBox(v)!));
    if (set === Infinity) throw new StampSheetRefusal(stampSheetNeverSets(wash.name, washes[(await latestSetting(earlier))!.wash].name));
    if (entries[k].orderTime !== null && clock.kind === 'scale' && typeof wash.origin === 'number') {
      const from = stampSheetModelAt(clock, state.clockStart!, wash.origin);
      if (set !== null && from < set) {
        const wet = (await latestSetting(earlier))!;
        throw new StampSheetRefusal(stampSheetStartsWet(wash.name, wash.origin, washes[wet.wash].name, stampSheetSceneAt(clock, state.clockStart!, set)));
      }
      return from > state.tau ? { tau: from, exact: wash.origin } : { tau: state.tau, exact: state.scene };
    }
    const tau = stampSheetGrid(state.tau, set ?? state.tau);
    return { tau, exact: tau === state.tau ? state.scene : null };
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
    const entry = entries[k], { deposit } = entry, loaded = gpu.bank.get(deposit)!, { film, clipTo } = washes[entry.wash];
    const bounds = gpu.boundsOf(deposit, clipTo !== null), draw = { paintAt: 0, tooth: gpu.tooth, bounds, trace: null };
    if (!loaded.wash) {
      targets.swap(encoder, film);
      paintedInto(film, gpu.drawing.drawDeposit(encoder, deposit, loaded, { ...draw, wet: null }));
      state = stampSheetDrawn(state, entry.wash, loaded.box);
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

  /**
   * When all wash `w` touched has set, measured as its last entry `k`, scene second and all: null for a wash with no
   * water of its own, or none under it, or a sheet that never dries; under `instant`, its last landing's second.
   */
  const washSetAt = async (k: number, w: number): Promise<StampSheetMoment | null> => {
    const box = touchedBox(w);
    if (!washes[w].wetHistory || !box) return null;
    const tau = await steps.latestSetOver([box]);
    if (tau === null || tau === Infinity) return null;
    if (clock.kind === 'instant') return { tau, scene: state.scene };
    return { tau, scene: clock.kind === 'scale' && entries[k].orderTime !== null ? stampSheetSceneAt(clock, state.clockStart!, tau) : null };
  };

  /**
   * Entry `k` decided (or `known`, remembered) and landed, unless its prefix ends at scene second `at` (null for no
   * end) before it; `unscheduled`, the names after it for a failure's message.
   */
  const entry = async (k: number, known: StampSheetDecision | null, unscheduled: readonly string[], at: number | null): Promise<StampSheetEntryRun> => {
    const { wash: w, name, on, bloom, deposit, orderTime } = entries[k], wash = washes[w], loaded = gpu.bank.get(deposit)!, clipped = wash.clipTo !== null;
    const past = (scene: number | null) => at !== null && scene !== null && scene > at;
    if (known && past(known.scene)) return { decision: known, known: true, lands: false, started: false };
    if (orderTime !== null && state.clockStart === null) state = stampSheetClockStarted(state, clock.kind === 'scale' ? clock.origin : null);
    let tau0 = state.tau, exact = state.scene, start: StampSheetMoment | null = null, closesAtStart = false;
    if (firstOf[w] === k) {
      ({ tau: tau0, exact } = known ? { tau: known.start!.tau, exact: known.start!.scene } : await washStartAt(k, w));
      start = { tau: tau0, scene: sceneOf(k, tau0, exact) };
      const region = gpu.prewetRegion(w);
      closesAtStart = known ? known.closes.start : !!wash.prewet && !!region && await setBy(tau0);
      await steps.step(`starting wash ${wash.name}`, (encoder) => {
        const gpuTau = timeBase.after(encoder, tau0);
        if (closesAtStart) close(encoder, tau0, 'set');
        startWash(encoder, w, gpuTau);
      });
      if (wash.prewet && region) {
        const ends = stampPaintFieldEnds(wash.prewet.water);
        state = stampSheetPrewetted(state, { wash: w, at: tau0, level: Math.max(ends.first, ends.second), box: region.box });
      }
    } else if (clips.away(w)) await steps.step(`returning to wash ${wash.name}`, (encoder) => clips.enter(encoder, w));
    const regime = regimeOf(k), fixed = entries[k].at !== null && clock.kind === 'scale' ? entries[k].at : null;
    if (known) tau0 = known.tau0;
    else {
      // `instant` sets the sheet before each clocked entry; a fixed `at` on a scale clock is its model time.
      const setAt = regime === 'instant' && state.field ? await steps.latestSetOver([state.field]) : null;
      if (setAt !== null && setAt > tau0) ({ tau: tau0, exact } = { tau: stampSheetGrid(tau0, setAt), exact: null });
      if (fixed !== null && clock.kind === 'scale') {
        const fixedTau = stampSheetModelAt(clock, state.clockStart!, fixed);
        if (fixedTau < tau0) throw new StampSheetRefusal(stampSheetAtTooEarly(name, fixed, sceneOf(k, tau0, exact)!));
        ({ tau: tau0, exact } = { tau: fixedTau, exact: fixed });
      }
    }
    const core = loaded.box && { box: loaded.box, fluid: gpu.fluidOf(deposit.mask), within: gpu.boundsOf(deposit, clipped).within, clipped };
    const decided = known ?? await decideStampSheetEntry(steps, {
      name, on, bloom: bloom ? waterOf(deposit) : null, core, unscheduled, regime, fixed,
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
    const { tau } = decided, scene = known ? known.scene : sceneOf(k, tau, tau === tau0 ? exact : null);
    costs?.count(known ? 'decisions reused' : 'decisions made');
    if (past(scene)) {
      const decision = { start, tau0, tau, scene, closes: { start: closesAtStart, landing: false }, washSet: null, warnings: decided.warnings };
      return { decision, known: false, lands: false, started: start !== null };
    }
    for (const warning of decided.warnings) costs?.warned(warning);
    state = stampSheetDecided(state, { tau, scene });
    const closesAtLanding = known ? known.closes.landing : await setBy(tau);
    await steps.step(`landing ${name}`, (encoder) => {
      const gpuTau = timeBase.after(encoder, tau);
      if (closesAtLanding) close(encoder, tau, 'set');
      land(encoder, k, gpuTau);
      if (lastOf[w] === k) clips.end(encoder, w);
    });
    let washSet = known ? known.washSet : null;
    if (!known && lastOf[w] === k) washSet = await washSetAt(k, w);
    const decision = { start, tau0, tau, scene, closes: { start: closesAtStart, landing: closesAtLanding }, washSet, warnings: decided.warnings };
    return { decision, known: !!known, lands: true, started: start !== null };
  };

  /** A checkpoint after `k` entries, keyed `key`, by name: its clips told apart, as another program's may differ. */
  const checkpointKey = (key: string, k: number) => `${key}|clips ${clips.keptName(k)}`;
  /** Where a checkpoint's piece goes back to. */
  const pieceTexture = (target: StampSheetPieceTarget): GPUTexture => {
    if (target.kind === 'film') return targets.film(target.film).texture;
    if (target.kind === 'clip') return clips.textureOf(target.clip);
    return target.kind === 'paper' ? targets.paper.texture : targets.rim.texture;
  };

  return {
    steps,
    entry,
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
    /** Whether a checkpoint is kept after `k` entries, keyed `key`. */
    kept: (key: string, k: number) => stampSheetCheckpointKept(owner, checkpointKey(key, k)),
    /** Holds the checkpoint after `k` entries, keyed `key`, from eviction until the returned release runs; null for none. */
    hold: (key: string, k: number) => holdStampSheetCheckpoint(owner, checkpointKey(key, k)),
    /** Keeps the state after `k` entries, keyed `key`, with `decisions`, theirs. */
    keep(encoder: GPUCommandEncoder, key: string, k: number, decisions: readonly StampSheetDecision[]) {
      targets.putBack(encoder);
      const kept = clips.kept(k);
      keepStampSheetCheckpoint(owner, encoder, checkpointKey(key, k), [
        ...program.films.map((_, film) => ({ target: { kind: 'film', film } as const, texture: targets.film(film).texture, box: state.painted[film] })),
        { target: { kind: 'paper' }, texture: targets.paper.texture, box: state.field }, { target: { kind: 'rim' }, texture: targets.rim.texture, box: state.field },
        ...kept.map((clip) => ({ target: { kind: 'clip', clip } as const, texture: clips.textureOf(clip), box: clipBox(clip.wash) })),
      ], { state, decisions: [...decisions], clips: kept });
    },
    /** The state the checkpoint after `k` entries, keyed `key`, kept; null when none is, the run at its start. */
    restore(encoder: GPUCommandEncoder, key: string, k: number): StampSheetCheckpoint | null {
      gpu.restart(encoder);
      state = stampSheetSolveStart(program.films.length, washes.length);
      clips.restored(encoder, 0, []);
      const restored = restoreStampSheetCheckpoint(owner, encoder, checkpointKey(key, k), (checkpoint) => {
        clips.restored(encoder, k, checkpoint.clips);
        return pieceTexture;
      });
      if (restored) state = stampSheetStateResized(restored.state, program.films.length, washes.length);
      return restored;
    },
    /** The run back at its start: clean films and dry paper. */
    restart(encoder: GPUCommandEncoder) {
      gpu.restart(encoder);
      state = stampSheetSolveStart(program.films.length, washes.length);
      clips.restored(encoder, 0, []);
    },
  };
}

export type StampSheetRun = ReturnType<typeof stampSheetRun>;
