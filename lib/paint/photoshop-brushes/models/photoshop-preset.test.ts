import assert from 'node:assert/strict';
import { test } from 'node:test';
import { photoshopProbes } from './photoshop-probes.ts';
import { photoshopPresetMismatches, photoshopPresetScript, readPhotoshopPreset, type PhotoshopScriptDescriptor } from './photoshop-preset.ts';

/** What Photoshop reads back after taking `script` whole, as photoshop-actions.jsxinc's descToObj names it. */
function readBack(script: PhotoshopScriptDescriptor): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(script)) {
    if (key === '_class' && typeof v === 'string') out._class = v.slice(2);
    else if (v && typeof v === 'object') {
      if ('_unit' in v) out[key.slice(2)] = { value: v.value, unit: v._unit };
      else if ('_long' in v) out[key.slice(2)] = v._long;
      else if ('_enum' in v && typeof v.value === 'string') out[key.slice(2)] = v.value.slice(2);
      else out[key.slice(2)] = readBack(v);
    } else out[key.slice(2)] = v;
  }
  return out;
}

test("every probe's script reads back as its preset, and a sampled tip that came back computed is reported", () => {
  for (const { name, preset } of photoshopProbes()) assert.deepEqual(photoshopPresetMismatches(preset, readBack(photoshopPresetScript(preset))), [], name);
  const { preset } = photoshopProbes().find((p) => p.preset.tip.kind === 'sampled')!, applied = readBack(photoshopPresetScript(preset));
  // What `set` on the Brsh target does to a sampled tip: a soft computed round in its place.
  const softRound = { ...applied, brush: { ...(applied.brush as object), _class: 'computedBrush' } };
  assert.deepEqual(photoshopPresetMismatches(preset, softRound), ['tip.kind: asked "sampledBrush", read "computedBrush"']);
});

test('a tip class, control code, mode or tool the studio doesn\'t know reads as unsupported, naming it', () => {
  const preset = readPhotoshopPreset({
    _class: 'brushPreset', Brsh: { _class: 'futureTip' },
    useTipDynamics: true, szVr: { _class: 'brVr', bVTy: { _long: 99 } },
    useTexture: true, textureBlendMode: { _enum: 'BlnM', value: 'Nrml' },
    dualBrush: { _class: 'dualBrush', useDualBrush: true, BlnM: { _enum: 'BlnM', value: 'Wrd ' } },
    toolOptions: { _class: 'ErTl' },
  });
  assert.deepEqual(preset.tip, { kind: 'unsupported', classId: 'futureTip' });
  assert.deepEqual(preset.tipDynamics?.size.control, { kind: 'unsupported', code: 99 });
  assert.deepEqual(preset.texture?.mode, { kind: 'unsupported', mode: 'normal' });
  assert.deepEqual(preset.dual?.mode, { kind: 'unsupported', mode: 'Wrd ' });
  assert.equal(preset.tool?.kind, 'unsupported');
});
