import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PAPER_KEY_LIGHT } from '#lib/paint/painting/models/stamp-form.ts';
import { paintWorldLightDirection } from './paint-camera-world.ts';

const degrees = (radians: number) => (radians * 180) / Math.PI;

test("the paper key lies 55° toward screen-left and 50° up from the camera's axis, in the world three lights", () => {
  const { x, y, z } = paintWorldLightDirection(PAPER_KEY_LIGHT);
  // Up and to the left of the camera, toward the viewer: three's y runs up where the painting's runs down.
  assert.ok(Math.abs(degrees(Math.asin(y)) - 50) < 1e-9);
  assert.ok(Math.abs(degrees(Math.atan2(-x, z)) - 55) < 1e-9);
  assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-12);
});
