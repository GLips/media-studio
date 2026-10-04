// shot-progress.ts: what a painted shot's watch (studio/shot-watch.ts) says of its solves. A shot runs its warm,
// solving its span's moments before its first frame shows, then each frame's draw, which solves at its own moment
// whatever the warm didn't keep: cold. A solve that solved sheets gets a line; a stall gets an error naming what was
// solving where, how far the run got, and what it cost so far.

import type { StampPaintCostName, StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { renderBrowserFailureText } from '#lib/platform/browser/models/render-browser-failure.ts';

/** What a shot runs: its warm over scene seconds `from`..`to`, or the draw of the frame at scene second `t`. */
export type ShotRun = { readonly kind: 'warm'; readonly from: number; readonly to: number } | { readonly kind: 'frame'; readonly t: number };

/** One solve of a run: `what` it solves (a plane's id, or `texture <id>`) at scene second `at`. */
export type ShotSolve = { readonly what: string; readonly at: number };

/** A run's place: its total solves, how many are done, and the one solving now (null between solves). */
export type ShotRunPlace = { readonly run: ShotRun; readonly total: number; readonly done: number; readonly solving: ShotSolve | null };

/** A second as a line prints it: three places at most, so 2.4333… reads 2.433. */
const seconds = (s: number) => `${Number(s.toFixed(3))}`;

/** The shot as its watch names it: by the scene playing it, when one does; in a stall's error, by its planes too. */
export type ShotWatchName = { readonly line: string; readonly whole: string };

export function shotWatchName(scene: string | null, planes: readonly string[]): ShotWatchName {
  return {
    line: scene === null ? 'a painted shot' : `scene ${scene}`,
    whole: `${scene === null ? 'a painted shot' : `scene ${scene}'s painted shot`} (${planes.join(', ')})`,
  };
}

const runText = (run: ShotRun) => (run.kind === 'warm' ? `warming ${seconds(run.from)}–${seconds(run.to)} s` : `drawing ${seconds(run.t)} s`);

/** A solve as a line names it: a frame's own is cold, since the warm didn't keep what it solves. */
const solveText = ({ what, at }: ShotSolve, run: ShotRun) => `${what} at ${seconds(at)} s${run.kind === 'frame' ? ' cold' : ''}`;

const count = (costs: StampPaintCosts, name: StampPaintCostName) => costs.counts.get(name) ?? 0;

const programsText = (n: number) => `${n} sheet program${n === 1 ? '' : 's'}`;

const mibText = (bytes: number) => `${Math.round(bytes / 2 ** 20)} MiB`;

/** The line for a solve finished `secs` in that solved sheets: `programs` sheet programs, `entries` entries run. */
export function shotSolvedLine(name: ShotWatchName, { run, total, done }: ShotRunPlace, solve: ShotSolve, solved: { readonly programs: number; readonly entries: number; readonly secs: number }): string {
  const took = solved.secs > 0 ? ` in ${solved.secs} s` : '';
  return `${name.line}, ${runText(run)}: solved ${solveText(solve, run)}${took}, ${done} of ${total} (${programsText(solved.programs)}, ${solved.entries} entries)`;
}

/** The line for a solve still running `secs` in, its device still answering. */
export function shotStillSolvingLine(name: ShotWatchName, { run }: ShotRunPlace, solve: ShotSolve, secs: number): string {
  return `${name.line}, ${runText(run)}: still solving ${solveText(solve, run)}, ${secs} s in`;
}

/**
 * What a run's device did so far, read as it stalls (its tally counts evictions and uploads only once a run ends):
 * caches' `evictions` and bytes `uploaded` since the run began, and the bytes its cache `kept` now.
 */
export type ShotRunDevice = { readonly evictions: number; readonly uploaded: number; readonly kept: number };

/** What `costs` has counted and `device` done, for a stall's error. */
function costsText(costs: StampPaintCosts, device: ShotRunDevice): string {
  return `${programsText(count(costs, 'solves'))} solved (${count(costs, 'entries run')} entries), ${count(costs, 'film misses')} film misses, `
    + `${device.evictions} evictions, ${mibText(device.uploaded)} uploaded, ${mibText(device.kept)} kept`;
}

/**
 * The error a shot stalled `secs` with, nothing solved and its device answering nothing, `doing` what it was (loading,
 * drawing a frame), at `place` in its run (null: before the run's first solve), with what the run cost so far. A stall
 * is its browser's failure: a hung GPU process, which a fresh browser may not meet.
 */
export function shotStallText(name: ShotWatchName, doing: string, place: ShotRunPlace | null, secs: number, costs: StampPaintCosts, device: ShotRunDevice): string {
  const stalled = `${name.whole} stalled: no solve has finished and its GPU has answered nothing in ${secs} s, so the render stops.`;
  if (!place) return renderBrowserFailureText(`${stalled} It was ${doing}, before any solve.`);
  const { run, total, done, solving } = place;
  const at = solving ? `It was solving ${solveText(solving, run)}, ${runText(run)}` : `It was ${runText(run)}, between solves`;
  return renderBrowserFailureText(`${stalled} ${at}, ${done} of ${total} solves done. This run's costs so far: ${costsText(costs, device)}.`);
}
