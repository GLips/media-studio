import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { shotCameraProject } from '#lib/picture/shot-camera/models/shot-camera.ts';
import { blockoutShotCamera, orbitMove, pushInMove } from './blockout-camera.ts';

const frame = { width: 1920, height: 1080 };

test('a move\'s camera keeps its target at the frame\'s centre, upright, the whole way', () => {
  const orbit = orbitMove({ target: [0, 1, 0], radius: 3.4, height: 1.6, fromDeg: -50, toDeg: 30 });
  for (const k of [0, 0.5, 1]) {
    const camera = blockoutShotCamera(orbit(k), frame);
    const target = shotCameraProject(camera, [0, 1, 0])!;
    assert.ok(Math.abs(target.x - 960) < 1e-6 && Math.abs(target.y - 540) < 1e-6);
    // A point straight above the target is straight above it in the frame.
    const above = shotCameraProject(camera, [0, 2, 0])!;
    assert.ok(Math.abs(above.x - 960) < 1e-6 && above.y < 540);
  }
});

test('a push-in ends its distance from the target, along the line it started on', () => {
  const { position } = pushInMove({ target: [0, 1, 0], position: [2, 1.8, 4], toDistance: 2 })(1);
  assert.ok(Math.abs(new Vector3(...position).distanceTo(new Vector3(0, 1, 0)) - 2) < 1e-9);
  assert.ok(new Vector3(...position).sub(new Vector3(0, 1, 0)).normalize().distanceTo(new Vector3(2, 0.8, 4).normalize()) < 1e-9);
});
