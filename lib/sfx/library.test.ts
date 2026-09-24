import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VOICE_LUFS } from '../studio/mix.ts';
import { renderSfx, resolveSfxParams, SFX_LOUDNESS_UNDER_VOICE } from './library.ts';
import { SFX_RECIPES } from './recipes.ts';

test('a request always renders the same samples, and another seed gives another take of the same sound', () => {
  const a = renderSfx({ sound: 'click', seed: 'click-3' }), b = renderSfx({ sound: 'click', seed: 'click-3' });
  const c = renderSfx({ sound: 'click', seed: 'click-4' });
  assert.deepEqual(a.samples, b.samples);
  assert.notDeepEqual(a.samples, c.samples);
  assert.deepEqual(a.params, c.params);
});

test('every preset sits at its category’s loudness under the voice, and lands where its event is', () => {
  for (const [name, recipe] of Object.entries(SFX_RECIPES)) {
    for (const sound of [name, ...Object.keys(recipe.presets).map((p) => `${name}.${p}`)]) {
      const r = renderSfx({ sound });
      assert.ok(Math.abs(r.lufs - (VOICE_LUFS + SFX_LOUDNESS_UNDER_VOICE[recipe.category])) < 0.1, `${sound}: ${r.lufs} LUFS`);
      assert.ok(r.landsAt >= 0 && r.landsAt <= r.seconds, `${sound} lands at ${r.landsAt} of ${r.seconds} s`);
    }
  }
  const riser = renderSfx({ sound: 'riser.short' });
  assert.equal(riser.landsAt, riser.params.duration, 'a riser peaks on its event');
});

test('mutate varies within each range, repeatably, and explicit settings win over it', () => {
  const once = resolveSfxParams({ sound: 'chime.soft', seed: 'reveal', mutate: 1, set: { brightness: 0.9 } }).params;
  const again = resolveSfxParams({ sound: 'chime.soft', seed: 'reveal', mutate: 1, set: { brightness: 0.9 } }).params;
  assert.deepEqual(once, again);
  assert.equal(once.brightness, 0.9);
  assert.equal(once.step, SFX_RECIPES.chime.defaults.step, 'mutate leaves the melody alone');
  for (const [param, { min, max }] of Object.entries(SFX_RECIPES.chime.params)) {
    assert.ok(once[param] >= min && once[param] <= max, `${param} ${once[param]}`);
  }
  assert.notDeepEqual(once, resolveSfxParams({ sound: 'chime.soft', seed: 'other', mutate: 1, set: { brightness: 0.9 } }).params);
});
