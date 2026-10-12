import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { archiveRender } from '#lib/output/render/engine/render-archive.ts';
import { RENDER_SNAPSHOT_VERSION, renderFileStamp, type RenderSnapshot } from '#lib/output/render/engine/render-snapshot.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { listReviewRenderVersionsIn } from './review-history.ts';

/** Archives a render whose bytes say `name`, returning its hash. */
function archiveVersion(projectDir: string, path: string, name: string, made: string): string {
  const file = join(projectDir, path.split('/').at(-1)!);
  writeFileSync(file, `render ${name}`);
  const { hash } = renderFileStamp(file);
  const snapshot: RenderSnapshot = {
    version: RENDER_SNAPSHOT_VERSION, render: { file: path.split('/').at(-1)!, path, hash }, frames: { from: 0, end: 30 }, made, clock: null, voice: null, gpu: 'Apple M1 Max',
    timeline: { title: 'history', fps: 30, width: 1080, height: 1920, transparent: false, duration: 1, durationInFrames: 30, scenes: [], cues: [], crossfades: [], expectations: [], sfxCueList: false, beatClicks: false, sounds: [], captions: null },
    source: { engine: { commit: made.slice(0, 10), dirty: false }, workspace: null },
  };
  archiveRender(projectDir, file, snapshot);
  return hash;
}

test("a render path's kept versions are numbered oldest first, apart from another path's", () => {
  withStudioTemp('review-history', (projectDir) => {
    const later = archiveVersion(projectDir, 'out/video.mp4', 'the later cut', '2026-10-03T00:00:00.000Z');
    archiveVersion(projectDir, 'out/wip/animatic.mp4', 'the animatic', '2026-10-02T00:00:00.000Z');
    const first = archiveVersion(projectDir, 'out/video.mp4', 'the first cut', '2026-10-01T00:00:00.000Z');

    assert.deepEqual(listReviewRenderVersionsIn(projectDir, 'out/video.mp4').map(({ r, hash, file }) => ({ r, hash, file })), [
      { r: 1, hash: first, file: `out/.history/${first}/video.mp4` },
      { r: 2, hash: later, file: `out/.history/${later}/video.mp4` },
    ]);
  });
});
