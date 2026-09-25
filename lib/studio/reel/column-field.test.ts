import assert from 'node:assert/strict';
import { test } from 'node:test';
import { H, W } from '../frame.ts';
import '../tsx-test-hooks.ts';
import type { ColumnFieldSpec } from './column-field.tsx';

const { columnBallAt, columnDiscCells, columnFieldPoint, columnFieldProject, columnNoise, topDownPose } = await import('./column-field.tsx');

// The reference's section: tiles rising into churning columns while the camera cranes down from overhead, and a ball
// landing on three of them.
const spec: ColumnFieldSpec = {
  cells: columnDiscCells({ radius: 12, color: () => '#e8e6dd' }),
  height: columnNoise({ seed: 7 }),
  rise: { at: 0.2, duration: 0.25 },
  camera: {
    from: topDownPose({ pitch: 101.25, height: 0.12 }),
    to: { target: [0.6, 1.6, 0.4], distance: 15, elevation: 37, azimuth: -30, fov: 27 },
    crane: [0.1, 0.667],
  },
  ball: { contacts: [{ at: 0.47, cell: [-1, 0] }, { at: 0.94, cell: [1, 1] }, { at: 1.41, cell: [3, 1] }], contact: 0.066 },
};

test('looks straight down on the tiles at the 2D grid pitch it cuts from', () => {
  for (const [i, j] of [[0, 0], [1, 0], [-3, 2], [5, -4]] as const) {
    const at = columnFieldProject(spec, 0, columnFieldPoint(spec, 0, [i, j]))!;
    assert.ok(Math.abs(at.x - (W / 2 + 101.25 * i)) < 1e-6 && Math.abs(at.y - (H / 2 + 101.25 * j)) < 1e-6, `tile ${i},${j} sits on the grid`);
  }
});

test('lands on each column top as it stands on the beat, and meets and leaves it without a jump', () => {
  for (const { at, cell } of spec.ball!.contacts) {
    const landed = columnBallAt(spec, at)!;
    assert.ok(Math.abs(landed.position.y - landed.radius - columnFieldPoint(spec, at, cell)[1]) < 1e-9, `rests on ${cell} at ${at}`);
    for (const edge of [at, at + spec.ball!.contact!]) {
      const before = columnBallAt(spec, edge - 1e-7)!.position, after = columnBallAt(spec, edge + 1e-7)!.position;
      assert.ok(before.distanceTo(after) < 1e-4, `no jump at ${edge} s`);
    }
  }
});
