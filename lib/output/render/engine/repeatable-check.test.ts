// Runs checkFramesRepeatable on repeatable-check/video.tsx, whose frame differs by one level at one pixel on a tab's
// first draw: a difference far above the PSNR bar, which passes but mustn't be reported identical.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkFramesRepeatable } from './render-pipeline.ts';
import { openRenderSession } from './render-session.ts';
import { withFixtureStudioProject } from './fixture-studio-project.ts';

test('a one-level difference at one pixel passes the PSNR bar but is not reported identical', async () => {
  const { ok, report } = await withFixtureStudioProject('repeatable-check', join(import.meta.dirname, 'repeatable-check'),
    async (project) => checkFramesRepeatable(await openRenderSession(project), [1]));
  assert.ok(ok, report.join('\n'));
  assert.match(report[0], /✓ 1\.00s {2}\d+\.\d dB at worst/, report.join('\n'));
});
