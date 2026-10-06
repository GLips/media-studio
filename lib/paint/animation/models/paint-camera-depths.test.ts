import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import { stampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
import { buildPaintCamera, paintShotCameraOptions, type PaintShotCamera } from './paint-camera-build.ts';
import { paintPointAcrossDepths } from './paint-camera-depths.ts';
import { paintKeyed } from './paint-keyed.ts';
import { paintCameraPlay, paintPlaneViewAt } from './paint-camera.ts';
import { paintSimilarityApply } from './paint-similarity.ts';

/** A camera at rest at 0 s that pans, dollies, zooms and rolls by 2 s, as a shot writes it. */
const CAMERA: PaintShotCamera = {
  stage: stampStage({ width: 320, height: 240 }, 40), fov: 35, lens: { bloom: 0, shutter: 'shut' },
  plays: [paintCameraPlay({
    kind: 'move', value: paintKeyed([{ at: 0, value: { pan: { x: 0, y: 0 }, dolly: 0, zoom: 1, roll: 0 } }, { at: 2, value: { pan: { x: 60, y: -20 }, dolly: 0.3, zoom: 1.1, roll: 0.05 } }]),
  }, { clock: { at: 0 }, origin: 'drift' })],
};
/** The span the shot shows. */
const SPAN: SceneShownSpan = { from: 0, to: 2, fps: 30 };

test('a point found on another depth lies on the frame px the camera shows it on, and stays put at one depth or at rest', () => {
  const built = buildPaintCamera(paintShotCameraOptions(CAMERA, SPAN, 30, [])), sun = { x: 250, y: 60 };
  assert.ok(built.ok);
  const m = paintMoment(1.3), onWater = paintPointAcrossDepths(CAMERA, SPAN, { depth: 3, point: sun }, 1.5, m);
  const shown = (depth: number, point: { x: number; y: number }) => paintSimilarityApply(paintPlaneViewAt(built.camera, depth, m), point);
  const [sky, water] = [shown(3, sun), shown(1.5, onWater)];
  assert.ok(Math.hypot(sky.x - water.x, sky.y - water.y) < 1e-9, `the sun shows at ${sky.x}, ${sky.y}; found on the water, at ${water.x}, ${water.y}`);
  assert.ok(Math.hypot(onWater.x - sun.x, onWater.y - sun.y) > 5, 'the camera parts the two depths by 1.3 s');
  assert.deepEqual(paintPointAcrossDepths(CAMERA, SPAN, { depth: 3, point: sun }, 3, m), sun);
  assert.deepEqual(paintPointAcrossDepths(CAMERA, SPAN, { depth: 3, point: sun }, 1.5, paintMoment(0)), sun);
});
