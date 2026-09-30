import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoshopProbePreset } from '#lib/picture/photoshop-capture/models/photoshop-probe-preset.ts';
import { photoshopProbes } from '#lib/picture/photoshop-capture/models/photoshop-probes.ts';
import { photoshopPresetMismatches, photoshopPresetScript, type PhotoshopScriptDescriptor } from './photoshop-preset.ts';

/** What Photoshop reads back after taking `script` whole, as photoshop-actions.jsxinc's descToObj names it. */
function readBack(script: PhotoshopScriptDescriptor): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(script)) {
    if (key === '_class') out._class = (v as string).slice(2);
    else if (v && typeof v === 'object') {
      if ('_unit' in v) out[key.slice(2)] = { value: v.value, unit: v._unit };
      else if ('_long' in v) out[key.slice(2)] = v._long;
      else if ('_enum' in v) out[key.slice(2)] = (v.value as string).slice(2);
      else out[key.slice(2)] = readBack(v as PhotoshopScriptDescriptor);
    } else out[key.slice(2)] = v;
  }
  return out;
}

test("every probe's script reads back as its preset, and a sampled tip that came back computed is reported", () => {
  for (const probe of photoshopProbes()) {
    const preset = photoshopProbePreset(probe.name, probe.settings);
    assert.deepEqual(photoshopPresetMismatches(preset, readBack(photoshopPresetScript(preset))), [], probe.name);
  }
  const sampled = photoshopProbes().find((p) => p.settings.tip.kind === 'sampled')!;
  const preset = photoshopProbePreset(sampled.name, sampled.settings), applied = readBack(photoshopPresetScript(preset));
  // What `set` on the Brsh target does to a sampled tip: a soft computed round in its place.
  const softRound = { ...applied, brush: { ...(applied.brush as object), _class: 'computedBrush' } };
  assert.deepEqual(photoshopPresetMismatches(preset, softRound), ['tip.kind: asked "sampledBrush", read "computedBrush"']);
});
