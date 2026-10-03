// stamp-sheet-solver.ts: a sheet program, posed, solved forward (ENGINE 3, 4) through a prefix: its first `through`
// entries, or those landing by a scene second `at`. Each entry is run by stamp-sheet-run.ts; a finished prefix has
// its last drying closed and every film settled, its films kept under its last key (stamp-sheet-films.ts).
//
// Remembered by state key (ENGINE 4.2), in one memo: each landed entry's decision, or the scene second of an entry
// past a prefix's `at`, so the next solve knows where it stops. Checkpoints (stamp-sheet-checkpoints.ts) are kept
// before each wash's first entry, the first posed one, and where an unfinished prefix stops. A known prefix with kept
// films solves nothing; else a solve runs on from its latest checkpoint.

import { stampBrushedMasksUnder } from '../models/stamp-brushed-mask.ts';
import type { StampPaintCostTally } from '../models/stamp-paint-costs.ts';
import type { StampSheetDecision } from '../models/stamp-sheet-schedule.ts';
import { stampSheetMixedPainting, stampSheetWashSpans, type StampSheetProgram } from '../models/stamp-sheet-program.ts';
import { stampSheetEntryKey, stampSheetHeadKey } from '../models/stamp-sheet-state-key.ts';
import { stampSheetSolvePlan } from '../models/stamp-sheet-wrap.ts';
import { stampDrying } from '../models/stamp-wetness.ts';
import { bindStampPaintBrushes } from './stamp-deposit-bank.ts';
import { stampPaintCompositorFor } from './stamp-paint-compositor-for.ts';
import type { StampPaintGpuOwner } from './stamp-paint-gpu-owner.ts';
import { keepStampSheetFilms, keptStampSheetFilms, type StampSheetFilmKept } from './stamp-sheet-films.ts';
import { loadStampSheetSolve } from './stamp-sheet-load.ts';
import { stampSheetRun, type StampSheetRun } from './stamp-sheet-run.ts';
import { withStampSolveLease } from './stamp-solve-lease.ts';

export type StampSheetSolveOptions = {
  /** How many entries are solved, from the first: all of them when left out. */
  through?: number;
  /** The scene second the prefix shows (ENGINE 4.4): the unclocked run and each clocked entry landing by it. */
  at?: number;
  /** Whether the painting ends after them, its last drying closed: when they're all of it or `at` is given, unless said. */
  finish?: boolean;
  /** Where the solve counts what it cost: the solve, its readbacks, decisions, films and checkpoints found or not, warnings. */
  costs?: StampPaintCostTally;
};

/** A solve: its last key (Kₖ after the entries solved), how many it solved and whether the painting ended there, the films it kept, each entry's decision. */
export type StampSheetSolved = { key: string; through: number; finished: boolean; films: readonly StampSheetFilmKept[]; decisions: readonly StampSheetDecision[] };

/** What's remembered of an entry by its key Kₖ₊₁: its decision once it has landed, else the scene second a prefix's `at` was found to stop it at. */
type StampSheetMemo = { decision: StampSheetDecision } | { past: number };

/** How many entries are remembered, the oldest forgotten first. */
const STAMP_SHEET_REMEMBERED = 65536;
const remembered = new Map<string, StampSheetMemo>();

function rememberStampSheet(key: string, memo: StampSheetMemo) {
  remembered.set(key, memo);
  if (remembered.size > STAMP_SHEET_REMEMBERED) remembered.delete(remembered.keys().next().value!);
}

/** The scene second a memo's entry lands at, or was found past a prefix at. */
const stampSheetMemoScene = (memo: StampSheetMemo) => ('past' in memo ? memo.past : memo.decision.scene);

/** The decision remembered under `key`: null for none, or an entry only known to stop a prefix. */
const stampSheetKnownDecision = (key: string) => {
  const memo = remembered.get(key);
  return memo && 'decision' in memo ? memo.decision : null;
};

/**
 * `program` (posed: painting-pose.ts) solved on `owner`'s device as `options` say, once every solve asked for before
 * it has finished.
 */
