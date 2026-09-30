import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoshopProbedRanges, photoshopUnprobedFields } from './photoshop-probed-ranges.ts';
import { photoshopProbes } from './photoshop-probes.ts';

test('a preset is flagged only where a setting that takes effect goes past what the probes gave it', () => {
  const ranges = photoshopProbedRanges(), { preset } = photoshopProbes().find((p) => p.preset.texture)!;
  assert.deepEqual(photoshopUnprobedFields(preset, ranges), []);
  // Airbrush build-up was never probed, nor a count past 4 once scatter is on.
  const off = { control: { kind: 'off' }, jitter: 0 } as const;
  const scatter = { scatter: { ...off, jitter: 100 }, bothAxes: true, count: 6, countDynamics: off };
  const flagged = photoshopUnprobedFields({ ...preset, scatter, buildUp: true }, ranges).map((f) => f.path);
  assert.deepEqual(flagged.toSorted(), ['buildUp', 'scatter.count']);
});
