import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintingProblem, paintingProblemText } from '#lib/paint/document/models/painting-problem.ts';
import { createStampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { frameCostsTable } from '#lib/picture/profiling/models/frame-costs-table.ts';
import { SHOT_FRAME_COSTS_LABEL, shotCostsProfileEntry } from './shot-cost-report.ts';

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
      costs.retained({ kept: 8_000_000, targets: 3_000_000 });
    }),
    ...[1, 2].map((n) => frame(n, (costs) => {
      costs.count('evaluation memo hits');
      costs.count('hidden solves skipped');
      costs.count('film hits', 2);
      costs.retained({ kept: 8_000_000, targets: 2_000_000 });
    })),
  ];
  assert.deepEqual(frameCostsTable(entries), [
    '  stamp paint costs:',
    '    frame 0: evaluations made 1, solves 1, entries run 3, film misses 2, bytes uploaded 4.0 MB; bytes kept 8.0 MB, bytes in targets 3.0 MB',
    '      solved heron sheet from wash 0: 3 entries',
    "      warning: treeline.on: on 'wet' follows only applications at or below shiny 0.7: it can never hold",
    '    frames 1–2, each: evaluation memo hits 1, hidden solves skipped 1, film hits 2; bytes kept 8.0 MB, bytes in targets 2.0 MB',
    '    over 3 frames: evaluations made 1, evaluation memo hits 2, hidden solves skipped 2, solves 1, entries run 3, film hits 4, film misses 2, bytes uploaded 4.0 MB; most bytes kept 8.0 MB, most bytes in targets 3.0 MB',
  ]);
});
