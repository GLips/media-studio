// paint-camera-world.ts: the multiplane camera as a perspective camera, for three.js layers. A point placed by
// paintPlaneWorldPoint and rendered through a PerspectiveCamera set from paintCameraPerspectiveAt lands on the stage
// pixel paintPlaneSimilarity puts it on, to float precision, so a 3D layer at depth d moves as a plane there does.
//
// The world is three's: x right, y up, the camera at rest at the origin looking down −z. Its unit is a px at depth 1;
// depth d lies d·depthUnit away, depthUnit being the rest lens's focal length in px, from the fov the scene picks.
// The fov sets how deep the 3D world looks, never where a plane lands. Plain numbers: models never import three.

import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { paintStageCentre, type PaintCameraPose } from './paint-camera.ts';

/** A length in the 3D world: one unit is a px at depth 1, as seen through the camera at rest. */
export type PaintWorldUnits = number & { readonly unit: 'world units (px at depth 1)' };
// SAFETY: a brand marks a length as the world's; the number is unchanged.
const worldUnits = (length: number) => length as PaintWorldUnits;

export type PaintWorldPoint = { readonly x: PaintWorldUnits; readonly y: PaintWorldUnits; readonly z: PaintWorldUnits };

/**
 * The world a scene's 3D layers share with its planes: its `stage`, the vertical field of view over the frame at rest
 * (`fov`, degrees), and `depthUnit`, how far depth 1 lies from the camera's rest: (frame height / 2) / tan(fov / 2).
 */
export type PaintCameraWorld = { readonly stage: StampStage; readonly fov: number; readonly depthUnit: PaintWorldUnits };

export function paintCameraWorld(stage: StampStage, { fov }: { readonly fov: number }): PaintCameraWorld {
  if (!(fov > 0 && fov < 180)) throw new Error(`paint camera: a field of view is between 0 and 180 degrees, not ${fov}`);
  return { stage, fov, depthUnit: worldUnits(stage.frame.height / 2 / Math.tan((fov * Math.PI) / 360)) };
}

/** Where a plane's anchor point `point` (px) at `depth` lies in the world. */
export function paintPlaneWorldPoint({ stage, depthUnit }: PaintCameraWorld, point: StampPoint, depth: number): PaintWorldPoint {
  const centre = paintStageCentre(stage);
  return { x: worldUnits((point.x - centre.x) * depth), y: worldUnits(-(point.y - centre.y) * depth), z: worldUnits(-depth * depthUnit) };
}

/**
 * A three.js PerspectiveCamera's settings for `pose`, rendering a stage-sized target (frame and margin; a margin of 0
 * for the frame alone): `position`; `rotationZ`, its rotation.z (x and y 0); `fov`, vertical degrees over the
 * target, zoom included, so three's zoom stays 1; `aspect`. Its near plane must be under (depth − dolly)·depthUnit.
 */
export function paintCameraPerspectiveAt({ stage, depthUnit }: PaintCameraWorld, { pan, dolly, zoom, roll }: PaintCameraPose): {
  readonly position: PaintWorldPoint; readonly rotationZ: number; readonly fov: number; readonly aspect: number;
} {
  const { width, height } = stage;
  return {
    position: { x: worldUnits(pan.x), y: worldUnits(-pan.y), z: worldUnits(-dolly * depthUnit) },
    // A rotation.z of −roll in three's y-up world turns the picture by −roll in the painting's y-down angles.
    rotationZ: -roll,
    fov: (2 * Math.atan(height / 2 / (zoom * depthUnit)) * 180) / Math.PI,
    aspect: width / height,
  };
}
