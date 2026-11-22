// painted-three-pop-up.ts: a pop-up as a three source's scene: its base and cards made as paper cards
// (painted-three-card.ts), posed each moment by its rig (models/painted-three-pop-up.ts), lit by the shot's light from
// the world, outside the tipped rig, so its shadows agree with the 2D cards' and the painted shading's.

import { Group, Scene, Vector3, type Mesh } from 'three/webgpu';
import type { PaintedThreeCardLeak, PaintedThreeCardLightShares } from '../models/painted-three-card.ts';
import { paintedThreePopUpRig, PAINTED_THREE_POP_UP_BASE, type PaintedThreePopUp } from '../models/painted-three-pop-up.ts';
import { createPaintedThreeCard, createPaintedThreeCardLights } from './painted-three-card.ts';
import type { PaintedThreeSource } from './painted-three-sources.ts';

/** The key's angular radius, degrees: its penumbra a quarter of the gap behind a card, as the recipe's 0.2–0.3. */
const PAINTED_THREE_POP_UP_SOFTNESS = 14;

/**
 * How a pop-up is shown beyond its rig: its cards' `back` and `leak` (PaintedThreeCardLook), and its fill and sky
 * (`lights`, PAINTED_THREE_CARD_LIGHT_SHARES when left out: zeros and a black leak make the key-only view).
 */
export type PaintedThreePopUpLook = { readonly back?: 'kraft' | 'mirrored'; readonly leak?: PaintedThreeCardLeak; readonly lights?: PaintedThreeCardLightShares };

/**
 * `popUp` as a three source's build: its base and cards each showing its print, the painted texture its `print`
 * names, on the source's plane; lit by the shot's light, with soft shadows. Refuses a print with no painted texture,
 * and whatever its rig refuses (paintedThreePopUpRig).
 */
export function paintedThreePopUp(popUp: PaintedThreePopUp, look: PaintedThreePopUpLook = {}): PaintedThreeSource['build'] {
  const rig = paintedThreePopUpRig(popUp), byId = new Map([[PAINTED_THREE_POP_UP_BASE, popUp.base], ...popUp.cards.map((card) => [card.id, card] as const)]);
  return ({ plane, textures, light }) => {
    const scene = new Scene(), root = new Group(), scale = plane.length(popUp.scale ?? 1), centre = plane.point(popUp.at);
    root.position.set(centre.x, centre.y, centre.z);
    root.scale.setScalar(scale);
    const made: { mesh: Mesh; dispose: () => void }[] = [], meshes = new Map<string, Mesh>();
    const dispose = () => {
      for (const each of made) each.dispose();
    };
    try {
      for (const id of rig.order) {
        const card = byId.get(id)!, print = textures.get(card.print);
        if (!print) throw new Error(`painted three pop-up: card ${id}'s print ${card.print} is no painted texture of the shot`);
        const each = createPaintedThreeCard({ ...card, thicknessPx: rig.thickness.get(id)! }, print, { light, ...look });
        made.push(each);
        each.mesh.matrixAutoUpdate = false;
        meshes.set(id, each.mesh);
        root.add(each.mesh);
      }
    } catch (error) {
      dispose();
      throw error;
    }
    const lights = createPaintedThreeCardLights(light, {
      around: { centre: new Vector3(centre.x, centre.y, centre.z), radius: scale * rig.reach }, paper: scale * Math.max(...rig.thickness.values()), ...(look.lights && { shares: look.lights }),
    });
    scene.add(root, ...lights.lights);
    return {
      scene,
      poseAt: (moment) => {
        for (const [id, matrix] of rig.poseAt(moment)) {
          const mesh = meshes.get(id)!;
          mesh.matrix.copy(matrix);
          mesh.matrixWorldNeedsUpdate = true;
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
