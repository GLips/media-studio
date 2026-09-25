import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TimelineReport } from '../../studio/Video.tsx';
import { loadRenderSnapshot, writeRenderSnapshot } from './render-snapshot.ts';

const timeline = (title: string): TimelineReport => ({
  title, fps: 30, duration: 10, durationInFrames: 300, scenes: [], cues: [], crossfades: [], expectations: [], sfxCueList: false, sounds: [],
});

test('a render reads back the timeline it was made with, and a file replaced without a snapshot reads as having none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'render-snapshot-'));
  try {
    const render = join(dir, '03.mp4');
    writeFileSync(render, 'bar three, as first rendered');
    writeRenderSnapshot(render, { frames: { from: 120, end: 240 }, timeline: timeline('before the retime') });

    const loaded = loadRenderSnapshot(render);
    assert.equal(loaded.kind, 'snapshot');
    assert.deepEqual(loaded.kind === 'snapshot' && [loaded.snapshot.timeline.title, loaded.snapshot.frames], ['before the retime', { from: 120, end: 240 }]);

    writeFileSync(render, 'bar three, rendered again by something that wrote no snapshot');
    const replaced = loadRenderSnapshot(render);
    assert.equal(replaced.kind, 'none');
    assert.match(replaced.kind === 'none' ? replaced.reason : '', /made without one/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
