// frame-motion.ts: how much a stretch of video moves, frame by frame, and where it breaks "always moving", from each
// frame's mean luma and its mean difference from the frame before. Pure: lib/engine/look/frame-look.ts measures the numbers.
import type { BarClockTable } from '../../models/timeline/bar-timeline.ts';

/** A stretch's frames, each with its mean luma and its mean difference from the frame before (none for the first). */
export type LumaMotion = { first: number; luma: number[]; diff: (number | null)[] };

export type StillRun = { from: number; to: number; maxDiff: number };

/** A still run is at least this many frames in a row, each under the still threshold from the one before. */
const STILL_RUN_FRAMES = 7;

/**
 * The runs of near-still frames: STILL_RUN_FRAMES or more in a row, each moving less than `still` from the one before.
 * A cut (a bar's first frame) ends a run, and nothing from the fade on counts.
 */
export function findStillRuns({ first, diff }: LumaMotion, still: number, clock?: BarClockTable): StillRun[] {
  const cuts = new Set(clock?.bars.map((b) => b.from));
  const stop = Math.min(first + diff.length - 1, (clock?.fade.from ?? Infinity) - 1);
  const runs: StillRun[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= STILL_RUN_FRAMES - 1) runs.push({ from: run[0] - 1, to: run.at(-1)!, maxDiff: Math.max(...run.map((f) => diff[f - first]!)) });
    run = [];
  };
  for (let f = first + 1; f <= stop; f++) {
    const d = diff[f - first];
    if (d !== null && d < still && !cuts.has(f)) run.push(f);
    else flush();
  }
  flush();
  return runs;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * The summary `studio look --motion` prints: the stretch's mean motion, each bar's (its first frame, the cut, left out),
 * the still runs and every beat frame's luma and motion. `table` is every frame's numbers, for a file beside it.
 */
export function formatFrameMotion(motion: LumaMotion, { still, clock }: { still: number; clock?: BarClockTable }) {
  const { first, luma, diff } = motion, last = first + luma.length - 1;
  const at = (f: number) => ({ luma: luma[f - first], diff: diff[f - first] });
  const diffs = (from: number, to: number) => diff.slice(from - first, to - first + 1).filter((d): d is number => d !== null);
  const summary = [`frames ${first}–${last}: mean diff ${mean(diffs(first, last)).toFixed(1)}, mean luma ${mean(luma).toFixed(1)}`];

  const bars = clock?.bars.filter((b) => b.from <= last && b.to > first) ?? [];
  if (bars.length) {
    summary.push('', 'bar  frames    mean diff  mean luma');
    for (const b of bars) {
      const from = Math.max(b.from, first), to = Math.min(b.to - 1, last);
      const moves = diffs(Math.max(b.from + 1, from), to);
      summary.push(`${String(b.n).padStart(3)}  ${String(from).padStart(3)}–${String(to).padEnd(4)}  ${(moves.length ? mean(moves).toFixed(1) : '-').padStart(9)}  ${mean(luma.slice(from - first, to - first + 1)).toFixed(1).padStart(9)}`);
    }
  }

  const runs = findStillRuns(motion, still, clock);
  summary.push('', `still runs (${STILL_RUN_FRAMES}+ frames each under ${still} from the one before${clock ? ', before the fade' : ''})${runs.length ? ':' : ': none'}`);
  for (const r of runs) summary.push(`  ${r.from}–${r.to}  (${r.to - r.from + 1} frames, max diff ${r.maxDiff.toFixed(1)})`);

  const beats = clock?.beats.filter((f) => f >= first && f <= last && f < clock.fade.from) ?? [];
  if (beats.length) summary.push('', 'beat frames: luma/diff', `  ${beats.map((f) => `${f}:${at(f).luma.toFixed(0)}/${at(f).diff?.toFixed(1) ?? '-'}`).join('  ')}`);

  const barOf = (f: number) => clock?.bars.find((b) => f >= b.from && f < b.to)?.n;
  const table = ['frame  luma   diff  bar', ...luma.map((l, i) => {
    const f = first + i, d = diff[i];
    return `${String(f).padStart(5)}  ${l.toFixed(1).padStart(5)}  ${(d === null ? '-' : d.toFixed(1)).padStart(5)}  ${barOf(f) ?? ''}`.trimEnd();
  })];
  return { summary, table };
}
