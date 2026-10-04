// A painted shot's watch fails its work only once progress stops: a solve as long as it likes passes while its GPU
// keeps answering, and one whose GPU goes quiet fails naming where it stopped. Time is Node's mocked timers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { shotWatchName } from '../models/shot-progress.ts';
import { createShotWatch } from './shot-watch.ts';

const pending = () => new Promise<never>(() => {});

test('a solve whose GPU stops answering fails its draw, naming the solve, how far the frame got and its costs', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const costs = createStampPaintCostTally(), lines: string[] = [];
  let settled = 0;
  const watch = createShotWatch({ name: shotWatchName('heron', ['sky', 'heron']), settled: () => settled, costs, log: (line) => lines.push(line), stallSeconds: 90 });
  const draw = watch.watching('drawing 2.5 s', pending());
  watch.run({ kind: 'frame', t: 2.5 }, 3);
  watch.solving({ what: 'sky', at: 2.5 });
  costs.solved({ program: 'sky', from: 'wash', entries: 4 });
  watch.solved();
  watch.solving({ what: 'heron', at: 2.5 });
  // Answering for a minute, so its first 60 s aren't a stall; then silent.
  for (let s = 0; s < 60; s++) {
    settled++;
    t.mock.timers.tick(1000);
  }
  t.mock.timers.tick(89_000);
  let failed = false;
  void draw.catch(() => { failed = true; });
  await Promise.resolve();
  assert.equal(failed, false, 'stalled a second early');
  t.mock.timers.tick(1000);
  await assert.rejects(draw, {
    message: "scene heron's painted shot (sky, heron) stalled: no solve has finished and its GPU has answered nothing in 90 s, so the render stops. "
      + 'It was solving heron at 2.5 s cold, drawing 2.5 s, 1 of 3 solves done. This run\'s costs so far: 1 sheet program solved (4 entries), 0 film misses, 0 evictions, 0 MiB uploaded, 0 MiB kept.',
  });
  // A frame's quick solve prints nothing; a long one says it's alive while its GPU answers, and nothing once not.
  assert.deepEqual(lines, [30, 60].map((s) => `scene heron, drawing 2.5 s: still solving heron at 2.5 s cold, ${s} s in`));
  watch.dispose();
});
