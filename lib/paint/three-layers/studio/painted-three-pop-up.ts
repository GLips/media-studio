// painted-three-pop-up.ts: a pop-up as a three source's scene: its base and sheets made as paper sheets
// (painted-three-sheet.ts, painted-three-paper.ts), every face posed each moment by its rig
// (models/painted-three-pop-up.ts), lit by the shot's light from the world, outside the tipped rig, so its shadows agree
// with the 2D cards' and the painted shading's.

import { Group, Scene, Vector3, type Mesh } from 'three/webgpu';
import type { PaintedThreePaperLeak, PaintedThreePaperLightShares } from '../models/painted-three-paper.ts';
import { paintedThreePopUpRig, PAINTED_THREE_POP_UP_BASE, type PaintedThreePopUp } from '../models/painted-three-pop-up.ts';
import type { PaintedThreeSheet } from '../models/painted-three-sheet.ts';
import { createPaintedThreePaperLights, paintedThreePaperMaterial } from './painted-three-paper.ts';
import { createPaintedThreeSheet, type PaintedThreeSheetMeshes } from './painted-three-sheet.ts';
import type { PaintedThreeSource } from './painted-three-sources.ts';

/** The key's angular radius, degrees: its penumbra a quarter of the gap behind a card, as the recipe's 0.2–0.3. */
const PAINTED_THREE_POP_UP_SOFTNESS = 14;

/**
 * How a pop-up is shown beyond its rig: its sheets' `back` and `leak` (PaintedThreePaperLook), and its fill and sky
 * (`lights`, PAINTED_THREE_PAPER_LIGHT_SHARES when left out: zeros and a black leak make the key-only view).
 */
export type PaintedThreePopUpLook = { readonly back?: 'kraft' | 'mirrored'; readonly leak?: PaintedThreePaperLeak; readonly lights?: PaintedThreePaperLightShares };

/**
 * `popUp` as a three source's build: its base and sheets each showing its print, the painted texture its `print`
 * names, on the source's plane; lit by the shot's light, with soft shadows. Refuses a print with no painted texture,
 * and whatever its rig refuses (paintedThreePopUpRig).
 */
export function paintedThreePopUp(popUp: PaintedThreePopUp, look: PaintedThreePopUpLook = {}): PaintedThreeSource['build'] {
  const rig = paintedThreePopUpRig(popUp), byId = new Map<string, PaintedThreeSheet>([[PAINTED_THREE_POP_UP_BASE, popUp.base], ...popUp.sheets.map((sheet) => [sheet.id, sheet] as const)]);
  return ({ plane, textures, light }) => {
    const scene = new Scene(), root = new Group(), scale = plane.length(popUp.scale ?? 1), centre = plane.point(popUp.at);
    root.position.set(centre.x, centre.y, centre.z);
    root.scale.setScalar(scale);
    const made: PaintedThreeSheetMeshes[] = [], meshes = new Map<string, ReadonlyMap<string, Mesh>>();
    const dispose = () => {
      for (const each of made) each.dispose();
    };
    try {
      for (const id of rig.order) {
        const sheet = { ...byId.get(id)!, thicknessPx: rig.folding.get(id)!.thickness }, print = textures.get(sheet.print);
        if (!print) throw new Error(`painted three pop-up: sheet ${id}'s print ${sheet.print} is no painted texture of the shot`);
        const each = createPaintedThreeSheet(sheet, paintedThreePaperMaterial(sheet, print, { light, ...look }));
        made.push(each);
        meshes.set(id, each.faces);
        root.add(...each.faces.values());
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
          for (const [face, matrix] of faces) {
            const mesh = meshes.get(id)!.get(face)!;
            mesh.matrix.copy(matrix);
            mesh.matrixWorldNeedsUpdate = true;
          }
        }
      },
      shadows: { softness: PAINTED_THREE_POP_UP_SOFTNESS },
      dispose: () => {
        dispose();
        lights.dispose();
      },
    };
  };
}
