import assert from 'node:assert/strict';
import test from 'node:test';
import { stampLinearDynamics, type StampBrush, type StampBrushLayer, type StampDynamics } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import { stampBrushOnTooth } from './style.ts';

const layer = (dynamics: StampDynamics): StampBrushLayer => ({
  accumulation: { kind: 'buildToOpacity' },
  tip: { image: { style: 'test', pack: 'test', file: 'round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1, stepping: 'eachStamp', dynamics, scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 0.5,
});

test("a brush on a dry medium's tooth loses only its grain depth by pressure, its dual's too", () => {
  const brush: StampBrush = {
    ...layer(stampLinearDynamics({ size: { pressure: 1 }, grainDepth: { pressure: 0.5, random: 0.1 } })), name: 'stick', blend: 'normal',
    dual: { ...layer(stampLinearDynamics({ grainDepth: { pressure: 1 } })), blend: { family: 'texture', mode: 'multiply' }, scale: 1 },
  };
  const onTooth = stampBrushOnTooth(brush);
  assert.deepEqual(onTooth.dynamics, stampLinearDynamics({ size: { pressure: 1 }, grainDepth: { random: 0.1 } }));
  assert.deepEqual(onTooth.dual?.dynamics, {});
});
