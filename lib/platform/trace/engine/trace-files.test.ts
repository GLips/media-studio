// A trace recorded through a collector into a trace file, finished as Perfetto opens it: every thread's slices nest
// (siblings that overlap take lanes of their own), a failed run and a span never ended keep their status, and a flow
// binds inside the spans it links.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import type { ChromeTrace } from '../models/chrome-trace.ts';
import { openTraceCollector } from './trace-collector.ts';
import { openTraceFile } from './trace-files.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

test('a finished trace file nests every thread, and keeps failed and unfinished spans', async () => {
  await withStudioTemp('trace', async (dir) => {
    const file = openTraceFile(dir, 'render');
    const trace = openTraceCollector({ sink: file.write });
    const pass = trace.begin('frames');
    const chunk = trace.begin('frames 0–9', { parent: pass, kind: 'chunk' });
    await tick();
    // Begun inside the chunk, ending after it: it can't nest, so it takes a lane of its own.
    const overlapping = trace.begin('select', { parent: pass });
    await tick();
    chunk.end({ frames: { value: 10, unit: 'frames' } });
    const packing = trace.begin('packing', { parent: pass, track: 'packing' });
    trace.flow(chunk, packing);
    await tick();
    overlapping.end();
    packing.end();
    await assert.rejects(trace.run('encode', async () => { await tick(); throw new Error('ffmpeg died'); }, { parent: pass }));
    trace.begin('mux', { parent: pass });
    await tick();
    pass.end();

    const path = file.finish();
    assert.ok(path);
    // SAFETY: the file was just written from encodeChromeTrace's ChromeTrace.
    const { traceEvents: events } = JSON.parse(readFileSync(path, 'utf8')) as ChromeTrace;
    const slices = events.flatMap((e) => (e.ph === 'X' ? [e] : []));
    for (const tid of new Set(slices.map((s) => s.tid))) {
      const open: number[] = [];
      for (const s of slices.filter((x) => x.tid === tid).toSorted((a, b) => a.ts - b.ts || b.dur - a.dur)) {
        while (open.length && open.at(-1)! <= s.ts) open.pop();
        assert.ok(!open.length || open.at(-1)! >= s.ts + s.dur, `${s.name} overlaps its lane without nesting`);
        open.push(s.ts + s.dur);
      }
    }
    const named = (name: string) => slices.find((s) => s.name.startsWith(name))!;
    assert.notEqual(named('select').tid, named('frames 0–9').tid);
    assert.equal(named('frames 0–9').args['frames (frames)'], 10);
    assert.deepEqual([named('encode').args.status, named('encode').args.error], ['failed', 'ffmpeg died']);
    assert.equal(named('mux').args.status, 'incomplete');
    const [start, finish] = (['s', 'f'] as const).map((ph) => events.flatMap((e) => (e.ph === ph ? [e] : []))[0]);
    assert.equal(start.tid, named('frames 0–9').tid);
    assert.equal(finish.tid, named('packing').tid);
  });
});
