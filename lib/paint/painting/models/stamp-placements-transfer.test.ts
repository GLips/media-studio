import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STAMP_BRUSH_UNMEASURED, stampLinearDynamics, type StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { compileStampPaintRecipe, stampPassDeposits } from './stamp-paint-recipe-compile.ts';
import { stampPaintRecipe } from './stamp-paint-recipe.ts';
import type { StampPaintEnvironment } from './stamp-paint-recipe-types.ts';
import { stampPlacementsShareable } from './stamp-deposit-placement.ts';
import { stampPlacementsFramed, stampPlacementsPacked, stampPlacementsUnframed } from './stamp-placements-transfer.ts';
import { stampRoundTipStatedProfile } from './stamp-tip-support.ts';

const FLAT: StampPaintEnvironment = { paper: { color: '#ffffff' }, mixing: { kind: 'flat' } };
const brush: StampBrush = {
  profile: STAMP_BRUSH_UNMEASURED, name: 'Round', blend: 'normal', accumulation: { kind: 'glaze', build: 0 },
  tip: { image: { style: 's', pack: 'p', file: 'tip.png' }, roundness: 1, sampling: 'isotropic' },
  spacing: 0.2, stepping: 'spread', dynamics: stampLinearDynamics({ size: { random: 0.3 } }), scatter: { count: 2, radius: 0.2, lateral: 0 },
  rotation: { angle: 0, randomStart: false }, flip: { x: false, y: false }, blur: { amount: 0, jitter: 0 },
  taper: { start: 0, end: 0, size: 1, opacity: 1, shape: 0, pressure: 0 }, falloff: 0, flow: 1,
  color: { stamp: { hue: 0.1, saturation: 0, lightness: 0, darkness: 0 }, stroke: { hue: 0, saturation: 0, lightness: 0, darkness: 0 }, pressure: { hue: 0, saturation: 0, lightness: 0, secondary: 0 } },
};
brush.profile = stampRoundTipStatedProfile(brush);

test('placements handed to another page read as they were placed, a flood\'s barrier, grid and load with them', () => {
  const painting = compileStampPaintRecipe(stampPaintRecipe(FLAT, (paint) => paint.group('g', { composite: 'opaque' }, (group) => group.passage('p', {}, (pass) => {
    pass.fill('sea', { brush, well: { paint: { kind: 'color', color: '#336699' } }, size: 30, application: { kind: 'flood' }, region: { kind: 'ellipse', x: 120, y: 80, radiusX: 90, radiusY: 50 } });
    pass.stroke('line', { brush, well: { paint: { kind: 'color', color: '#000000' } }, size: 12, path: [{ x: 0, y: 0 }, { x: 200, y: 40 }] });
  }))));
  const placed = stampPassDeposits(painting.groups[0].passes[0]).map(({ stamps }) => stamps);
  // In two parts, as two placing workers send theirs.
  const shared = stampPlacementsShareable(), framed = stampPlacementsFramed([stampPlacementsPacked(shared.slice(0, 1)), stampPlacementsPacked(shared.slice(1))]);
  const received = stampPlacementsUnframed(Uint8Array.from(Buffer.concat(framed)).buffer);
  assert.deepEqual(received, shared);
  assert.ok(placed.every((stamps) => shared.some(([, placement]) => placement.stamps === stamps)) && received.some(([, placement]) => placement.kind === 'flood' && placement.stamps.tints));
});
