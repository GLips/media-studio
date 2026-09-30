import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoshopProbePreset } from './photoshop-probe-preset.ts';
import { photoshopProbedRanges, photoshopUnprobedFields } from './photoshop-probed-ranges.ts';
import { photoshopProbes } from './photoshop-probes.ts';

test('a preset is flagged only where a setting that takes effect goes past what the probes gave it', () => {
  const ranges = photoshopProbedRanges(), probe = photoshopProbes().find((p) => p.settings.texture)!;
  const preset = photoshopProbePreset(probe.name, probe.settings);
  assert.deepEqual(photoshopUnprobedFields(preset, ranges), []);
  // Airbrush build-up was never probed, nor a count past 4 once scatter is on.
  const off = { control: 'off', fadeSteps: 25, jitter: 0, minimum: 0 } as const;
  const scatter = { scatter: { ...off, jitter: 100 }, bothAxes: true, count: 6, countDynamics: off };
  const flagged = photoshopUnprobedFields({ ...preset, scatter, buildUp: true }, ranges).map((f) => f.path);
  assert.deepEqual(flagged.sort(), ['buildUp', 'scatter.count']);
});
