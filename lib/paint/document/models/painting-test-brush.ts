// painting-test-brush.ts: a round wet brush for tests that compile a document without reading a workspace style, so
// they run on a clean clone. Its tip image is named, never loaded: a compile places stamps, it doesn't draw them.

import { stampBrushEvenEdge } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampRoundTipStatedProfile } from '#lib/paint/painting/models/stamp-tip-support.ts';
import type { PaintingBrushOf } from './painting-deposit-compile.ts';

const wash: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED, name: 'wash', blend: 'normal', media: 'wet', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'watercolor', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1, stepping: 'spread', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
};
const stated = stampRoundTipStatedProfile(wash);
wash.profile = stated;

/** Every brush a test document names, resolved to the one round wet wash brush. */
export const paintingTestBrushOf: PaintingBrushOf = () => wash;

/** The wash brush measured from `min` to `max` px alone, as an imported pack's brush is measured over a range. */
export function paintingTestBrushSpanning(min: number, max: number): StampBrush {
  const { support } = stated.samples[0], at = (diameter: number) => ({ diameter, edge: stampBrushEvenEdge(diameter / 2), edgeNoise: 0, support });
  return { ...wash, profile: { ...stated, samples: [at(min), at(max)] } };
}
