// painting-solve-report.ts: what `studio paint check --solve` prints of a solve, in its sheet's order: each wash, when
// it started and when what it wetted had set, and under it each application's landing time and what it waited for,
// its warnings after it. And what a still's page is handed and returns (engine/painting-still.ts).

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import type { StampPaintPackUrls } from '#lib/paint/brush-packs/models/stamp-paint-pack-urls.ts';
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

/**
 * What a still's page is handed: the property values as `--set` wrote them, each brush the document names by
 * `<style>/<brush>`, the packs' URLs, and whether to show each film alone over the paper too.
 */
export type PaintingStillRequest = {
  readonly texts: Readonly<Record<string, string>>; readonly brushes: Readonly<Record<string, StampBrush>>; readonly packUrls: StampPaintPackUrls; readonly films: boolean;
};

/** A still as its page returns it: the painting as a PNG data URL, each film's alone when asked, and the solve's lines. */
export type PaintingStill = { readonly png: string; readonly films: readonly { readonly name: string; readonly png: string }[]; readonly lines: readonly string[] };

/** What a still's page returns: the still, or what the solve refused to paint (a StampSheetRefusal's message). */
export type PaintingStillOutcome = { readonly still: PaintingStill } | { readonly refused: string };
