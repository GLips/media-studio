// painting-solve-report.ts: what `studio paint check --solve` prints of a solve, in its sheet's order: each wash, when
// it started, when what it wetted was damp and when what it touched had set, and under it each application's landing
// time and what it waited for, a bloom's span damp again, its warnings after it; then what the solve cost. A clocked
// application's times are scene seconds, model time beside.

import { STAMP_PAINT_COST_NAMES, type StampPaintCosts } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { stampSheetWashSpans, type StampSheetProgram } from '#lib/paint/painting/models/stamp-sheet-program.ts';
import {
  STAMP_SHEET_SHARE, stampSheetSeconds, type StampSheetDampWindow, type StampSheetDecision, type StampSheetMoment,
} from '#lib/paint/painting/models/stamp-sheet-schedule.ts';

/** A moment as a report prints it: its scene second with model time beside, or model time alone off the clock. */
const paintingSolveMoment = ({ tau, scene }: StampSheetMoment) => (scene === null ? stampSheetSeconds(tau) : `scene ${stampSheetSeconds(scene)} (model ${stampSheetSeconds(tau)})`);

/** A damp window as a report says it: `again` for a bloom's footprint, damp a second time. */
function paintingDampText(span: StampSheetDampWindow, again: boolean): string {
  const damp = again ? 'damp again' : 'damp';
  if (span.kind === 'damp') return `${damp} from ${paintingSolveMoment(span.from)} until ${paintingSolveMoment(span.to)}`;
  return `never ${damp} over ${Math.round(STAMP_SHEET_SHARE * 100)}% of it at once (at most ${Math.round(span.share * 100)}% at ${paintingSolveMoment(span.at)})`;
}

/** What a wash's last line says of it: when what it wetted was damp and when it had set, each where known. */
function paintingWashEndText(decision: StampSheetDecision): string | null {
  const damp = decision.dampReport?.wash, parts = [damp && paintingDampText(damp, false), decision.washSet && `set by ${paintingSolveMoment(decision.washSet)}`];
  const said = parts.filter((part): part is string => !!part);
  return said.length ? said.join(', ') : null;
}

/** `program`'s solve as lines, each entry's decision `decisions`' at its index; damp windows among them where it read them. */
export function paintingSolveLines(program: StampSheetProgram, decisions: readonly StampSheetDecision[]): string[] {
  const { last } = stampSheetWashSpans(program);
  return decisions.flatMap((decision, k) => {
    const entry = program.entries[k], wash = program.washes[entry.wash], ends = last[entry.wash] === k;
    const waits = entry.on ? ` (on '${entry.on}'${decision.tau > decision.tau0 ? `, ${stampSheetSeconds(decision.tau - decision.tau0)} after it could` : ''})` : '';
    const neverSets = program.clock.kind === 'never' && wash.wetHistory ? [`  ${wash.name}: never sets`] : [];
    const rewet = decision.dampReport?.rewet, washEnd = ends ? paintingWashEndText(decision) : null;
    return [
      ...(decision.start ? [`${wash.name} (${program.films[wash.film].name}): starts at ${paintingSolveMoment(decision.start)}`] : []),
      `  ${entry.name}: lands at ${paintingSolveMoment(decision)}${waits}${entry.bloom ? ', blooming' : ''}`,
      ...(rewet ? [`  ${entry.name}: rewets its footprint, ${paintingDampText(rewet, true)}`] : []),
      ...decision.warnings.map((warning) => `  warning: ${warning}`),
      ...(washEnd ? [`  ${wash.name}: ${washEnd}`] : []),
      ...(ends && !decision.washSet ? neverSets : []),
    ];
  });
}

/** What a solve cost, a line: each count it made, by name in STAMP_PAINT_COST_NAMES' order; `none` for none. */
export function paintingSolveCostsLine({ counts }: StampPaintCosts): string {
  const made = STAMP_PAINT_COST_NAMES.flatMap((name) => (counts.get(name) ? [`${counts.get(name)} ${name}`] : []));
  return `costs: ${made.length ? made.join(', ') : 'none'}`;
}
