// A page's batch taken into a Node trace: its times converted through the two processes' time origins land between
// the moments Node saw before and after the other process stamped them (a child Node process stands in for the page:
// both clocks are `performance.timeOrigin` plus `now()`), and its top spans go under the span that opened the page.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import type { PageTraceBatch } from '../models/page-trace-batch.ts';
import { openTraceCollector, traceClock } from './trace-collector.ts';
import { createPageTraceIntake } from './page-trace-intake.ts';

test("a page's batch lands on Node's clock, between when Node asked and when it heard", async () => {
  const before = traceClock();
  const { stdout } = await promisify(execFile)(process.execPath, ['-e', 'console.log(JSON.stringify([performance.timeOrigin, performance.now()]))']);
  const heard = traceClock();
  // SAFETY: the child prints the pair above.
  const [timeOrigin, now] = JSON.parse(stdout) as [number, number];
  const trace = openTraceCollector(), chunk = trace.begin('frames 0–9');
  const batch: PageTraceBatch = {
    producer: { id: 'page-a', name: 'page' }, timeOrigin, seq: 0, dropped: 0, final: false, sentAt: now,
    records: [
      { record: 'begin', id: 'page-a:0', producer: 'page-a', parent: null, name: 'first draw', track: 'main', start: now - 1 },
      { record: 'end', id: 'page-a:0', end: now, status: 'ok' },
    ],
  };
  createPageTraceIntake({ trace, parent: chunk.id, name: 'frames 0–9' })(batch);
  const drawn = trace.trace().spans.find((s) => s.name === 'first draw')!;
  // A millisecond either way: each time origin is the wall clock read once, at a sub-millisecond grain.
  assert.ok(drawn.end >= before - 0.001 && drawn.end <= heard + 0.001, `converted ${drawn.end} s, outside ${before}–${heard} s`);
  assert.equal(drawn.parent, chunk.id);
  const page = trace.trace().producers.find((p) => p.id === 'page-a')!;
  assert.equal(page.name, 'frames 0–9: page 1');
  assert.ok(page.clock && page.clock.lagMs > -1);
});
