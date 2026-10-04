// stamp-sheet-run.ts: a sheet solve's run over its loaded GPU work (ENGINE 3, 4): each entry decided against the paper
// the entries before it left (stamp-sheet-decide.ts), then landed into the wet field and its film; a drying closes
// once all since the last has set. Its state is one value the schedule's transitions move on.
//
// The clock's policy is the schedule's (models/stamp-sheet-schedule.ts); the run reads back what it needs and lays
// the work. A decision is made in parts, its wash's start and its landing, and a remembered one is replayed through
// the same parts, so deciding and replaying land alike. A run asked for damp windows reads them after a landing
// (stamp-sheet-damp-report.ts).

import { paintPigmentSeed } from '#lib/paint/materials/models/paint-paper.ts';
import type { StampPixelBox } from '../models/stamp-blur-region.ts';
import type { StampPaintCostTally } from '../models/stamp-paint-costs.ts';
import { stampPaintFieldEnds } from '../models/stamp-paint-field.ts';
import type { CompiledStampDeposit } from '../models/stamp-paint-recipe-compile.ts';
import {
  stampSheetBegunOf, stampSheetClockStarted, stampSheetClosed, stampSheetDecided, stampSheetDecisionOf, stampSheetDrawn, stampSheetEntryFrom, stampSheetLanded,
  stampSheetLandingAt, stampSheetLandingOf, stampSheetMaySetBy, stampSheetMomentAfter, stampSheetNeverSets, stampSheetPainted, stampSheetPrewetted, stampSheetRebased,
  stampSheetRegimeOf, stampSheetSceneOf, stampSheetSetKnown, stampSheetSolveStart, stampSheetStartsWet, stampSheetStateResized, stampSheetWashStart,
  type StampSheetBegun, type StampSheetDecision, type StampSheetLandingDecided, type StampSheetMoment, type StampSheetSolveState,
} from '../models/stamp-sheet-schedule.ts';
import { stampSheetWashSpans, type StampSheetProgram } from '../models/stamp-sheet-program.ts';
import { StampSheetRefusal } from '../models/stamp-sheet-refusal.ts';
import { STAMP_REST_IDENTITY } from '../models/stamp-rest-map.ts';
import { STAMP_WRAP_FROM_NONE, stampBoxUnion, stampStageTexelsOf } from '../models/stamp-stage.ts';
import { stampDepositSupport } from '../models/stamp-tip-support.ts';
import { stampDryingRimCoversLanding } from '../models/stamp-wet-rim.ts';
import { stampFloodHeldWetness, type StampDrying, type StampWashDrying, type StampWetLanding } from '../models/stamp-wetness.ts';
import type { StampPaintBrushes } from './stamp-deposit-bank.ts';
import { clearStampTarget, type StampPaintDevice } from './stamp-paint-gpu.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { holdStampSheetCheckpoint, keepStampSheetCheckpoint, restoreStampSheetCheckpoint, stampSheetCheckpointKept, type StampSheetPieceTarget } from './stamp-sheet-checkpoints.ts';
import { createStampSheetClips } from './stamp-sheet-clips.ts';
import { createStampSheetDampReport } from './stamp-sheet-damp-report.ts';
import { decideStampSheetEntry } from './stamp-sheet-decide.ts';
import type { StampSheetSolveGpu } from './stamp-sheet-load.ts';
import type { StampSheetCore } from './stamp-sheet-reductions.ts';
import { createStampSheetSteps, type StampSheetPrepare, type StampSheetTimeBase } from './stamp-sheet-steps.ts';
import { planStampWetStage, type StampWetBank, type StampWetDepositMoment, type StampWetStagePlan } from './stamp-wet-stages.ts';

/**
 * What a run lays through its loaded GPU work, its paper drying as `drying` says: its brushes, each deposit's water,
 * where it counts costs; `keys`, K₀ onwards as far as it may run, naming its checkpoints; whether it reads damp windows.
 */