export function solveStampSheet(owner: StampPaintGpuOwner, program: StampSheetProgram, options: StampSheetSolveOptions = {}): Promise<StampSheetSolved> {
  return withStampSolveLease(owner, () => solveLeased(owner, program, options));
}

/** K₀ (from `head`) to K_`through` for `entries`: each its datum and pose after the key before it. */
async function stampSheetKeys(head: string, entries: StampSheetProgram['entries'], through: number): Promise<string[]> {
  const chain = async (keys: string[]): Promise<string[]> => {
    const k = keys.length - 1;
    if (k === through) return keys;
    return chain([...keys, await stampSheetEntryKey(keys[k], entries[k])]);
  };
  return chain([await stampSheetHeadKey(head)]);
}

/**
 * What's remembered of a prefix of `limit` entries keyed `keys`, ending at scene second `at` (undefined for none):
 * the decisions known from its start, and where it stops when that's known (null while an entry must be decided).
 */
function stampSheetRemembered(keys: readonly string[], limit: number, at: number | undefined) {
  const decisions: StampSheetDecision[] = [];
  for (let k = 0; k < limit; k++) {
    const memo = remembered.get(keys[k + 1]), scene = memo ? stampSheetMemoScene(memo) : null;
    if (at !== undefined && scene !== null && scene > at) return { decisions, stop: k };
    if (!memo || 'past' in memo) return { decisions, stop: null };
    decisions.push(memo.decision);
  }
  return { decisions, stop: limit };
}

async function solveLeased(owner: StampPaintGpuOwner, planned: StampSheetProgram, { through, at, finish, costs }: StampSheetSolveOptions): Promise<StampSheetSolved> {
  const { entries } = planned, all = entries.length;
  if (through !== undefined && !(Number.isInteger(through) && through >= 0 && through <= all)) throw new Error(`stamp sheet: a solve goes through 0 to ${all} entries, not ${through}`);
  if (at !== undefined && !Number.isFinite(at)) throw new Error(`stamp sheet: a prefix ends at a finite scene second, not ${at}`);
  // An entry's scene time is never before its order time, by which the clocked run is sorted: none past one ordered after `at` lands by it.
  const limit = Math.min(through ?? all, at === undefined ? all : entries.filter(({ orderTime }) => orderTime === null || orderTime <= at).length);
  // A sheet that wraps is solved banded on a stage holding its halo, in K₀ (stamp-sheet-wrap.ts); its films are kept cropped to the frame.
  const plan = stampSheetSolvePlan(planned);
  const keys = await stampSheetKeys(plan.head, entries, limit);
  const finished = finish ?? (at !== undefined || (through ?? all) === all);
  const filmKey = (k: number) => `${keys[k]}|${finished ? 'finished' : 'open'}`;
  const known = stampSheetRemembered(keys, limit, at);
  const kept = known.stop === null ? null : keptStampSheetFilms(owner, filmKey(known.stop), planned.films.length);
  costs?.count(kept ? 'film hits' : 'film misses', planned.films.length);
  if (kept) return { key: keys[known.stop!], through: known.stop!, finished, films: kept, decisions: known.decisions };

  const program = plan.painted();
  const choice = stampPaintCompositorFor(stampSheetMixedPainting(program));
  if (!choice.wet) throw new Error('stamp sheet: a sheet solve paints in pigment, its films each in a medium');
  const posed = program.entries.map(({ deposit }) => deposit);
  const brushedMasks = stampBrushedMasksUnder([...posed.map(({ mask }) => mask), ...program.washes.map(({ prewet }) => prewet?.held)]);
  const brushes = await bindStampPaintBrushes(owner, { deposits: posed, marks: brushedMasks.flatMap(({ marks }) => marks), paper: program.paper });
  const scope = owner.scope();
  try {
    const gpu = await owner.checked('loading a sheet solve', () => loadStampSheetSolve(owner, scope.device, {
      program, stage: plan.stage, compositor: choice.compositorOn(scope.device), media: choice.media, brushes, brushedMasks,
    }));
    // `never` dries nothing on the sheet, its unclocked run included.
    const drying = { ...stampDrying(program.water.wetting, program.paper), ...(program.clock.kind === 'never' && { rate: 0 }) };
    const run = stampSheetRun(owner, scope.device, { program, keys, gpu, drying, brushes, waterOf: choice.media.waterOf, costs: costs ?? null });
    const resumed = await resumeStampSheet(run, known.decisions);
    if (known.decisions.length) costs?.count(resumed.from ? 'checkpoint hits' : 'checkpoint misses');
    const { stop, decisions } = await runStampSheet(program, run, { keys, limit, at, ...resumed });
    if (stop < all && !run.kept(stop)) await run.steps.step('keeping where the prefix stops', (encoder) => run.keep(encoder, stop));
    const films = await run.steps.step('keeping the films', (encoder) => {
      if (finished) run.finish(encoder);
      gpu.targets.putBack(encoder);
      const painted = program.films.map((_, f) => ({ texture: gpu.targets.film(f).texture, box: run.state().painted[f] }));
      return keepStampSheetFilms(owner, encoder, filmKey(stop), gpu.stage, painted);
    });
    costs?.solved({ program: program.name, from: entries[resumed.from]?.name ?? 'no entry', entries: stop - resumed.from });
    return { key: keys[stop], through: stop, finished, films, decisions };
  } finally {
    scope.destroy();
  }
}

