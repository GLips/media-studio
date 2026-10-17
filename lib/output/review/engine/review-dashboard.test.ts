import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { withStudioTemp } from '#lib/platform/temp/engine/studio-temp.ts';
import { handOverReviewPlan } from './review-dashboard.ts';
import { readReviewFile } from './review-file.ts';

test('handing the plan over records when, and a project with no storyboard.ts has no plan to hand over', async () => {
  await withStudioTemp('review-handover', async (projectDir) => {
    assert.throws(() => handOverReviewPlan(projectDir), /no storyboard\.ts/);
    writeFileSync(join(projectDir, 'storyboard.ts'), 'export const storyboard = {};\n');
    const revision = handOverReviewPlan(projectDir);
    const review = readReviewFile(projectDir);
    assert.equal(review.revision, revision);
    assert.ok(review.planHandover && !Number.isNaN(Date.parse(review.planHandover.at)));
  });
});
