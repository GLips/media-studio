import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush, type StampBrushMeasuredProfile } from './stamp-brush.ts';
import {
  STAMP_BRUSH_PROFILE_PROTOCOL, stampBrushEdgeOffsetMean, stampBrushEdgeReach, stampBrushEvenEdge, stampBrushMeasuredProfile, stampBrushProfileSettingsHash,
} from './stamp-brush-profile.ts';

const plain: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED,
  name: 'Round', blend: 'normal', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 'wash', pack: 'vvds', file: 'tips/round.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.1, stepping: 'spread', dynamics: stampLinearDynamics({}), scatter: { count: 1, radius: 0, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
};

const support = { main: { width: 64, height: 64, span: 1, roundness: 1, reach: [0.5, 0.52] }, dual: null };
const profile: StampBrushMeasuredProfile = {
  kind: 'measured',
  key: { protocol: STAMP_BRUSH_PROFILE_PROTOCOL, settings: stampBrushProfileSettingsHash(plain), assets: '', medium: '' },
  provenance: { adapter: 'test', browser: 'test', renderer: 'test', seeds: ['a'], measuredAt: '2026-10-01T00:00:00Z' },
  samples: [
    { diameter: 8, edge: stampBrushEvenEdge(3), edgeNoise: 0, support },
    // A flat tip at 16 px, wider heading along x than along y, its paint reaching further to the left.
    { diameter: 16, edge: { left: [9, 8, 7, 8, 9, 8, 7, 8], right: [7, 6, 5, 6, 7, 6, 5, 6] }, edgeNoise: 0.1, support },
  ],
};

test("a profile is read between its samples, round between its headings, per side, and never past them", () => {
  // Toward way k of 32: heading 0, the left side faces way 24; heading π/8, the right faces way 10; heading -π/2, the left way 16.
  assert.equal(stampBrushEdgeReach(profile, 12, 'Round').left[24], 6);
  assert.equal(stampBrushEdgeReach(profile, 16, 'Round').right[10], 6.5);
  assert.equal(stampBrushEdgeReach(profile, 16, 'Round').left[16], 7);
  assert.equal(stampBrushEdgeOffsetMean(profile, 16, 'Round'), 7);
  assert.throws(() => stampBrushEdgeReach(profile, 20, 'Round'), /Round is measured from 8 to 16 px, not at 20/);
  assert.throws(() => stampBrushEdgeOffsetMean(profile, 4, 'Round'), /not at 4/);
  // A brush read from its source alone has nothing to plan with.
  assert.throws(() => stampBrushMeasuredProfile(plain), /Round has no profile/);
});
