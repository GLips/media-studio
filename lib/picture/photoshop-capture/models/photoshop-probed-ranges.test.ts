import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PhotoshopDescriptor } from '#lib/picture/stamp-paint/models/photoshop-descriptor.ts';
import { photoshopProbePreset } from './photoshop-probe-preset.ts';
import { photoshopProbedRanges, photoshopUnprobedFields } from './photoshop-probed-ranges.ts';
import { photoshopProbes } from './photoshop-probes.ts';

test('a preset is flagged only where a setting that takes effect goes past what the probes gave it', () => {
  const ranges = photoshopProbedRanges(), probe = photoshopProbes().find((p) => p.settings.texture)!;
  const preset = photoshopProbePreset(probe.name, probe.settings);
  assert.deepEqual(photoshopUnprobedFields(preset, ranges), []);
  // Airbrush build-up was never probed, nor a count past 4 once scatter is on.
  const scatter = { useScatter: true, bothAxes: true, scatterDynamics: { ...(preset.scatterDynamics as PhotoshopDescriptor), jitter: { _unit: '#Prc', value: 100 } } };
  const flagged = photoshopUnprobedFields({ ...preset, ...scatter, 'Rpt ': true, 'Cnt ': 6 }, ranges).map((f) => f.path);
  assert.deepEqual(flagged.sort(), ['Cnt ', 'Rpt ']);
  // A texture switched off keeps its settings, which paint nothing.
  assert.deepEqual(photoshopUnprobedFields({ ...preset, useTexture: false, textureScale: { _unit: '#Prc', value: 1000 } }, ranges), []);
});
