import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shotCameraAxes, shotCameraFocalPx, shotCameraLookingAt, shotCameraProject, type ShotCamera } from '#lib/picture/shot-camera/models/shot-camera.ts';
import { lensApertureSlide, lensDefocusSigned, lensFocusLean, lensFrameAffineApply, shotCameraExposed, type LensFocus, type ShotCameraLensFocus } from './lens-focus.ts';

const CAMERA = shotCameraLookingAt({ frame: { width: 320, height: 180 }, fov: 40, near: 0.1, far: 100 }, { position: [1, 6, 9], target: [0, 0, 0] });
const FOCUS = 11, TILT = { angle: 0.6, axis: 0.25 };
const LENS: ShotCameraLensFocus = { focus: FOCUS, aperture: 0.3, tilt: TILT };
const APERTURES: readonly (readonly [number, number])[] = [[1.2, -0.4], [-0.8, 0.9], [0, 1.5]];
const PIXELS = [{ x: 40, y: 30 }, { x: 160, y: 90 }, { x: 290, y: 150 }];

/** The world point `depth` along the view down frame px `at`'s ray through `camera`. */
function onRay(camera: ShotCamera, at: { x: number; y: number }, depth: number) {
  const { right, up, forward } = shotCameraAxes(camera), f = shotCameraFocalPx(camera);
  const x = at.x - camera.frame.width / 2, y = at.y - camera.frame.height / 2;
  return forward.multiplyScalar(depth).addScaledVector(right, (depth * x) / f).addScaledVector(up, (-depth * y) / f).add({ x: camera.position[0], y: camera.position[1], z: camera.position[2] });
}

/** The lens as frame px, as the fast path reads it. */
function framed(): LensFocus {
  const f = shotCameraFocalPx(CAMERA);
  return { focus: FOCUS, aperture: (f * LENS.aperture) / FOCUS, lean: lensFocusLean(TILT, { x: CAMERA.frame.width / 2, y: CAMERA.frame.height / 2 }, f) };
}

test('an exposure under a tilted focus holds its leaning focal plane still, and slides the rest as the fast path blurs it', () => {
  const lens = framed();
  for (const aperture of APERTURES) {
    const exposed = shotCameraExposed(CAMERA, LENS, { aperture, pixel: [0, 0] });
    for (const at of PIXELS) {
      const sharp = shotCameraProject(exposed, onRay(CAMERA, at, FOCUS / (1 + lens.lean!.x * (at.x - 160) + lens.lean!.y * (at.y - 90))))!;
      assert.ok(Math.hypot(sharp.x - at.x, sharp.y - at.y) < 1e-6, `the focal plane at (${at.x}, ${at.y}) lands at (${sharp.x}, ${sharp.y})`);
      for (const depth of [6, 25]) {
        const seen = shotCameraProject(exposed, onRay(CAMERA, at, depth))!, { shift, shear } = lensApertureSlide(lens, depth, aperture);
        const slid = lensFrameAffineApply(shear!, { x: at.x + shift.x, y: at.y + shift.y });
        assert.ok(Math.hypot(seen.x - slid.x, seen.y - slid.y) < 1e-6, `depth ${depth} at (${at.x}, ${at.y}): seen (${seen.x}, ${seen.y}), slid (${slid.x}, ${slid.y})`);
        // To first order in the aperture, the slide is the fast path's signed sigma times the aperture point.
        const small = lensApertureSlide(lens, depth, [aperture[0] * 1e-4, aperture[1] * 1e-4]), signed = lensDefocusSigned(lens, depth, at);
        const sx = lensFrameAffineApply(small.shear!, { x: at.x + small.shift.x, y: at.y + small.shift.y }).x - at.x;
        assert.ok(Math.abs(sx / 1e-4 - aperture[0] * signed) < 1e-3 * Math.max(1, Math.abs(signed)), `depth ${depth}: slide ${sx / 1e-4}, sigma ${aperture[0] * signed}`);
      }
    }
  }
});

test('an untilted focus slides everything evenly, as a lens shift', () => {
  const { shear, shift } = lensApertureSlide({ focus: 2, aperture: 4 }, 4, [1, -0.5]);
  assert.equal(shear, null);
  assert.deepEqual(shift, { x: 2, y: -1 });
  const exposed = shotCameraExposed(CAMERA, { focus: FOCUS, aperture: 0.3 }, { aperture: [1, 0], pixel: [0, 0] });
  assert.deepEqual(exposed.shear, CAMERA.shear);
});