export type StampSheetRunInput = {
  program: StampSheetProgram; keys: readonly string[]; gpu: StampSheetSolveGpu; drying: StampDrying; brushes: StampPaintBrushes;
  waterOf: (deposit: CompiledStampDeposit) => number; costs: StampPaintCostTally | null; dampWindows: boolean;
};

/**
 * What running an entry came to: landed, its decision and whether it's remembered as it is (damp windows added to a
 * remembered one aren't); or not, past its prefix's `at`, the scene second it was decided at and whether its wash
 * started, which a prefix stopping before it must undo.
 */
export type StampSheetEntryRun = { lands: true; decision: StampSheetDecision; known: boolean } | { lands: false; scene: number; known: boolean; started: boolean };

const pixelBoxMeets = (a: StampPixelBox | null, b: StampPixelBox) => !!a && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** A solve's run over its loaded GPU work. */
export function stampSheetRun(owner: StampPaintGpuOwner, device: StampPaintDevice, { program, keys, gpu, drying, brushes, waterOf, costs, dampWindows }: StampSheetRunInput) {
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
  const spans = stampSheetWashSpans(program);
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

  /**
   * When wash `w`, its first entry `k`'s, starts (ENGINE 3.5), and whether a drying closes there, its prewet landing
   * once all since the last has set. Refused where it can't start: its layer's earlier wet washes still wet past its
   * origin, or never setting.
   */
  const decideWashStart = async (k: number, w: number): Promise<StampSheetBegun> => {
    const wash = washes[w], clocked = entries[k].orderTime !== null;
    const earlier = washes.flatMap(({ film, wetHistory }, v) => (v < w && film === wash.film && wetHistory && state.touched[v].length ? [v] : []));
    const wettest = async () => washes[(await latestSetting(earlier))!.wash].name;
    const starts = stampSheetWashStart(clock, state, wash, clocked, await steps.latestSetOver(earlier.map((v) => touchedBox(v)!)));
    if (starts.kind === 'never-sets') throw new StampSheetRefusal(stampSheetNeverSets(wash.name, await wettest()));
    if (starts.kind === 'still-wet') throw new StampSheetRefusal(stampSheetStartsWet(wash.name, starts.origin, await wettest(), starts.until));
    const { tau } = starts.at;
    return { start: { tau, scene: stampSheetSceneOf(clock, state, entries[k].orderTime, starts.at) }, closes: !!wash.prewet && !!gpu.prewetRegion(w) && await setBy(tau) };
  };

  /** Wash `w` started as `begun` says: the drying closed first if it closes, then its clip, then its prewet's water over every film's paint settled. */
  const beginWash = async (w: number, { start, closes }: StampSheetBegun) => {
    const { prewet, name } = washes[w], region = gpu.prewetRegion(w);
    await steps.step(`starting wash ${name}`, (encoder) => {
      const at = timeBase.after(encoder, start.tau);
      if (closes) close(encoder, start.tau, 'set');
      clips.start(encoder, w);
      if (!prewet || !region) return;
      settleUnder(encoder, stampStageTexelsOf(gpu.stage, region.box), at, null);
      passes.prewet(encoder, { region, fluid: gpu.fluidOf(prewet.held), water: prewet.water, rest: prewet.rest ?? STAMP_REST_IDENTITY, wrapFrom: prewet.wrapFrom ?? STAMP_WRAP_FROM_NONE }, at, drying);
    });
    if (!prewet || !region) return;
    const ends = stampPaintFieldEnds(prewet.water);
    state = stampSheetPrewetted(state, { wash: w, at: start.tau, level: Math.max(ends.first, ends.second), box: stampStageTexelsOf(gpu.stage, region.box) });
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

  /** When all wash `w` touched has set, measured at its last entry `k`: null for a wash with no water of its own, or none under it, or a sheet that never dries. */
  const washSetAt = async (k: number, w: number): Promise<StampSheetMoment | null> => {
    const box = touchedBox(w);
    if (!washes[w].wetHistory || !box) return null;
    const tau = await steps.latestSetOver([box]);
    return tau === null || tau === Infinity ? null : stampSheetMomentAfter(clock, state, entries[k].orderTime !== null, tau);
  };

  /** Entry `k`'s core, as its decision and its damp report read it: null wholly off the stage. */
  const coreOf = (k: number): StampSheetCore | null => {
    const { deposit, wash } = entries[k], { box } = gpu.bank.get(deposit)!, clipped = washes[wash].clipTo !== null;
    return box && { box, fluid: gpu.fluidOf(deposit.mask), within: gpu.boundsOf(deposit, clipped).within, clipped, prewet: null };
  };
  /** Lays entry `k`'s touch into the core target. */
  const touchOf = (k: number): StampSheetPrepare => (encoder) => {
    const { deposit } = entries[k], loaded = gpu.bank.get(deposit)!;
    if (loaded.box) gpu.drawing.drawTouch(encoder, deposit, loaded, loaded.box, targets.core.view);
  };
  const dampReport = dampWindows ? createStampSheetDampReport({ program, gpu, steps, coreOf, touchOf }) : null;

  /**
   * When entry `k` lands from `from` (its wash's start, or its predecessor's landing), decided over its core, and
   * whether a drying closes as it does: none for one landing `past` its prefix. Refused where it can't land.
   */
  const decideLanding = async (k: number, from: StampSheetMoment, unscheduled: readonly string[], past: (scene: number | null) => boolean): Promise<StampSheetLandingDecided> => {
    const entry = entries[k], { name, on, bloom, deposit, orderTime } = entry;
    const regime = stampSheetRegimeOf(clock, orderTime);
    // Only `instant` reads when the whole sheet sets: it sets before each clocked entry.
    const fieldSet = regime === 'instant' && state.field ? await steps.latestSetOver([state.field]) : null;
    const tau0 = stampSheetEntryFrom(clock, state, entry, { tau: from.tau, exact: from.scene }, fieldSet);
    const { tau, warnings } = await decideStampSheetEntry(steps, {
      name, on, bloom: bloom ? waterOf(deposit) : null, core: coreOf(k), unscheduled, regime, fixed: clock.kind === 'scale' ? entry.at : null, touch: touchOf(k),
      open: (encoder) => {
        clearStampTarget(encoder, targets.open.view);
        for (const f of openFilms) {
          const box = state.painted[f];
          if (box) passes.markOpen(encoder, targets.film(f).view, gpu.layouts[f], box);
        }
      },
    }, tau0.tau);
    const scene = stampSheetSceneOf(clock, state, orderTime, tau === tau0.tau ? tau0 : { tau, exact: null });
    return { tau0: tau0.tau, tau, scene, warnings, closes: !past(scene) && await setBy(tau) };
  };

  /**
   * Entry `k` decided, or replayed from `known`, its remembered decision, and landed, unless its prefix ends at scene
   * second `at` (null for no end) before it; `unscheduled`, the names after it for a failure's message.
   */
  const entry = async (k: number, known: StampSheetDecision | null, unscheduled: readonly string[], at: number | null): Promise<StampSheetEntryRun> => {
    const { wash: w, name, orderTime } = entries[k];
    /** `scene` when it's past the prefix's end; null when it lands by it, or off the clock. */
    const beyond = (scene: number | null) => (at !== null && scene !== null && scene > at ? scene : null);
    const knownBeyond = known ? beyond(known.scene) : null;
    if (knownBeyond !== null) return { lands: false, scene: knownBeyond, known: true, started: false };
    if (orderTime !== null && state.clockStart === null) state = stampSheetClockStarted(state, clock.kind === 'scale' ? clock.origin : null);
    let begun: StampSheetBegun | null = null;
    if (spans.first[w] === k) begun = known ? stampSheetBegunOf(known) : await decideWashStart(k, w);
    if (begun) await beginWash(w, begun);
    else if (clips.away(w)) await steps.step(`returning to wash ${washes[w].name}`, (encoder) => clips.enter(encoder, w));
    const from = begun?.start ?? { tau: state.tau, scene: state.scene };
    const landing = known ? stampSheetLandingOf(known) : await decideLanding(k, from, unscheduled, (scene) => beyond(scene) !== null);
    costs?.count(known ? 'decisions reused' : 'decisions made');
    const landsBeyond = beyond(landing.scene);
    if (landsBeyond !== null) return { lands: false, scene: landsBeyond, known: false, started: !!begun };
    for (const warning of landing.warnings) costs?.warned(warning);
    state = stampSheetDecided(state, landing);
    await steps.step(`landing ${name}`, (encoder) => {
      const gpuTau = timeBase.after(encoder, landing.tau);
      if (landing.closes) close(encoder, landing.tau, 'set');
      land(encoder, k, gpuTau);
      if (spans.last[w] === k) clips.end(encoder, w);
    });
    const measured = !known && spans.last[w] === k ? await washSetAt(k, w) : null;
    const moment = (tau: number) => stampSheetMomentAfter(clock, state, orderTime !== null, tau);
    const read = dampReport && !known?.dampReport ? await dampReport.after(k, w, { tau: state.tau, touched: touchedBox(w), moment }) : known?.dampReport ?? null;
    return { lands: true, decision: stampSheetDecisionOf(begun, landing, known ? known.washSet : measured, read), known: !!known && read === known.dampReport };
  };

  /** The checkpoint after `k` entries, by name: its clips told apart, as another program's may differ. */
  const checkpointKey = (k: number) => `${keys[k]}|clips ${clips.keptName(k)}`;
  /** Where a checkpoint's piece goes back to. */
  const pieceTexture = (target: StampSheetPieceTarget): GPUTexture => {
    if (target.kind === 'film') return targets.film(target.film).texture;
    if (target.kind === 'clip') return clips.textureOf(target.clip);
    return target.kind === 'paper' ? targets.paper.texture : targets.rim.texture;
  };
  /** The run back at its start: clean films and dry paper. */
  const restart = (encoder: GPUCommandEncoder) => {
    gpu.restart(encoder);
    state = stampSheetSolveStart(program.films.length, washes.length);
    clips.restored(encoder, 0, []);
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
    /** Whether a checkpoint is kept after `k` entries. */
    kept: (k: number) => stampSheetCheckpointKept(owner, checkpointKey(k)),
    /** Holds the checkpoint after `k` entries from eviction until the returned release runs. Throws where none is kept. */
    hold: (k: number) => holdStampSheetCheckpoint(owner, checkpointKey(k)),
    /** Keeps the state after `k` entries as a checkpoint. */
    keep(encoder: GPUCommandEncoder, k: number) {
      targets.putBack(encoder);
      const kept = clips.kept(k);
      keepStampSheetCheckpoint(owner, encoder, checkpointKey(k), [
        ...program.films.map((_, film) => ({ target: { kind: 'film', film } as const, texture: targets.film(film).texture, box: state.painted[film] })),
        { target: { kind: 'paper' }, texture: targets.paper.texture, box: state.field }, { target: { kind: 'rim' }, texture: targets.rim.texture, box: state.field },
        ...kept.map((clip) => ({ target: { kind: 'clip', clip } as const, texture: clips.textureOf(clip), box: clipBox(clip.wash) })),
      ], { state, clips: kept });
    },
    /** The run as the checkpoint after `k` entries left it. Throws where none is kept: an engine fault, as a caller checks or holds it first. */
    restore(encoder: GPUCommandEncoder, k: number) {
      restart(encoder);
      const restored = restoreStampSheetCheckpoint(owner, encoder, checkpointKey(k), (checkpoint) => {
        clips.restored(encoder, k, checkpoint.clips);
        return pieceTexture;
      });
      state = stampSheetStateResized(restored.state, program.films.length, washes.length);
    },
    restart,
  };
}

export type StampSheetRun = ReturnType<typeof stampSheetRun>;
