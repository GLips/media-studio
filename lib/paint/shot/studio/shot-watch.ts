// shot-watch.ts: a PaintedShot's progress watchdog. The render's holds wait on its load and each draw while they make
// progress, a solve finishing or a GPU check settling (one solve is many checks), counted each second while one is
// pending. None for SHOT_STALL_SECONDS, and it rejects naming the solve.
//
// Lines go to the render's terminal (render-page-log.ts): each warm solve that solved sheets, each slow solve of a
// frame (its quick ones would print a dozen a frame), and every SHOT_HEARTBEAT_SECONDS of a long solve still
// progressing. Progress no line reports sends a pulse, so the render's Node side, counting lines and pulses as life
// (render-watch.ts), sees the page alive while it is, and a stalled page, which sends nothing, as stuck.

import type { StampGpuCacheBytes, StampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { logRenderPageLine, logRenderPagePulse } from '#lib/platform/browser/studio/render-page-log.ts';
import {
  shotSolvedLine, shotStallText, shotStillSolvingLine, type ShotRun, type ShotRunDevice, type ShotRunPlace, type ShotSolve, type ShotWatchName,
} from '../models/shot-progress.ts';

/** How long a shot may go with no solve finished and no GPU check settled before it's stuck, s. */
export const SHOT_STALL_SECONDS = 90;

/** How often a long solve still making progress says so, s. */
const SHOT_HEARTBEAT_SECONDS = 30;

/** How long a frame's own solve runs before its line is worth printing, s. */
const SHOT_SLOW_SOLVE_SECONDS = 5;

/** The most seconds between pulses while the shot makes progress: well inside the render browser's stall floor. */
const SHOT_PULSE_SECONDS = 15;

/** What a renderer tells its watch: each run as it starts, with its solves' count, and each solve's start and end. */
export type ShotSolveProgress = {
  readonly run: (run: ShotRun, total: number) => void;
  readonly solving: (solve: ShotSolve) => void;
  readonly solved: () => void;
};

export type ShotWatch = ShotSolveProgress & {
  /**
   * `work`, `doing` what it says (loading, drawing a frame), raced against the watch, which runs while any is
   * pending: rejected with the stall's error once the shot's stuck.
   */
  readonly watching: <T>(doing: string, work: Promise<T>) => Promise<T>;
  /** Stops the timer; whatever's pending settles as its work does. */
  readonly dispose: () => void;
};

/** The shot's device as its watch reads it: checks settled, caches' evictions and bytes uploaded so far, the bytes its cache holds now. */
export type ShotGpuReading = { readonly checksSettled: number; readonly evictions: number; readonly uploaded: number; readonly bytes: StampGpuCacheBytes };

/**
 * What a watch reads: the shot's `name`; its device (null before it's made); `costs`, its tally, taken after each run;
 * where its lines and pulses go; how long a stall is.
 */
export type ShotWatchSource = {
  readonly name: ShotWatchName;
  readonly gpu: () => ShotGpuReading | null;
  readonly costs: StampPaintCostTally;
  readonly log?: (line: string) => void;
  readonly pulse?: () => void;
  readonly stallSeconds?: number;
};

const NO_GPU: ShotGpuReading = { checksSettled: 0, evictions: 0, uploaded: 0, bytes: { kept: 0, targets: 0 } };

export function createShotWatch({ name, gpu, costs, log = logRenderPageLine, pulse = logRenderPagePulse, stallSeconds = SHOT_STALL_SECONDS }: ShotWatchSource): ShotWatch {
  let place: (ShotRunPlace & { done: number; solving: ShotSolve | null }) | null = null, doing = '';
  // Seconds with no progress, in the solve running, and since the last pulse; the checks settled at the last tick;
  // sheets solved before the solve running; the device as the run began.
  let idle = 0, solvingFor = 0, unpulsed = 0, checks = 0, before = { programs: 0, entries: 0 }, runFrom = NO_GPU;
  let timer: ReturnType<typeof setInterval> | null = null;
  const pending = new Set<(error: Error) => void>();
  const reading = () => gpu() ?? NO_GPU;
  const sheetsSolved = () => {
    const { counts } = costs.counted();
    return { programs: counts.get('solves') ?? 0, entries: counts.get('entries run') ?? 0 };
  };
  const runDevice = (): ShotRunDevice => {
    const now = reading();
    return { evictions: now.evictions - runFrom.evictions, uploaded: now.uploaded - runFrom.uploaded, bytes: now.bytes };
  };

  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  const tick = () => {
    const now = reading().checksSettled;
    idle = now === checks ? idle + 1 : 0;
    checks = now;
    solvingFor++;
    unpulsed++;
    if (idle >= stallSeconds) {
      const error = new Error(shotStallText(name, doing, place, idle, costs.counted(), runDevice()));
      for (const reject of pending) reject(error);
      pending.clear();
      stop();
      return;
    }
    if (idle === 0 && unpulsed >= SHOT_PULSE_SECONDS) {
      unpulsed = 0;
      pulse();
    }
    const solving = place?.solving;
    if (solving && idle < SHOT_HEARTBEAT_SECONDS && solvingFor % SHOT_HEARTBEAT_SECONDS === 0) log(shotStillSolvingLine(name, place!, solving, solvingFor));
  };

  return {
    run: (run, total) => {
      place = { run, total, done: 0, solving: null };
      runFrom = { ...reading() };
    },
    solving: (solve) => {
      if (!place) return;
      place.solving = solve;
      solvingFor = 0;
      before = sheetsSolved();
    },
    solved: () => {
      if (!place?.solving) return;
      const solve = place.solving, after = sheetsSolved();
      place.done++;
      place.solving = null;
      idle = 0;
      const programs = after.programs - before.programs;
      if (programs > 0 && (place.run.kind === 'warm' || solvingFor >= SHOT_SLOW_SOLVE_SECONDS)) {
        log(shotSolvedLine(name, place, solve, { programs, entries: after.entries - before.entries, secs: solvingFor }));
      }
    },
    watching: (what, work) => new Promise((resolve, reject) => {
      if (!pending.size) {
        idle = 0;
        checks = reading().checksSettled;
        timer = setInterval(tick, 1000);
      }
      place = null;
      doing = what;
      pending.add(reject);
      work.then(resolve, reject).finally(() => {
        pending.delete(reject);
        if (!pending.size) stop();
      });
    }),
    dispose: () => {
      pending.clear();
      stop();
    },
  };
}
