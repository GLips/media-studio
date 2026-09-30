import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeProcreateBrush, procreateGrainNegated, procreateTipNegated } from './procreate-brush.ts';

const asset = (file: string) => ({ style: 'wash', pack: 'vvds', file });
/** A reading of plain scales, so the test reads the settings, not whatever the fit last chose. */
const reading = { taperShare: 0.5, edgeWidth: 0.035, rimSharpness: 16, wetRim: 1, grainTile: 2.5, grainBrightness: 0.5, grainContrast: 3, grainDepthCurve: 1, glazeFlowCurve: 1, blendingFlowCurve: 1, dualScale: 1, spacingPower: 1, lateralJitterScale: 1, lateralJitterPower: 0.5, glazeBuildLight: 0, glazeBuildUniform: 0, glazeBuildIntense: 0, glazeBuildHeavy: 0 };

test('a dual brush reads its Sub01 as a whole second brush, sized by its largest size against the main one', () => {
  const main = {
    name: 'Wet Wash', maxSize: 2, maxOpacity: 1, dynamicsGlazedFlow: 0.8, plotSpacing: 0.1, shapeCount: 0.3125, shapeScatter: 2,
    wetEdgesAmount: 0.7, dualBlendMode: 19, textureScale: 1.5, textureApplication: 1, grainDepth: 0.2, grainBlendMode: 27, shapeInverted: true,
    dynamicsTiltOpacity: 0.2,
  };
  const sub = { maxSize: 3, dynamicsGlazedFlow: 1, plotSpacing: 0.3, shapeCount: 1, burntEdgesAmount: 0.5, renderingRecursiveMixing: true, dynamicsMix: 0.4 };
  const { brush, support } = normalizeProcreateBrush('Wet Wash', { settings: main, tip: asset('tips/wet-wash.png'), grain: asset('grains/wet-wash.png') }, { settings: sub, tip: asset('tips/wet-wash.dual.png') }, reading);

  assert.equal(brush.scatter.count, 5);
  assert.equal(brush.rotation.jitter, Math.PI);
  assert.equal(brush.accumulation.kind, 'glaze');
  assert.equal(brush.wetEdges?.kind === 'rim' && brush.wetEdges.rim, 0.7);
  assert.equal(brush.grain?.kind, 'canvas');
  assert.equal(brush.grain?.blend.mode, 'height');
  assert.equal(brush.grain?.scale, 3.75);
  assert.equal(brush.dual?.blend.mode, 'darken');
  assert.equal(brush.dual?.scale, 1.5);
  assert.equal(brush.dual?.scatter.count, 16);
  assert.deepEqual(brush.dual?.accumulation, { kind: 'build' });
  assert.equal(brush.dual?.burntEdge?.strength, 0.5);
  assert.equal(brush.dual?.grain, undefined);

  const settings = support.map((note) => `${note.level} ${note.setting}`);
  assert.ok(settings.includes('approximated dualBlendMode'));
  // Wet mixing belongs to the wet-paint model, and a stylus's tilt has no meaning for a painting drawn from a path.
  assert.ok(settings.includes('unsupported Sub01 dynamicsMix'));
  assert.ok(settings.includes('inapplicable dynamicsTiltOpacity'));
  assert.deepEqual(settings.filter((setting) => setting.startsWith('unsupported')), ['unsupported Sub01 dynamicsMix']);
  // Only settings the brush sets are noted: this one has no taper and no colour dynamics.
  assert.ok(!settings.some((setting) => /Taper|Jitter(Hue|Saturation)/.test(setting)));
});

test("Procreate paints with white, so an image is negated unless the brush inverts it", () => {
  assert.equal(procreateTipNegated({ shapeInverted: true }), false);
  assert.equal(procreateTipNegated({ shapeInverted: false }), true);
  assert.equal(procreateGrainNegated({}), true);
});
