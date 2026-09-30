// photoshop-readback.ts: whether Photoshop applied what a probe asked for (vid-100). Photoshop takes a setting it
// doesn't understand without complaint, a dynamics key written as a stringID or a tip set the wrong way (which paints a
// soft round instead of the sampled tip), so every probe's tool options are read back after they're set, and a probe
// whose read-back differs from its settings is reported rather than trusted.

import type { PhotoshopAppliedOptions } from './photoshop-capture-plan.ts';
import type { PhotoshopBrushSettings, PhotoshopControl } from './photoshop-probes.ts';

const CONTROL_CODE: Record<PhotoshopControl['control'], number> = { off: 0, fade: 1, penPressure: 2 };

type Read = Record<string, unknown>;
const object = (value: unknown): Read => (value && typeof value === 'object' ? value : {}) as Read;
/** A unit value as photoshop-actions.jsxinc reads it back: { value, unit }. */
const unit = (value: unknown) => object(value).value;

/** Each setting of `settings` that `applied` doesn't hold, as "name: asked X, read Y". Empty when all took. */
export function photoshopSettingsMismatches(settings: PhotoshopBrushSettings, applied: PhotoshopAppliedOptions): string[] {
  const out: string[] = [];
  const expect = (name: string, asked: unknown, read: unknown) => {
    if (asked !== read) out.push(`${name}: asked ${JSON.stringify(asked)}, read ${JSON.stringify(read)}`);
  };
  const tip = object(applied.brush), { tip: asked } = settings;
  expect('tip kind', asked.kind === 'sampled' ? 'sampledBrush' : 'computedBrush', tip._class);
  expect('diameter', asked.diameter, unit(tip.diameter));
  if (asked.kind === 'computed') expect('hardness', asked.hardness, unit(tip.hardness));
  expect('angle', asked.angle, unit(tip.angle));
  expect('roundness', asked.roundness, unit(tip.roundness));
  expect('spacing', asked.spacing, unit(tip.spacing));
  expect('flip x', asked.flipX, tip.flipX);
  expect('flip y', asked.flipY, tip.flipY);
  expect('opacity', settings.opacity, applied.opacity);
  expect('flow', settings.flow, applied.flow);
  expect('mode', 'normal', applied.mode);
  expect('wet edges', settings.wetEdges, applied.wetEdges);
  expect('noise', settings.noise, applied.noise);
  expect('build-up', false, applied.repeat);

  const sizeJitter = settings.jitter?.size ?? 0, angleJitter = settings.jitter?.angle ?? 0, roundnessJitter = settings.jitter?.roundness ?? 0;
  expect('shape dynamics', !!settings.size || sizeJitter > 0 || angleJitter > 0 || roundnessJitter > 0, applied.useTipDynamics);
  if (settings.size || sizeJitter) {
    const size = object(applied.szVr);
    expect('size control', CONTROL_CODE[settings.size?.control ?? 'off'], size.bVTy);
    expect('size jitter', sizeJitter, unit(size.jitter));
  }
  if (angleJitter) expect('angle jitter', angleJitter, unit(object(applied.angleDynamics).jitter));
  if (roundnessJitter) {
    expect('roundness jitter', roundnessJitter, unit(object(applied.roundnessDynamics).jitter));
    // Photoshop keeps a minimum roundness of at least 1%.
    expect('minimum roundness', Math.max(1, settings.jitter?.minimumRoundness ?? 0), unit(applied.minimumRoundness));
  }
  if (settings.jitter?.count) expect('count', settings.jitter.count, applied.count);
  if (settings.jitter?.countControl) expect('count control', CONTROL_CODE[settings.jitter.countControl.control], object(applied.countDynamics).bVTy);
  expect('transfer', !!settings.transfer, applied.usePaintDynamics);
  if (settings.transfer) {
    expect('opacity control', CONTROL_CODE[settings.transfer.opacity.control], object(applied.opVr).bVTy);
    expect('flow control', CONTROL_CODE[settings.transfer.flow.control], object(applied.prVr).bVTy);
  }
  expect('scatter', (settings.jitter?.scatter ?? 0) > 0 || (settings.jitter?.count ?? 1) > 1, applied.useScatter);

  expect('texture', !!settings.texture, applied.useTexture);
  if (settings.texture) {
    expect('texture mode', settings.texture.mode, applied.textureBlendMode);
    expect('texture depth', settings.texture.depth, unit(applied.textureDepth));
    expect('texture each tip', settings.texture.eachTip, applied.textClickPoint);
    expect('texture scale', settings.texture.scale, unit(applied.textureScale));
    expect('texture invert', settings.texture.invert, applied.invertTexture);
    expect('texture brightness', settings.texture.brightness, applied.textureBrightness);
    expect('texture contrast', settings.texture.contrast, applied.textureContrast);
  }
  const dual = object(applied.dualBrush);
  expect('dual', !!settings.dual, dual.useDualBrush);
  if (settings.dual) {
    const dualTip = object(dual.brush);
    expect('dual mode', settings.dual.mode, dual.blendMode);
    expect('dual diameter', settings.dual.tip.diameter, unit(dualTip.diameter));
    expect('dual hardness', settings.dual.tip.hardness, unit(dualTip.hardness));
    expect('dual spacing', settings.dual.tip.spacing, unit(dualTip.spacing));
    if (settings.dual.scatter) expect('dual scatter', settings.dual.scatter, unit(object(dual.scatterDynamics).jitter));
    if (settings.dual.count) expect('dual count', settings.dual.count, dual.count);
  }
  return out;
}
