// painted-three-pop-up.ts: a pop-up as a three source's scene: its base and sheets made as paper sheets
// (painted-three-sheet.ts, painted-three-paper.ts), every face posed each moment by its rig
// (models/painted-three-pop-up.ts), lit by the shot's light from the world, outside the tipped rig, so its shadows agree
// with the 2D cards' and the painted shading's.
//
// A diorama shows many sheets cut alike from few prints: each net's geometry and fields are built once, and its
// material once a print and glow map, every sheet's meshes sharing them with its own tint and glow strength.
// Ordinary meshes, not instanced: the lens's motion MRT reads no instance matrices.

import { Group, Scene, Vector3, type Material, type Mesh } from 'three/webgpu';
import { presentationValueAt } from '#lib/paint/animation/models/paint-value.ts';
import type { PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { PaintedThreePaperLeak, PaintedThreePaperLightShares } from '../models/painted-three-paper.ts';
import { paintedThreePopUpRig, PAINTED_THREE_POP_UP_BASE, type PaintedThreePopUp, type PaintedThreePopUpSheet } from '../models/painted-three-pop-up.ts';
import type { PaintedThreeSheet } from '../models/painted-three-sheet.ts';
import { createPaintedThreePaperLights, paintedThreePaperMaterial, setPaintedThreePaperShow, type PaintedThreePaperShow } from './painted-three-paper.ts';
import { createPaintedThreeSheetFaceMeshes, createPaintedThreeSheetGeometry, type PaintedThreeSheetMaterial, type PaintedThreeSheetGeometry } from './painted-three-sheet.ts';
import type { PaintedThreeSource } from './painted-three-sources.ts';

/** The key's angular radius, degrees: its penumbra a quarter of the gap behind a card, as the recipe's 0.2–0.3. */
const PAINTED_THREE_POP_UP_SOFTNESS = 14;

/**
 * How a pop-up is shown beyond its rig: its sheets' `back` and `leak` (PaintedThreePaperLook), and its fill and sky
 * (`lights`, PAINTED_THREE_PAPER_LIGHT_SHARES when left out: zeros and a black leak make the key-only view).
 */
export type PaintedThreePopUpLook = { readonly back?: 'kraft' | 'mirrored'; readonly leak?: PaintedThreePaperLeak; readonly lights?: PaintedThreePaperLightShares };

/**
 * What makes two sheets share one geometry, built once: their faces, hinges and paper. Structural, so sheets spread from one
 * net share it; fold angles aren't in it, as each sheet folds its own way.
 */
const paintedThreeSheetGeometryKey = ({ root, folds = [] }: PaintedThreeSheet, thickness: number) => JSON.stringify([root, folds.map(({ angle: _angle, ...face }) => face), thickness]);

/** A sheet's show at `moment`: its tint, and its glow's strength. */
function paintedThreePopUpShowAt(sheet: PaintedThreeSheet | PaintedThreePopUpSheet, moment: PaintMoment): PaintedThreePaperShow {
  if (!('id' in sheet)) return { hue: 0, value: 0, glow: 1 };
  return { hue: sheet.tint?.hue ?? 0, value: sheet.tint?.value ?? 0, glow: presentationValueAt(sheet.glowStrength ?? 1, moment) };
}

/**
 * `popUp` as a three source's build: its base and sheets each showing its print, the painted texture its `print`
 * names, and any glow map its `glow` names, on the source's plane; lit by the shot's light, with soft shadows. Refuses
 * a print or glow map with no painted texture, and whatever its rig refuses (paintedThreePopUpRig).
 */
export function paintedThreePopUp(popUp: PaintedThreePopUp, look: PaintedThreePopUpLook = {}): PaintedThreeSource['build'] {
  const rig = paintedThreePopUpRig(popUp);
  const byId = new Map<string, PaintedThreeSheet | PaintedThreePopUpSheet>([[PAINTED_THREE_POP_UP_BASE, popUp.base], ...popUp.sheets.map((sheet) => [sheet.id, sheet] as const)]);
  return ({ plane, textures, light }) => {
    const scene = new Scene(), root = new Group(), scale = plane.length(popUp.scale ?? 1), centre = plane.point(popUp.at);
    root.position.set(centre.x, centre.y, centre.z);
    root.scale.setScalar(scale);
    const geometries = new Map<string, PaintedThreeSheetGeometry>(), materials = new Map<string, PaintedThreeSheetMaterial>(), faceMaterials = new Map<string, Material>();
    const meshes = new Map<string, ReadonlyMap<string, Mesh>>();
    const dispose = () => {
      for (const each of [...geometries.values(), ...materials.values()]) each.dispose();
    };
    const textureOf = (id: string, sheet: string, what: string) => {
      const found = textures.get(id);
      if (!found) throw new Error(`painted three pop-up: sheet ${sheet}'s ${what} ${id} is no painted texture of the shot`);
      return found;
    };
    try {
      for (const id of rig.order) {
        const sheet = byId.get(id)!, folding = rig.folding.get(id)!, geometryKey = paintedThreeSheetGeometryKey(sheet, folding.thickness);
        const geometry = geometries.get(geometryKey) ?? createPaintedThreeSheetGeometry(folding);
        geometries.set(geometryKey, geometry);
        const glow = 'glow' in sheet ? (sheet.glow ?? null) : null, materialKey = JSON.stringify([geometryKey, sheet.print, sheet.widthPx, sheet.heightPx, glow]);
        const material = materials.get(materialKey)
          ?? paintedThreePaperMaterial(sheet, textureOf(sheet.print, id, 'print'), { light, ...look }, glow === null ? null : textureOf(glow, id, 'glow map'));
        materials.set(materialKey, material);
        const faces = createPaintedThreeSheetFaceMeshes(geometry, (face) => {
          const key = `${materialKey}|${face}`, made = faceMaterials.get(key) ?? material.faceMaterial(geometry.faces.get(face)!);
          faceMaterials.set(key, made);
          return made;
        });
        meshes.set(id, faces);
        root.add(...faces.values());
      }
    } catch (error) {
      dispose();
      throw error;
    }
    const paper = Math.max(...[...rig.folding.values()].map(({ thickness }) => thickness));
    const lights = createPaintedThreePaperLights(light, {
      around: { centre: new Vector3(centre.x, centre.y, centre.z), radius: scale * rig.reach }, paper: scale * paper, ...(look.lights && { shares: look.lights }),
    });
    scene.add(root, ...lights.lights);
    return {
      scene,
      poseAt: (moment) => {
        for (const [id, faces] of rig.poseAt(moment)) {
          const show = paintedThreePopUpShowAt(byId.get(id)!, moment);
          for (const [face, matrix] of faces) {
            const mesh = meshes.get(id)!.get(face)!;
            mesh.matrix.copy(matrix);
            mesh.matrixWorldNeedsUpdate = true;
            setPaintedThreePaperShow(mesh, show);
          }
        }
      },
      shadows: { softness: PAINTED_THREE_POP_UP_SOFTNESS },
      glows: popUp.sheets.some(({ glow }) => glow !== undefined),
      dispose: () => {
        dispose();
        lights.dispose();
      },
    };
  };
}