/** Where `run` resumes: the latest checkpoint after one of the entries `known` decided, restored, and the decisions before it; else the start. */
async function resumeStampSheet(run: StampSheetRun, known: readonly StampSheetDecision[]) {
  const from = Array.from({ length: known.length }, (_, i) => known.length - i).find((k) => run.kept(k)) ?? 0;
  if (from) await run.steps.step('resuming from a checkpoint', (encoder) => run.restore(encoder, from));
  return { from, decisions: known.slice(0, from) };
}

/**
 * `run`'s entries from `from` (`decisions` those before it) until `limit`, or one landing past `at`: where it
 * stopped and each landed entry's decision. A wash started past `at` is undone from the checkpoint before it.
 */
async function runStampSheet(program: StampSheetProgram, run: StampSheetRun, plan: {
  keys: readonly string[]; limit: number; at: number | undefined; from: number; decisions: readonly StampSheetDecision[];
}): Promise<{ stop: number; decisions: StampSheetDecision[] }> {
  const { entries } = program, { keys, limit, at } = plan, decisions = [...plan.decisions], { first } = stampSheetWashSpans(program);
  // A pose moved this entry's marks: a deposit carries its map back to rest only once posed (painting-pose.ts).
  const firstPosed = entries.findIndex(({ deposit }) => deposit.rest !== undefined);
  const from = async (k: number): Promise<number> => {
    if (k === limit) return k;
    const starts = first[entries[k].wash] === k;
    // The checkpoint a wash started past `at` is undone from is held in the step keeping it: another user of the
    // device making an entry while that step's checks are awaited could give it up otherwise.
    const holds = at !== undefined && starts && k > 0, releases: (() => void)[] = [];
    try {
      if (k > 0 && (starts || k === firstPosed) && !run.kept(k)) {
        await run.steps.step('keeping a checkpoint', (encoder) => {
          run.keep(encoder, k);
          if (holds) releases.push(run.hold(k));
        });
      } else if (holds) releases.push(run.hold(k));
      const ran = await run.entry(k, stampSheetKnownDecision(keys[k + 1]), entries.slice(k + 1, limit).map(({ name }) => name), at ?? null);
      if (!ran.lands) {
        if (!ran.known) rememberStampSheet(keys[k + 1], { past: ran.scene });
        if (ran.started) await run.steps.step('undoing a wash past the prefix', (encoder) => (k ? run.restore(encoder, k) : run.restart(encoder)));
        return k;
      }
      if (!ran.known) rememberStampSheet(keys[k + 1], { decision: ran.decision });
      decisions.push(ran.decision);
    } finally {
      for (const release of releases) release();
    }
    return from(k + 1);
  };
  return { stop: await from(plan.from), decisions };
}
