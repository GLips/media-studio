import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePhotoshopBrush, type PhotoshopReading } from './photoshop-brush.ts';
import type { PhotoshopDescriptor } from './photoshop-descriptor.ts';
import { normalizeProcreateBrush, type ProcreateReading } from './procreate-brush.ts';

const asset = (file: string) => ({ style: 'wash', pack: 'mixed', file });
const pct = (value: number) => ({ _unit: '#Prc', value });
const px = (value: number) => ({ _unit: '#Pxl', value });
const long = (value: number) => ({ _long: value });
const control = (bVTy: number, jitter: number, minimum = 0): PhotoshopDescriptor => ({ _class: 'brVr', bVTy: long(bVTy), fStp: long(25), jitter: pct(jitter), 'Mnm ': pct(minimum) });

/** Readings of plain scales, so the two sources' settings meet on their meanings, not on whatever the fits chose. */
const procreateReading: ProcreateReading = {
  taperShare: 0.5, edgeWidth: 0.05, rimSharpness: 16, wetRim: 1, grainTile: 2, grainBrightness: 0.5, grainContrast: 3, grainDepthCurve: 1, glazeFlowCurve: 1,
  blendingFlowCurve: 1, dualScale: 1, spacingPower: 1, lateralJitterScale: 1, lateralJitterPower: 1, glazeBuildLight: 1, glazeBuildUniform: 1, glazeBuildIntense: 1, glazeBuildHeavy: 1,
};
const photoshopReading: PhotoshopReading = {
  scatterSpan: 0.5, angleJitterSpan: Math.PI, hueJitterShare: 0.5, grainBrightness: 0.5, grainContrast: 3, grainDepthCurve: 1,
  wetEdgeWidth: 0.05, wetEdgeRim: 0.3, wetEdgeSharpness: 16, wetEdgeBody: 0.5, dualScale: 1,
};

test('a Procreate brush and a Photoshop preset that paint alike normalize to the same StampBrush', () => {
  const procreate = normalizeProcreateBrush('Textured Round', {
    settings: {
      maxSize: 1, blendMode: 0, renderingRecursiveMixing: true, dynamicsGlazedFlow: 0.64, plotSpacing: 0.1, shapeRoundness: 0.5, shapeRotation: 1, shapeScatter: 0.5,
      shapeCount: 3 / 16, shapeCountJitter: 0.5, shapeFlipXJitter: true, dynamicsJitterSize: 0.3, dynamicsJitterOpacity: 0.2, dynamicsPressureSize: 0.75,
      dynamicsPressureOpacity: 0.25, dynamicsPressureOpacityTransfer: 0.5, textureScale: 1.5, textureApplication: 0, textureMovement: 1, grainDepth: 0.8, grainBlendMode: 1,
      textureBrightness: 0.2, textureContrast: 0.5, dynamicsJitterHue: 0.1, dynamicsJitterSaturation: 0.3, dynamicsJitterLightness: 0.25, dynamicsJitterDarkness: 0.25,
      dualBlendMode: 1,
    },
    tip: asset('tips/round.png'), grain: asset('grains/paper.png'),
  }, { settings: { maxSize: 2, renderingRecursiveMixing: true, dynamicsGlazedFlow: 1, plotSpacing: 0.2, shapeCount: 1 / 16 }, tip: asset('tips/dual.png') }, procreateReading);

  const preset: PhotoshopDescriptor = {
    _class: 'brushPreset', 'Nm  ': 'Textured Round',
    Brsh: { _class: 'sampledBrush', Dmtr: px(100), Angl: { _unit: '#Ang', value: 0 }, Rndn: pct(50), Spcn: pct(10), Intr: true, flipX: false, flipY: false, sampledData: 'tip' },
    useTipDynamics: true, flipX: true, flipY: false, minimumDiameter: pct(25), szVr: control(2, 30), angleDynamics: control(6, 25), roundnessDynamics: control(0, 0),
    useScatter: true, bothAxes: false, 'Cnt ': 3, scatterDynamics: control(0, 0), countDynamics: control(0, 50),
    useTexture: true, Txtr: { _class: 'Ptrn', 'Nm  ': 'Paper', Idnt: 'paper' }, textureScale: pct(100), textureBrightness: long(20), textureContrast: long(50),
    textureBlendMode: { _enum: 'BlnM', value: 'Mltp' }, textureDepth: pct(80), TxtC: true, InvT: false,
    usePaintDynamics: true, opVr: control(2, 20, 75), prVr: control(2, 0, 50),
    useColorDynamics: true, colorDynamicsPerTip: true, 'H   ': pct(20), Strt: pct(30), Brgh: pct(25), purity: pct(0), clVr: control(0, 0),
    dualBrush: {
      _class: 'dualBrush', useDualBrush: true, BlnM: { _enum: 'BlnM', value: 'Mltp' }, Flip: false, useScatter: true, bothAxes: false, 'Cnt ': 1,
      scatterDynamics: control(0, 0), countDynamics: control(0, 0),
      Brsh: { _class: 'sampledBrush', Dmtr: px(200), Angl: { _unit: '#Ang', value: 0 }, Rndn: pct(100), Spcn: pct(20), Intr: true, sampledData: 'dual' },
    },
    Wtdg: false, Nose: false, 'Rpt ': false,
    toolOptions: { _class: 'PbTl', Opct: long(100), flow: long(64), 'Md  ': { _enum: 'BlnM', value: 'Nrml' } },
  };
  const photoshop = normalizePhotoshopBrush('Textured Round', {
    preset, tip: asset('tips/round.png'), dualTip: asset('tips/dual.png'), pattern: { image: asset('grains/paper.png'), width: 300 },
  }, photoshopReading);

  assert.deepEqual(photoshop.brush, procreate.brush);
  assert.equal(photoshop.brush.scatter.count, 3);
});

test("a Mixer Brush preset carries its wet mixing, noted as not yet painted, and a missing pattern drops only the texture", () => {
  const { brush, support } = normalizePhotoshopBrush('Wet Blend', {
    preset: {
      _class: 'brushPreset', Brsh: { _class: 'computedBrush', Dmtr: px(40), Hrdn: pct(0), Spcn: pct(25), Intr: true },
      useTexture: true, Txtr: { _class: 'Ptrn', 'Nm  ': 'Canvas', Idnt: 'missing' }, Wtdg: true,
      toolOptions: { _class: 'MixB', flow: long(50), wetness: 80, dryness: 40, mix: 60, sampleAllLayers: true, autoClean: true },
    },
    tip: asset('tips/round-0.png'),
  }, photoshopReading);
  assert.deepEqual(brush.wetMix, { load: 0.4, wetness: 0.8, mix: 0.6, sampleAllLayers: true });
  assert.equal(brush.grain, undefined);
  assert.equal(brush.flow, 0.25);
  assert.equal(brush.wetEdge?.rim, 0.3);
  const unsupported = support.filter((note) => note.level === 'unsupported').map((note) => note.setting);
  assert.deepEqual(unsupported, ['toolOptions.wetness, dryness, mix, sampleAllLayers', 'Txtr']);
});
