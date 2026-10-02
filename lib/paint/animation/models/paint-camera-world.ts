// paint-camera-world.ts: the multiplane camera as the studio's one camera description (shot-camera.ts), for three.js
// sources. A point placed by paintPlaneWorldPoint and seen through paintCameraShotAt lands on the frame pixel
// paintPlaneSimilarity puts it on, so a three.js source at depth d moves as a plane there does.
//
// The world is three's: y up, the camera at rest at the origin looking down −z. Its unit is a px at depth 1; depth d
// lies d·depthUnit away, depthUnit the rest lens's focal length in px. The fov sets how deep the world looks, never
// where a plane lands.

import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { shotCameraRolled, type ShotCamera } from '#lib/picture/shot-camera/models/shot-camera.ts';
import type { StampStage } from '#lib/paint/painting/models/stamp-stage.ts';
import { paintStageCentre, type PaintCameraPose } from './paint-camera.ts';

/** A length in the 3D world: one unit is a px at depth 1, as seen through the camera at rest. */
export type PaintWorldUnits = number & { readonly unit: 'world units (px at depth 1)' };
// SAFETY: a brand marks a length as the world's; the number is unchanged.
const worldUnits = (length: number) => length as PaintWorldUnits;

export type PaintWorldPoint = { readonly x: PaintWorldUnits; readonly y: PaintWorldUnits; readonly z: PaintWorldUnits };

/**
 * The world a scene's three.js sources share with its planes: its `stage`, the vertical field of view over the frame
 * at rest (`fov`, degrees, the camera's projection), and `depthUnit`, how far depth 1 lies from the camera's rest:
 * (frame height / 2) / tan(fov / 2).
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

/** A plane at `depth` in a world: where its anchor points (px) lie, and how long its px are, in world units. */
export type PaintWorldPlane = { readonly depth: number; readonly point: (point: StampPoint) => PaintWorldPoint; readonly length: (px: number) => PaintWorldUnits };

/** `world`'s plane at `depth`, so whatever lies on it is placed and sized by its depth stated once. */
export const paintWorldPlane = (world: PaintCameraWorld, depth: number): PaintWorldPlane =>
  ({ depth, point: (point) => paintPlaneWorldPoint(world, point, depth), length: (px) => worldUnits(px * depth) });

/** How deep a three.js source sees, in depth units: its content lies between, and anything nearer than `near` is cut. */
export const PAINT_WORLD_DEPTH_RANGE = { near: 0.02, far: 200 } as const;

/**
 * The camera at `pose` seeing `world`'s frame: the zoom in its field of view, the roll about its view. Negative space:
 * a pose never looks at or orbits anything, which would turn planes off the image where a flat picture can't follow;
 * a scene that needs one is a three.js scene through a ShotCamera of its own.
 */
export function paintCameraShotAt({ stage, depthUnit }: PaintCameraWorld, { pan, dolly, zoom, roll }: PaintCameraPose): ShotCamera {
  const { width, height } = stage.frame;
  return shotCameraRolled({
    frame: { width, height },
    fov: (2 * Math.atan(height / 2 / (zoom * depthUnit)) * 180) / Math.PI,
    near: PAINT_WORLD_DEPTH_RANGE.near * depthUnit,
    far: PAINT_WORLD_DEPTH_RANGE.far * depthUnit,
  }, {
    position: [pan.x, -pan.y, -dolly * depthUnit],
    // Turned −roll about its view in three's y-up world, the picture turns by −roll in the painting's y-down angles.
    rollZ: -roll,
  });
}
