// A chunk's startup read from its spans: each step with its children, the solves under the first draw summed, and
// the time no step covers; a window (the startup itself) has no self time.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRACE_WINDOW_KIND, type TraceSpan } from './trace-model.ts';
import { traceChunkStartups, traceTimeByName } from './trace-summary.ts';

const span = (id: string, parent: string | null, name: string, start: number, end: number, kind?: string): TraceSpan =>
  ({ id, producer: id.split(':')[0], parent, name, track: 'main', start, end, status: 'ok', ...(kind && { kind }) });

test("a chunk's startup is its steps, its solves and the time between them", () => {
  const spans = [
    span('node:0', null, 'frames 0–9', 10, 50, 'chunk'),
    span('node:1', 'node:0', 'startup', 10, 40, TRACE_WINDOW_KIND),
    span('node:2', 'node:0', 'browser launch', 10, 11),
    span('page:0', 'node:0', 'painted shot load', 12, 13),
    span('page:1', 'page:0', 'compile', 12, 12.5),
    span('page:2', 'node:0', 'first draw', 13, 39),
    span('page:3', 'page:2', 'solve shore', 13, 30, 'solve'),
    span('page:4', 'page:2', 'solve sky', 30, 38, 'solve'),
    span('page:5', 'node:0', 'shot frame', 41, 42),
  ];
  const [startup] = traceChunkStartups(spans);
  assert.equal(startup.seconds, 30);
  assert.deepEqual(startup.phases.map((p) => [p.name, p.depth]), [['browser launch', 0], ['painted shot load', 0], ['compile', 1], ['first draw', 0]]);
  assert.deepEqual(startup.solves.map((s) => [s.under, s.count, s.seconds, s.longest[0].name]), [['first draw', 2, 25, 'solve shore']]);
  // 11–12 and 39–40 are no step's.
  assert.equal(startup.unexplained, 2);
  const byName = new Map(traceTimeByName(spans).map((t) => [t.name, t]));
  assert.equal(byName.get('startup')!.selfSeconds, 0);
  assert.equal(byName.get('first draw')!.selfSeconds, 1);
});
