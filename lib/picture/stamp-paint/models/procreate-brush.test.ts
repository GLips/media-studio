import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeProcreateBrush, procreateGrainNegated, procreateTipNegated } from './procreate-brush.ts';

const asset = (file: string) => ({ style: 'wash', pack: 'vvds', file });

test('a dual brush reads its Sub01 as a whole second brush, sized by its largest size against the main one', () => {
  const main = {
    name: 'Wet Wash', maxSize: 2, maxOpacity: 1, dynamicsGlazedFlow: 0.8, plotSpacing: 0.1, shapeCount: 0.3125, shapeScatter: 2,
    wetEdgesAmount: 0.7, dualBlendMode: 19, textureScale: 1.5, textureApplication: 1, grainDepth: 0.2, grainBlendMode: 27, shapeInverted: true,
  };
  const sub = { maxSize: 3, dynamicsGlazedFlow: 1, plotSpacing: 0.3, shapeCount: 1, burntEdgesAmount: 0.5, renderingRecursiveMixing: true, dynamicsMix: 0.4 };
  const { brush, support } = normalizeProcreateBrush('Wet Wash', { settings: main, tip: asset('tips/wet-wash.png'), grain: asset('grains/wet-wash.png') }, { settings: sub, tip: asset('tips/wet-wash.dual.png') });

  assert.equal(brush.scatter.count, 5);
  assert.equal(brush.rotation.jitter, Math.PI);
  assert.equal(brush.accumulation, 'glaze');
  assert.deepEqual(brush.wetEdge, { width: 0.07, strength: 0.7 });
  assert.deepEqual(brush.grain, { image: asset('grains/wet-wash.png'), scale: 3.75, mode: 'texturized', depth: 0.2 });
  assert.equal(brush.dual?.blend, 'darken');
  assert.equal(brush.dual?.scale, 1.5);
  assert.equal(brush.dual?.scatter.count, 16);
  assert.equal(brush.dual?.accumulation, 'build');
  assert.deepEqual(brush.dual?.burntEdge, { width: 0.07, strength: 0.5 });
  assert.equal(brush.dual?.grain, undefined);

  const settings = support.map((note) => `${note.level} ${note.setting}`);
  assert.ok(settings.includes('unsupported grainBlendMode'));
  assert.ok(settings.includes('approximated dualBlendMode'));
  assert.ok(settings.includes('unsupported Sub01 dynamicsMix'));
  // Only settings the brush sets are noted: this one has no taper and no colour dynamics.
  assert.ok(!settings.some((setting) => /Taper|Jitter(Hue|Saturation)/.test(setting)));
});

test("Procreate paints with white, so an image is negated unless the brush inverts it", () => {
  assert.equal(procreateTipNegated({ shapeInverted: true }), false);
  assert.equal(procreateTipNegated({ shapeInverted: false }), true);
  assert.equal(procreateGrainNegated({}), true);
});
