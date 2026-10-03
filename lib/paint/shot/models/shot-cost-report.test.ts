import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameCostsTable } from '#lib/picture/profiling/models/frame-costs-table.ts';
import { createShotCostTally, SHOT_FRAME_COSTS_LABEL, shotCostsProfileEntry } from './shot-cost-report.ts';

test('a shot\'s costs table per frame, frames that cost alike as one line, a solve noted under its frame, then the span', () => {
  const tally = createShotCostTally();
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
      costs.retained(8_000_000);
    }),
    ...[1, 2].map((n) => frame(n, (costs) => {
      costs.count('evaluation memo hits');
      costs.count('film hits', 2);
      costs.retained(8_000_000);
    })),
  ];
  assert.deepEqual(frameCostsTable(entries), [
    '  stamp paint costs:',
    '    frame 0: evaluations made 1, solves 1, entries run 3, film misses 2, bytes uploaded 4.0 MB; bytes retained 8.0 MB',
    '      solved heron sheet from wash 0: 3 entries',
    '    frames 1–2, each: evaluation memo hits 1, film hits 2; bytes retained 8.0 MB',
    '    over 3 frames: evaluations made 1, evaluation memo hits 2, solves 1, entries run 3, film hits 4, film misses 2, bytes uploaded 4.0 MB; most bytes retained 8.0 MB',
  ]);
});
