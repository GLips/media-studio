// painted-three-sheet.ts: a folded sheet's meshes (its faces and folds are models'). A sheet's geometry, built once and
// shared by every mesh of it however many sheets show it: each face's polygon and holes in the flat layout extruded
// to the paper's thickness, centred on z, so the face's matrix from paintedThreeSheetFolding places it folded; and
// each face's distance field as a texture. A material preset (painted-three-paper.ts's paper) says how faces look.

import { DataTexture, DataUtils, ExtrudeGeometry, HalfFloatType, LinearFilter, Mesh, Path, RGBAFormat, Shape, Vector2, type BufferGeometry, type Material } from 'three/webgpu';
import type { StampPoint } from '#lib/paint/painting/models/stamp-region.ts';
import { paintedThreeSheetField, paintedThreeSheetFolding, type PaintedThreeSheet, type PaintedThreeSheetFaceCut, type PaintedThreeSheetFolding } from '../models/painted-three-sheet.ts';

/** A face's distance field (paintedThreeSheetField) as a half-float texture, filtered, and the print px it spans. */
export type PaintedThreeSheetFieldTexture = { readonly texture: DataTexture; readonly box: { readonly x0: number; readonly y0: number; readonly width: number; readonly height: number } };

/** A face as built: its cut, its geometry in sheet space, and its field. */
export type PaintedThreeSheetFaceGeometry = { readonly cut: PaintedThreeSheetFaceCut; readonly geometry: BufferGeometry; readonly field: PaintedThreeSheetFieldTexture };

/** A sheet's geometry: each face as built, by id; `dispose` frees their geometries and fields. */
export type PaintedThreeSheetGeometry = { readonly faces: ReadonlyMap<string, PaintedThreeSheetFaceGeometry>; readonly dispose: () => void };

/** How a sheet's faces look: `faceMaterial` makes a face's; `dispose` frees what it made. */
export type PaintedThreeSheetMaterial = { readonly faceMaterial: (face: PaintedThreeSheetFaceGeometry) => Material; readonly dispose: () => void };

/**
 * A sheet's meshes: `faces` by id, in sheet space until posed (set each one's matrix from `folding.poseAt`, after
 * whatever places the sheet). Their matrices don't update themselves.
 */
export type PaintedThreeSheetMeshes = { readonly folding: PaintedThreeSheetFolding; readonly faces: ReadonlyMap<string, Mesh>; readonly dispose: () => void };

/** Sheet space's y runs up, the print's down. */
const sheetPoints = (ring: readonly StampPoint[]) => ring.map(({ x, y }) => new Vector2(x, -y));

function paintedThreeSheetFieldTexture(face: PaintedThreeSheetFaceCut): PaintedThreeSheetFieldTexture {
  const { x0, y0, columns, rows, cell, values } = paintedThreeSheetField(face);
  const halves = new DataTexture(Uint16Array.from(values, (v) => DataUtils.toHalfFloat(v)), columns, rows, RGBAFormat, HalfFloatType);
  halves.magFilter = halves.minFilter = LinearFilter;
  halves.needsUpdate = true;
  return { texture: halves, box: { x0, y0, width: columns * cell, height: rows * cell } };
}

/** `folding`'s faces built (PaintedThreeSheetGeometry), to share between every sheet folded from the same faces. */
export function createPaintedThreeSheetGeometry({ order, faces: cuts, thickness }: PaintedThreeSheetFolding): PaintedThreeSheetGeometry {
  const faces = new Map(order.map((id): [string, PaintedThreeSheetFaceGeometry] => {
    const cut = cuts.get(id)!, [outline, ...holes] = cut.rings, shape = new Shape(sheetPoints(outline));
    shape.holes = holes.map((hole) => new Path(sheetPoints(hole)));
    const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, steps: 1 }).translate(0, 0, -thickness / 2);
    return [id, { cut, geometry, field: paintedThreeSheetFieldTexture(cut) }];
  }));
  return {
    faces,
    dispose: () => {
      for (const { geometry, field } of faces.values()) {
        geometry.dispose();
        field.texture.dispose();
      }
    },
  };
}

/** A mesh of each of `geometry`'s faces, by id, wearing `materialOf` its id's, casting and receiving shadows, posed by hand. */
export function createPaintedThreeSheetFaceMeshes(geometry: PaintedThreeSheetGeometry, materialOf: (id: string) => Material): Map<string, Mesh> {
  return new Map([...geometry.faces].map(([id, face]) => {
    const mesh = new Mesh(face.geometry, materialOf(id));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return [id, mesh];
  }));
}

/**
 * One sheet's faces as meshes looking as `material` says, its geometry its own. Refuses whatever its folding refuses
 * (paintedThreeSheetFolding).
 */
export function createPaintedThreeSheet(sheet: PaintedThreeSheet, material: PaintedThreeSheetMaterial): PaintedThreeSheetMeshes {
  const folding = paintedThreeSheetFolding(sheet), geometry = createPaintedThreeSheetGeometry(folding);
  const faces = createPaintedThreeSheetFaceMeshes(geometry, (id) => material.faceMaterial(geometry.faces.get(id)!));
  return {
    folding,
    faces,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
