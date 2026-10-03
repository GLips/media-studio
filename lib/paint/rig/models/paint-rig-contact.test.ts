import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintRigFootDriftStep } from './paint-rig-contact.ts';

test('a foot rolling about its heel or toe drifts nothing; one sliding drifts by its slide', () => {
  const heel = { x: 0, y: 0 }, toe = { x: 30, y: 0 };
  // Toe peel: the foot turns 20° about its toe, the heel lifting.
  const turn = (20 * Math.PI) / 180, peeled = { x: toe.x - 30 * Math.cos(turn), y: -30 * Math.sin(turn) };
  assert.deepEqual(paintRigFootDriftStep([heel, toe], [peeled, toe]), { x: 0, y: 0 });
  assert.deepEqual(paintRigFootDriftStep([heel, toe], [{ x: 2, y: 0 }, { x: 32, y: 0 }]), { x: 2, y: 0 });
});
