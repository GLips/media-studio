// paper-diorama.ts: presets for a cut-paper diorama seen as a miniature: a ground tipped well back, a low warm sun
// raking across it, and a tilt-shift focus whose sharp band lies across the ground's middle.

import type { PaintCameraFocus } from '#lib/paint/animation/models/paint-camera.ts';
import type { PaintLight } from '#lib/paint/painting/models/stamp-form.ts';
import type { PaintedThreePaperLeak, PaintedThreePaperLightShares } from '#lib/paint/three-layers/models/painted-three-paper.ts';

/** Radians a diorama's ground tips back from facing the camera (a pop-up's `pitch`): about 46°, looking that far down. */
export const PAPER_DIORAMA_PITCH = 0.8;

/**
 * Where a diorama's sun stands over its ground: `from`, radians round from the ground's left toward the camera (0 is
 * straight from the left, positive toward the camera, so faces toward the camera catch some); `height`, radians up
 * from the ground.
 */
const PAPER_DIORAMA_SUN = { from: 0.26, height: 0.52 } as const;

/**
 * A diorama's light: `light` for PaintedShot, `leak` and `lights` for a pop-up's look. A low warm sun from the left
 * across a ground tipped back `pitch` (upper left in the frame), long warm shadows, a low fill and a high sky so faces
 * turned from it stay legible. The fill and sky stay white: paper lights take no colour.
 */
export function paperDioramaLight(pitch = PAPER_DIORAMA_PITCH): { readonly light: PaintLight; readonly leak: PaintedThreePaperLeak; readonly lights: PaintedThreePaperLightShares } {
  // Frame axes, x right, y down, z toward the viewer: the ground's normal, and its way toward the camera.
  const normal = { y: -Math.sin(pitch), z: Math.cos(pitch) }, toward = { y: Math.cos(pitch), z: Math.sin(pitch) };
  const { from, height } = PAPER_DIORAMA_SUN, flat = Math.cos(height);
  const sun = {
    x: -Math.cos(from) * flat,
    y: Math.sin(from) * flat * toward.y + Math.sin(height) * normal.y,
    z: Math.sin(from) * flat * toward.z + Math.sin(height) * normal.z,
  };
  return { light: { direction: Math.atan2(sun.y, sun.x), elevation: Math.asin(sun.z) }, leak: [0.68, 0.42, 0.2], lights: { fill: 0.2, sky: 0.3 } };
}

/**
 * The miniature look's focus: `focus`, the depth of the ground's middle straight ahead (its pop-up's plane's, centred
 * in the frame); `aperture`, frame px of blur at infinity. The focal plane stands upright on a ground tipped back
 * `pitch`, so a piece in the band is sharp foot to top and the ground blurs away from it.
 */
export function paperDioramaFocus({ focus, aperture, pitch = PAPER_DIORAMA_PITCH }: { readonly focus: number; readonly aperture: number; readonly pitch?: number }): PaintCameraFocus {
  return { focus, aperture, tilt: { angle: pitch - Math.PI / 2 } };
}
