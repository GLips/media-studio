// painting-solve-report.ts: what `studio paint check --solve` prints of a solve, in its sheet's order: each wash, when
// it started and when what it wetted had set, and under it each application's landing time and what it waited for,
// its warnings after it; then what the solve cost.

import { STAMP_PAINT_COST_NAMES, type StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { StampSheetProgram } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { stampSheetSeconds, type StampSheetDecision } from '#lib/paint/painting/models/stamp-sheet-schedule.ts';

/** `program`'s solve as lines, each entry's decision `decisions`' at its index. */
export function paintingSolveLines(program: StampSheetProgram, decisions: readonly StampSheetDecision[]): string[] {
  return decisions.flatMap((decision, k) => {
    const entry = program.entries[k], wash = program.washes[entry.wash], starts = k === 0 || program.entries[k - 1].wash !== entry.wash;
    const ends = program.entries.findLastIndex((other) => other.wash === entry.wash) === k;
    const waits = entry.on ? ` (on '${entry.on}'${decision.tau > decision.tau0 ? `, ${stampSheetSeconds(decision.tau - decision.tau0)} after it could` : ''})` : '';
    return [
      ...(starts ? [`${wash.name} (${program.films[wash.film].name}): starts at ${stampSheetSeconds(decision.tau0)}`] : []),
      `  ${entry.name}: lands at ${stampSheetSeconds(decision.tau)}${waits}${entry.bloom ? ', blooming' : ''}`,
      ...decision.warnings.map((warning) => `  warning: ${warning}`),
      ...(ends && decision.washSet !== null ? [`  ${wash.name}: set by ${stampSheetSeconds(decision.washSet)}`] : []),
    ];
  });
}

/** What a solve cost, a line: each count it made, by name in STAMP_PAINT_COST_NAMES' order; `none` for none. */
export function paintingSolveCostsLine({ counts }: StampPaintCosts): string {
  const made = STAMP_PAINT_COST_NAMES.flatMap((name) => (counts.get(name) ? [`${counts.get(name)} ${name}`] : []));
  return `costs: ${made.length ? made.join(', ') : 'none'}`;
}
