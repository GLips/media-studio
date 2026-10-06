import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import { shotVisibilityProblem, shotVisibilityProblems } from './shot-visibility.ts';

test("visibility lies within 0..1, a problem named where its plane's entry writes it", () => {
  const visibility = new Map<string, PresentationValue<number>>([['meadow/heron', 0.5], ['meadow/sky', () => 2], ['meadow', 1.5], ['meadow/neck', -1]]);
  assert.deepEqual(shotVisibilityProblems(visibility).map(({ path, message }) => `${path}: ${message}`), [
    'meadow.visibility: 1.5; visibility is within 0..1',
    'meadow.occurrences.neck.visibility: -1; visibility is within 0..1',
  ]);
  const late = shotVisibilityProblem('meadow/sky', -0.2, 2.5);
  assert.equal(`${late?.path}: ${late?.message}`, 'meadow.occurrences.sky.visibility: -0.2 at 2.5 s; visibility is within 0..1');
});
