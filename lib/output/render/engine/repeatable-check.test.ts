// Runs checkFramesRepeatable on repeatable-check/video.tsx, whose frame differs by one level at one pixel on a tab's
// first draw: a difference far above the PSNR bar, which passes but mustn't be reported identical.
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkFramesRepeatable } from './render-pipeline.ts';
import { openRenderSession } from './render-session.ts';
import { STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';

test('a one-level difference at one pixel passes the PSNR bar but is not reported identical', async () => {
  // A throwaway studio, linked back to this checkout as motion-calibration.test.ts's is.
  const { ok, report } = await withStudioTemp('repeatable-check', async (studio) => {
    for (const linked of ['package.json', 'lib', 'node_modules']) symlinkSync(join(STUDIO_ROOT, linked), join(studio, linked));
    const project = join(studio, 'work', 'projects', 'repeatable-check');
    mkdirSync(project, { recursive: true });
    copyFileSync(join(import.meta.dirname, 'repeatable-check', 'video.tsx'), join(project, 'video.tsx'));
    return checkFramesRepeatable(await openRenderSession(project), [1]);
  });
  assert.ok(ok, report.join('\n'));
  assert.match(report[0], /✓ 1\.00s {2}\d+\.\d dB at worst/, report.join('\n'));
});
