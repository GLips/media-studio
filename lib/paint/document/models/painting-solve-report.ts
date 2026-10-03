// painting-solve-report.ts: what `studio paint check --solve` prints of a solve, in its sheet's order: each wash, when
// it started and when what it touched had set, and under it each application's landing time and what it waited for,
// its warnings after it; then what the solve cost. A clocked application's times are scene seconds, model time beside.

import { STAMP_PAINT_COST_NAMES, type StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import type { StampSheetProgram } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import { stampSheetSeconds, type StampSheetDecision, type StampSheetMoment } from '#lib/paint/painting/models/stamp-sheet-schedule.ts';

/** A moment as a report prints it: its scene second with model time beside, or model time alone off the clock. */
const paintingSolveMoment = ({ tau, scene }: StampSheetMoment) => (scene === null ? stampSheetSeconds(tau) : `scene ${stampSheetSeconds(scene)} (model ${stampSheetSeconds(tau)})`);

/** `program`'s solve as lines, each entry's decision `decisions`' at its index. */
export function paintingSolveLines(program: StampSheetProgram, decisions: readonly StampSheetDecision[]): string[] {
  return decisions.flatMap((decision, k) => {
    const entry = program.entries[k], wash = program.washes[entry.wash];
    const ends = program.entries.findLastIndex((other) => other.wash === entry.wash) === k;
    const waits = entry.on ? ` (on '${entry.on}'${decision.tau > decision.tau0 ? `, ${stampSheetSeconds(decision.tau - decision.tau0)} after it could` : ''})` : '';
    const neverSets = program.clock.kind === 'never' && wash.wetHistory ? [`  ${wash.name}: never sets`] : [];
    return [
      ...(decision.start ? [`${wash.name} (${program.films[wash.film].name}): starts at ${paintingSolveMoment(decision.start)}`] : []),
      `  ${entry.name}: lands at ${paintingSolveMoment(decision)}${waits}${entry.bloom ? ', blooming' : ''}`,
      ...decision.warnings.map((warning) => `  warning: ${warning}`),
      ...(ends && decision.washSet ? [`  ${wash.name}: set by ${paintingSolveMoment(decision.washSet)}`] : []),
      ...(ends && !decision.washSet ? neverSets : []),
    ];
  });
}

/** What a solve cost, a line: each count it made, by name in STAMP_PAINT_COST_NAMES' order; `none` for none. */
export function paintingSolveCostsLine({ counts }: StampPaintCosts): string {
  const made = STAMP_PAINT_COST_NAMES.flatMap((name) => (counts.get(name) ? [`${counts.get(name)} ${name}`] : []));
  return `costs: ${made.length ? made.join(', ') : 'none'}`;
}
