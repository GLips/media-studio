import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { loadRenderSnapshot, renderSnapshotPath, writeRenderSnapshot, type RenderSnapshot, type RenderSource } from './render-snapshot.ts';

const timeline = (title: string): TimelineReport => ({
  title, fps: 30, width: 1920, height: 1080, transparent: false, duration: 10, durationInFrames: 300, scenes: [], cues: [], crossfades: [], expectations: [], sfxCueList: false, beatClicks: false, sounds: [], captions: null,
});

const source: RenderSource = { engine: { commit: 'c2f33d98', dirty: true }, workspace: { commit: '3f2e1a0', dirty: false } };

test('a render reads back the timeline and commits it was made with, and a file replaced without a snapshot reads as having none', () => {
  withStudioTemp('render-snapshot', (dir) => {
    const render = join(dir, '03.mp4');
    writeFileSync(render, 'bar three, as first rendered');
    writeRenderSnapshot(render, { frames: { from: 120, end: 240 }, timeline: timeline('before the retime'), clock: null, voice: null, gpu: 'ANGLE (Apple M1 Max); WebGPU apple metal-3', source });

    const loaded = loadRenderSnapshot(render);
    assert.equal(loaded.kind, 'snapshot');
    assert.deepEqual(loaded.kind === 'snapshot' && [loaded.snapshot.timeline.title, loaded.snapshot.frames, loaded.snapshot.source], ['before the retime', { from: 120, end: 240 }, source]);

    writeFileSync(render, 'bar three, rendered again by something that wrote no snapshot');
    const replaced = loadRenderSnapshot(render);
    assert.equal(replaced.kind, 'none');
    assert.match(replaced.kind === 'none' ? replaced.reason : '', /made without one/);
  });
});

test('a snapshot of an older version reads as none, asking for the render again', () => {
  withStudioTemp('render-snapshot', (dir) => {
    const render = join(dir, 'video.mp4');
    writeFileSync(render, 'a render from last week');
    writeRenderSnapshot(render, { frames: { from: 0, end: 300 }, timeline: timeline('last week'), clock: null, voice: null, gpu: 'Apple M1 Max', source });
    // SAFETY: writeRenderSnapshot just wrote it.
    const written = JSON.parse(readFileSync(renderSnapshotPath(render), 'utf8')) as RenderSnapshot;
    writeFileSync(renderSnapshotPath(render), JSON.stringify({ version: 10, render: written.render, frames: written.frames, timeline: written.timeline }));

    const loaded = loadRenderSnapshot(render);
    assert.equal(loaded.kind, 'none');
    assert.match(loaded.kind === 'none' ? loaded.reason : '', /version 10.*render it again/);
  });
});
