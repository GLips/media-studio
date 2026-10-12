import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TimelineReport } from '#lib/picture/video/models/timeline-report.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { archiveRender, listRenderArchive, pruneRenderArchive } from './render-archive.ts';
import { RENDER_SNAPSHOT_VERSION, renderFileStamp, type RenderSnapshot } from './render-snapshot.ts';

const timeline: TimelineReport = {
  title: 'archive', fps: 30, width: 1920, height: 1080, transparent: false, duration: 10, durationInFrames: 300, scenes: [], cues: [], crossfades: [], expectations: [], sfxCueList: false, beatClicks: false, sounds: [], captions: null,
};

/** Archives a render whose bytes say `name`, returning its hash. */
function archiveVersion(projectDir: string, path: string, name: string, made: string): string {
  const file = join(projectDir, path.split('/').at(-1)!);
  writeFileSync(file, `render ${name}`);
  const { hash } = renderFileStamp(file);
  const snapshot: RenderSnapshot = {
    version: RENDER_SNAPSHOT_VERSION, render: { file: path.split('/').at(-1)!, path, hash }, frames: { from: 0, end: 300 }, made, timeline, clock: null,
    voice: null, gpu: 'Apple M1 Max', source: { engine: { commit: 'c2f33d98', dirty: false }, workspace: null },
  };
  archiveRender(projectDir, file, snapshot);
  return hash;
}

test('a prune keeps the newest 8 of each path and every referenced version, and drops the rest', () => {
  withStudioTemp('render-archive', (projectDir) => {
    const animatic = archiveVersion(projectDir, 'out/wip/animatic.mp4', 'animatic', '2026-09-30T00:00:00.000Z');
    const finals = Array.from({ length: 11 }, (_, i) => archiveVersion(projectDir, 'out/video.mp4', `final ${i}`, `2026-10-0${1 + Math.floor(i / 9)}T0${i % 9}:00:00.000Z`));

    // The first final has a note written on it; the second and third are neither recent nor referenced.
    const dropped = pruneRenderArchive(projectDir, new Set([finals[0]]));

    assert.deepEqual(dropped.toSorted(), finals.slice(1, 3).toSorted());
    assert.deepEqual(listRenderArchive(projectDir).map((e) => e.hash), [animatic, finals[0], ...finals.slice(3)]);
  });
});
