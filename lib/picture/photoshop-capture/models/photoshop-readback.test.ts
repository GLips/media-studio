import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoshopProbes } from './photoshop-probes.ts';
import { photoshopSettingsMismatches } from './photoshop-readback.ts';

const pct = (value: number) => ({ value, unit: 'percentUnit' });
const off = { bVTy: 0, fStp: 25, jitter: pct(0), minimum: pct(0), _class: 'brVr' };

test("a probe's read-back that holds its settings passes, and a sampled tip that came back computed is reported", () => {
  const probe = photoshopProbes().find((p) => p.name === 'tip sampled angle 30')!;
  const { tip } = probe.settings;
  const applied = {
    brush: { diameter: { value: tip.diameter, unit: 'pixelsUnit' }, angle: { value: tip.angle, unit: 'angleUnit' }, roundness: pct(tip.roundness), spacing: pct(tip.spacing), flipX: false, flipY: false, _class: 'sampledBrush' },
    opacity: 100, flow: 100, mode: 'normal', wetEdges: false, noise: false, repeat: false,
    useTipDynamics: false, szVr: off, usePaintDynamics: false, opVr: off, prVr: off, useScatter: false, useTexture: false,
    dualBrush: { useDualBrush: false, _class: 'dualBrush' },
  };
  assert.deepEqual(photoshopSettingsMismatches(probe.settings, applied), []);
  // What `set` on the Brsh target does to a sampled tip: a soft computed round in its place.
  const softRound = { ...applied, brush: { ...applied.brush, hardness: pct(0), _class: 'computedBrush' } };
  assert.deepEqual(photoshopSettingsMismatches(probe.settings, softRound), ['tip kind: asked "sampledBrush", read "computedBrush"']);
});
