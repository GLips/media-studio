// painted-three-sheet.ts: a folded sheet's meshes (its faces and folds are models'): one mesh per face, each its
// polygon and holes in the flat layout extruded to the paper's thickness, centred on z, so the face's matrix from
// paintedThreeSheetFolding places it folded. A material preset (painted-three-paper.ts's paper) says how faces look.

import { ExtrudeGeometry, Mesh, Path, Shape, Vector2, type Material } from 'three/webgpu';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintedThreeSheetFolding, type PaintedThreeSheet, type PaintedThreeSheetFaceCut, type PaintedThreeSheetFolding } from '../models/painted-three-sheet.ts';

/**
 * How a sheet's faces look: `faceMaterial` makes each face's (it may share one between faces); `dispose` frees what
 * they share. Each face's material is disposed with its mesh.
 */
export type PaintedThreeSheetMaterial = { readonly faceMaterial: (face: PaintedThreeSheetFaceCut) => Material; readonly dispose: () => void };

/**
 * A sheet's meshes: `faces` by id, in sheet space until posed (set each one's matrix from `folding.poseAt`, after
 * whatever places the sheet). Their matrices don't update themselves.
 */
export type PaintedThreeSheetMeshes = { readonly folding: PaintedThreeSheetFolding; readonly faces: ReadonlyMap<string, Mesh>; readonly dispose: () => void };

/** Sheet space's y runs up, the print's down. */
const sheetPoints = (ring: readonly StampPoint[]) => ring.map(({ x, y }) => new Vector2(x, -y));

/**
 * `sheet`'s faces as meshes looking as `material` says, casting and receiving shadows. Refuses whatever its folding
 * refuses (paintedThreeSheetFolding).
 */
export function createPaintedThreeSheet(sheet: PaintedThreeSheet, material: PaintedThreeSheetMaterial): PaintedThreeSheetMeshes {
  const folding = paintedThreeSheetFolding(sheet), { thickness } = folding, faces = new Map<string, Mesh>();
  for (const id of folding.order) {
    const face = folding.faces.get(id)!, [outline, ...holes] = face.rings, shape = new Shape(sheetPoints(outline));
    shape.holes = holes.map((hole) => new Path(sheetPoints(hole)));
    const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 }).translate(0, 0, -thickness / 2);
    const mesh = new Mesh(geometry, material.faceMaterial(face));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    faces.set(id, mesh);
  }
  return {
    folding,
    faces,
    dispose: () => {
      for (const mesh of faces.values()) {
        mesh.geometry.dispose();
        // SAFETY: each face's mesh was made with one material, never an array.
        (mesh.material as Material).dispose();
      }
      material.dispose();
    },
  };
}
