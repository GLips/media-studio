import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintingProblem, paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { createStampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { frameCostsTable } from '#lib/picture/profiling/models/frame-costs-table.ts';
import { SHOT_FRAME_COSTS_LABEL, shotCostsProfileEntry } from './shot-cost-report.ts';

/** What the page's memos keep, `compiled` selections among them. */
const keptWith = (compiled: number) => ({ compiled: { count: compiled, bytes: compiled * 10_000_000 }, posed: { count: 0, bytes: 0 }, placed: { count: 40, bytes: 20_000_000 } });

test('a shot\'s costs table per frame, frames that cost alike as one line, a solve or warning noted under its frame, then the span', () => {
  const tally = createStampPaintCostTally();
  const frame = (n: number, count: (costs: typeof tally) => void) => {
    count(tally);
    return { frame: n, label: SHOT_FRAME_COSTS_LABEL, ...shotCostsProfileEntry(tally.take()) };
  };
  const entries = [
    frame(0, (costs) => {
      costs.count('evaluations made');
      costs.count('film misses', 2);
      costs.count('bytes uploaded', 4_000_000);
      costs.solved({ program: 'heron sheet', from: 'wash 0', entries: 3 });
      costs.warned(paintingProblemText(paintingProblem('warning', 'treeline', 'on', "on 'wet' follows only applications at or below shiny 0.7: it can never hold")));
      costs.retained({ kept: 8_000_000, targets: 3_000_000 }, keptWith(3));
    }),
    ...[1, 2].map((n) => frame(n, (costs) => {
      costs.count('selection hits');
      costs.count('hidden solves skipped');
      costs.count('film hits', 2);
      costs.retained({ kept: 8_000_000, targets: 2_000_000 }, keptWith(2));
    })),
  ];
  assert.deepEqual(frameCostsTable(entries), [
    '  stamp paint costs:',
    '    frame 0: evaluations made 1, solves 1, entries run 3, film misses 2, bytes uploaded 4.0 MB; GPU bytes kept 8.0 MB, GPU bytes in targets 3.0 MB, '
      + 'compiled selections kept 3, compiled selections bytes kept 30.0 MB, posed programs kept 0, posed programs bytes kept 0.0 MB, placements kept 40, placements bytes kept 20.0 MB',
    '      solved heron sheet from wash 0: 3 entries',
    "      warning: treeline.on: on 'wet' follows only applications at or below shiny 0.7: it can never hold",
    '    frames 1–2, each: selection hits 1, hidden solves skipped 1, film hits 2; GPU bytes kept 8.0 MB, GPU bytes in targets 2.0 MB, '
      + 'compiled selections kept 2, compiled selections bytes kept 20.0 MB, posed programs kept 0, posed programs bytes kept 0.0 MB, placements kept 40, placements bytes kept 20.0 MB',
    '    over 3 frames: evaluations made 1, selection hits 2, hidden solves skipped 2, solves 1, entries run 3, film hits 4, film misses 2, bytes uploaded 4.0 MB; most GPU bytes kept 8.0 MB, '
      + 'most GPU bytes in targets 3.0 MB, most compiled selections kept 3, most compiled selections bytes kept 30.0 MB, most posed programs kept 0, most posed programs bytes kept 0.0 MB, '
      + 'most placements kept 40, most placements bytes kept 20.0 MB',
  ]);
});
