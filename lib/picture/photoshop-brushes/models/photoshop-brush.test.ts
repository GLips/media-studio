import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePhotoshopBrush, type PhotoshopReading } from './photoshop-brush.ts';
import { PHOTOSHOP_POOLING } from '#lib/picture/stamp-paint/models/coverage-formulas.ts';
import type { PhotoshopDescriptor } from './photoshop-descriptor.ts';
import { readPhotoshopPreset } from './photoshop-preset.ts';
import { normalizeProcreateBrush, type ProcreateReading } from '#lib/picture/procreate-brushes/models/procreate-brush.ts';

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
  scatterSpan: 0.5, angleJitterSpan: Math.PI, hueJitterShare: 0.5, dualScale: 1,
};

test('a Procreate brush and a Photoshop preset that paint alike normalize to the same StampBrush', () => {
  const procreate = normalizeProcreateBrush('Textured Round', {
    settings: {
      maxSize: 1, blendMode: 0, renderingRecursiveMixing: true, dynamicsGlazedFlow: 0.64, plotSpacing: 0.1, shapeRoundness: 0.5, shapeRotation: 1, shapeScatter: 0.5,
      shapeCount: 3 / 16, shapeCountJitter: 0.5, shapeFlipXJitter: true, dynamicsJitterSize: 0.3, dynamicsJitterOpacity: 0.2, dynamicsPressureSize: 0.75,
      dynamicsPressureOpacity: 0.25, dynamicsPressureOpacityTransfer: 0.5, textureScale: 1.5, textureApplication: 0, textureMovement: 1, grainDepth: 0.8, grainBlendMode: 1,
      textureBrightness: 40 / 255, textureContrast: 0.5, dynamicsJitterHue: 0.1, dynamicsJitterSaturation: 0.3, dynamicsJitterLightness: 0.25, dynamicsJitterDarkness: 0.25,
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
    preset: readPhotoshopPreset(preset), tip: asset('tips/round.png'), dualTip: asset('tips/dual.png'), pattern: { image: asset('grains/paper.png'), width: 300 },
  }, photoshopReading);

  // Photoshop steps by each stamp's own size and its short side (its roundness is 0.5), where Procreate spreads its
  // steps along the stroke, and holds flow in 255ths. The two build, sample tips, cut and tile grain, adjust it and
  // combine a dual as each was identified or fitted to.
  const photoshopWays = { accumulation: { kind: 'buildToOpacity' }, stepping: 'eachStamp' } as const;
  assert.deepEqual(photoshop.brush, {
    ...procreate.brush, ...photoshopWays, spacing: procreate.brush.spacing * 0.5, flow: 163 / 255,
    tip: { ...procreate.brush.tip, sampling: 'anisotropic' },
    grain: { ...procreate.brush.grain!, blend: { family: 'texture', mode: procreate.brush.grain!.blend.mode }, contrastPivot: 'midGrey', tiling: 'repeat' },
    dual: { ...procreate.brush.dual!, ...photoshopWays, tip: { ...procreate.brush.dual!.tip, sampling: 'anisotropic' }, blend: { family: 'texture', mode: procreate.brush.dual!.blend.mode } },
  });
  assert.equal(photoshop.brush.scatter.count, 3);
});

test("a Mixer Brush preset carries its wet mixing, noted as not yet painted, and a missing pattern drops only the texture", () => {
  const { brush, support } = normalizePhotoshopBrush('Wet Blend', {
    preset: readPhotoshopPreset({
      _class: 'brushPreset', Brsh: { _class: 'computedBrush', Dmtr: px(40), Hrdn: pct(0), Spcn: pct(25), Intr: true },
      useTexture: true, Txtr: { _class: 'Ptrn', 'Nm  ': 'Canvas', Idnt: 'missing' }, Wtdg: true,
      toolOptions: { _class: 'MixB', flow: long(50), wetness: 80, dryness: 40, mix: 60, sampleAllLayers: true, autoClean: true },
    }),
    tip: asset('tips/round-0.png'),
  }, photoshopReading);
  assert.deepEqual(brush.wetMix, { load: 0.4, wetness: 0.8, mix: 0.6, sampleAllLayers: true });
  assert.equal(brush.grain, undefined);
  // Wet edges pool the built coverage; they no longer thin the flow.
  assert.equal(brush.flow, 128 / 255);
  assert.deepEqual(brush.wetEdges, PHOTOSHOP_POOLING);
  assert.ok(brush.tip.span! > 1, "a soft computed tip's image reaches past its diameter");
  const unsupported = support.filter((note) => note.level === 'unsupported').map((note) => note.setting);
  assert.deepEqual(unsupported, ['tool.wetness, dryness, mix, sampleAllLayers', 'texture.pattern']);
});

test('a texture reads as Photoshop sets it: its mode, its depth in 255ths, its brightness in 255ths and its contrast', () => {
  const { brush, support } = normalizePhotoshopBrush('Overlay', {
    preset: readPhotoshopPreset({
      _class: 'brushPreset', Brsh: { _class: 'computedBrush', Dmtr: px(100), Hrdn: pct(100), Spcn: pct(1), Intr: true },
      useTexture: true, Txtr: { _class: 'Ptrn', 'Nm  ': 'Paper', Idnt: 'paper' }, textureBlendMode: { _enum: 'BlnM', value: 'Ovrl' },
      textureDepth: pct(33), textureBrightness: long(-51), textureContrast: long(-50), textureScale: pct(100), TxtC: false,
    }),
    tip: asset('tips/round-100-100.png'), pattern: { image: asset('grains/paper.png'), width: 256 },
  }, photoshopReading);
  assert.deepEqual(
    { blend: brush.grain?.blend, depth: brush.grain?.depth, brightness: brush.grain?.brightness, contrast: brush.grain?.contrast, spacing: brush.spacing },
    { blend: { family: 'texture', mode: 'overlay' }, depth: 84 / 255, brightness: -0.2, contrast: -0.5, spacing: 0.01 },
  );
  assert.deepEqual(support.filter((note) => note.setting.startsWith('texture')).map((note) => note.level), ['approximated'], 'only the texture scale is approximated');
});

test("roundness jitter reaches down to the preset's minimum roundness, as vid-97's probes show, and roundness by pressure is read alike", () => {
  const { brush, support } = normalizePhotoshopBrush('Squashing', {
    preset: readPhotoshopPreset({
      _class: 'brushPreset', Brsh: { _class: 'computedBrush', Dmtr: px(100), Hrdn: pct(100), Spcn: pct(10), Intr: true },
      useTipDynamics: true, roundnessDynamics: control(2, 50), minimumRoundness: pct(25),
    }),
    tip: asset('tips/round-100-100.png'),
  }, photoshopReading);
  assert.deepEqual({ pressure: brush.pressure.roundness, jitter: brush.jitter.roundness }, { pressure: 0.75, jitter: 0.375 });
  assert.equal(support.some((note) => note.setting.startsWith('tipDynamics.roundness')), false, 'both are read, neither approximated');
});
