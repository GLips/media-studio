import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampBrushEvenEdge, stampBrushStatedProfile } from '#lib/paint/brush/models/stamp-brush-profile.ts';
import { PAINT_MEDIA } from '#lib/paint/materials/models/paint-medium.ts';
import { stampRoundTipFootprint, stampTipSupportOf } from '#lib/paint/painting/models/stamp-tip-support.ts';
import { stampStyleBrushNumbers, type StampStyleBrushNumbers } from './style-brush-numbers.ts';
import type { ResolvedStampPaintStyle } from './style.ts';

const brush: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED, name: 'Wash', blend: 'normal', accumulation: { kind: 'buildToOpacity' },
  tip: { image: { style: 's', pack: 'p', file: 'tips/wash.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1, stepping: 'spread', dynamics: stampLinearDynamics({ size: { pressure: 0.5 }, grainDepth: { pressure: 1 } }),
  scatter: { count: 1, radius: 0, lateral: 0 }, rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0.2, end: 0.2, size: 0.3, opacity: 0.5, shape: 0, pressure: 0 }, falloff: 0, flow: 0.4,
};
// Measured from 8 px, reading 0.75 of its diameter there and 0.9 at 64.
const stated = stampBrushStatedProfile(brush, 0.5, { main: stampTipSupportOf(stampRoundTipFootprint()), dual: null });
const [{ support }] = stated.samples;
brush.profile = { ...stated, samples: [[8, 3], [64, 28.8]].map(([diameter, offset]) => ({ diameter, edge: stampBrushEvenEdge(offset), edgeNoise: 0, support })) };

const sharesOf = ({ pressure }: StampStyleBrushNumbers) => pressure.map(({ target, shares }) => [target, shares.map((s) => Number(s.toFixed(3)))]);

test("a style's roles read as numbers to plan by: pressure's shares, visible width over diameter where measured, and how each meets the paper", () => {
  const medium = PAINT_MEDIA.watercolour;
  const resolved: ResolvedStampPaintStyle = {
    name: 's', brushes: { wash: { ...brush, media: 'wet' }, dry: { ...brush, media: 'dry' } }, palette: {}, paper: { color: '#ffffff' }, mixing: { kind: 'pigment', medium, pigments: {} },
  };
  const [wash, dry] = stampStyleBrushNumbers(resolved, { wash: { pack: 'p' }, dry: { pack: 'p' } });
  assert.deepEqual(sharesOf(wash), [['size', [0.65, 0.8, 1]], ['opacity', [1, 1, 1]], ['flow', [1, 1, 1]], ['grainDepth', [0.3, 0.6, 1]]]);
  // On the peaks the tooth answers pressure, and the engine sets the brush's grain depth by pressure aside.
  assert.deepEqual(sharesOf(dry), [['size', [0.65, 0.8, 1]], ['opacity', [1, 1, 1]], ['flow', [1, 1, 1]]]);
  assert.equal(wash.flow, 0.4);
  assert.ok(wash.footprint.kind === 'measured');
  assert.equal(wash.footprint.smallest, 8);
  assert.deepEqual(wash.footprint.widths.map(({ diameter, ratio }) => [diameter, Number(ratio.toFixed(3))]), [[8, 0.75], [16, 0.836], [32, 0.879], [64, 0.9]]);
  assert.deepEqual(wash.paper, { kind: 'valleys' });
  assert.ok(medium.paperContact.kind === 'valleys');
  assert.deepEqual(dry.paper, { kind: 'peaks', tooth: medium.paperContact.dryBrush.tooth, dryBrush: true });
});
