// A painted shot's watch fails its work only once progress stops: a solve as long as it likes passes while its GPU
// keeps answering, and one whose GPU goes quiet fails naming where it stopped, as its browser's failure, which a
// chunked render draws again. Time is Node's mocked timers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStampPaintCostTally } from '#lib/paint/painting/models/stamp-paint-costs.ts';
import { isRenderBrowserFailure } from '#lib/platform/browser/models/render-browser-failure.ts';
import { shotWatchName } from '../models/shot-progress.ts';
import { createShotWatch } from './shot-watch.ts';

const pending = () => new Promise<never>(() => {});

test('a solve whose GPU stops answering fails its draw, naming the solve, how far the frame got and its costs so far', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const costs = createStampPaintCostTally(), lines: string[] = [];
  // The device as the frame began: what the run evicted and uploaded is read against it, as the run stalls.
  const gpu = { checksSettled: 0, evictions: 5, uploaded: 2 ** 20, kept: 0 };
  let pulses = 0;
  const watch = createShotWatch({
    name: shotWatchName('heron', ['sky', 'heron']), gpu: () => gpu, costs, log: (line) => lines.push(line), pulse: () => pulses++, stallSeconds: 90,
  });
  const draw = watch.watching('drawing 2.5 s', pending());
  watch.run({ kind: 'frame', t: 2.5 }, 3);
  watch.solving({ what: 'sky', at: 2.5 });
  costs.solved({ program: 'sky', from: 'wash', entries: 4 });
  watch.solved();
  watch.solving({ what: 'heron', at: 2.5 });
  // Answering for a minute, evicting and uploading as it goes, so its first 60 s aren't a stall; then silent.
  for (let s = 0; s < 60; s++) {
    Object.assign(gpu, { checksSettled: gpu.checksSettled + 1, evictions: gpu.evictions + 1, uploaded: gpu.uploaded + 2 ** 20, kept: 96 * 2 ** 20 });
    t.mock.timers.tick(1000);
  }
  t.mock.timers.tick(89_000);
  let failed = false;
  void draw.catch(() => { failed = true; });
  await Promise.resolve();
  assert.equal(failed, false, 'stalled a second early');
  t.mock.timers.tick(1000);
  const error = await draw.then(() => assert.fail('the stalled draw passed'), (stalled: Error) => stalled);
  assert.equal(error.message.replace(/ \[.*\]$/, ''), "scene heron's painted shot (sky, heron) stalled: no solve has finished and its GPU has answered nothing in 90 s, so the render stops. "
    + 'It was solving heron at 2.5 s cold, drawing 2.5 s, 1 of 3 solves done. This run\'s costs so far: 1 sheet program solved (4 entries), 0 film misses, 60 evictions, 60 MiB uploaded, 96 MiB kept.');
  assert.ok(isRenderBrowserFailure(error.message), error.message);
  // A frame's quick solve prints nothing; a long one says it's alive while its GPU answers, and nothing once not.
  assert.deepEqual(lines, [30, 60].map((s) => `scene heron, drawing 2.5 s: still solving heron at 2.5 s cold, ${s} s in`));
  assert.equal(pulses, 4, 'a pulse every 15 s of progress, none once quiet');
  watch.dispose();
});
