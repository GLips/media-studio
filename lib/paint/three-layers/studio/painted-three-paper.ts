// painted-three-paper.ts: paper as a material preset for folded sheets (painted-three-sheet.ts builds their meshes;
// the look's numbers are models'). Each face:
// - wrap-lights, normalised with its lights so a face toward the camera shows its print as painted, capped at
//   printLightMost of the print: pigment is never relit;
// - lerps a shadow toward the leak, never black; darkens toward the edge it stands on; kraft back, sides toward cream;
// - draws the cut edge and, facing the light, a lip from a field of its cut edges alone (none on a fold).
// Meshes sharing it each set their tint and glow (setPaintedThreePaperShow). It keeps three's own output and
// emission, so the lens's MRT (lens-three-motion.ts) records both.

import {
  Color, DirectionalLight, HemisphereLight, LightingModel, NodeMaterial, Vector3,
  type ExternalTexture, type LightingModelDirectInput, type Object3D, type LightingModelReflectedLight, type Node, type NodeBuilder,
} from 'three/webgpu';
import { dFdx, dFdy, diffuseColor, float, mix, modelWorldMatrixInverse, normalLocal, normalView, positionLocal, select, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { paintWorldLightDirection } from '#lib/paint/animation/models/paint-camera-world.ts';
import type { PaintLight } from '#lib/paint/painting/models/stamp-form.ts';
import {
  PAINTED_THREE_PAPER_LIGHT_SHARES, PAINTED_THREE_PAPER_LOOK, PAINTED_THREE_PAPER_SKY_GROUND, paintedThreePaperLightStrengths, type PaintedThreePaperLeak, type PaintedThreePaperLightShares,
} from '../models/painted-three-paper.ts';
import type { PaintedThreeSheet } from '../models/painted-three-sheet.ts';
import { paintedThreeColorNode } from './painted-three-material.ts';
import type { PaintedThreeSheetMaterial } from './painted-three-sheet.ts';

/** The smallest screen-space change of distance read as one: a face seen edge-on, or a flat stretch of the field. */
const PAINTED_THREE_PAPER_GRADIENT_LEAST = 1e-4;

/**
 * Wrap lighting with no 1/π (its lights are normalised to the print: paintedThreePaperLightStrengths), the total
 * capped at PAINTED_THREE_PAPER_LOOK.printLightMost of the print.
 */
class PaintedThreePaperLighting extends LightingModel {
  direct({ lightDirection, lightColor, reflectedLight }: LightingModelDirectInput) {
    const { wrap } = PAINTED_THREE_PAPER_LOOK;
    // SAFETY: three hands a light's direction, colour and reflected light as vec3 nodes; @types/three types them bare.
    const diffuse = reflectedLight.directDiffuse as Node<'vec3'>, toward = lightDirection as Node<'vec3'>, light = lightColor as Node<'vec3'>;
    diffuse.addAssign(normalView.dot(toward).add(wrap).div(1 + wrap).clamp().mul(light).mul(diffuseColor.rgb));
  }

  indirect(builder: NodeBuilder) {
    // SAFETY: inside a lighting context (LightingContextNode) three's context holds these vec3s; @types/three types it unknown.
    const { irradiance, reflectedLight } = builder.context as { irradiance: Node<'vec3'>; reflectedLight: Record<keyof LightingModelReflectedLight, Node<'vec3'>> };
    reflectedLight.indirectDiffuse.addAssign(irradiance.mul(diffuseColor.rgb));
  }

  finish(builder: NodeBuilder) {
    // SAFETY: LightsNode sets the context's outgoing light, a vec3, before it calls finish.
    const { outgoingLight } = builder.context as { outgoingLight: Node<'vec3'> };
    outgoingLight.assign(outgoingLight.min(diffuseColor.rgb.mul(PAINTED_THREE_PAPER_LOOK.printLightMost)));
  }
}

class PaintedThreePaperNodeMaterial extends NodeMaterial {
  constructor() {
    super();
    this.lights = true;
  }

  setupLightingModel() {
    return new PaintedThreePaperLighting();
  }
}

/**
 * How paper looks: `light`, the shot's (the lip faces it); `back`, its back's face: kraft (the default: blank paper)
 * or its print, mirrored as paper shows through; `leak`, the key's share its shadows keep (PaintedThreePaperLeak).
 */
export type PaintedThreePaperLook = { readonly light: PaintLight; readonly back?: 'kraft' | 'mirrored'; readonly leak?: PaintedThreePaperLeak };

/**
 * What differs between meshes sharing one paper material, set on each mesh (setPaintedThreePaperShow): `hue` and
 * `value`, its print's tint (PaintedThreePrintTint); `glow`, its glow map's strength. A mesh with none set shows plain.
 */
export type PaintedThreePaperShow = { readonly hue: number; readonly value: number; readonly glow: number };
const PAINTED_THREE_PAPER_PLAIN: PaintedThreePaperShow = { hue: 0, value: 0, glow: 1 };
const paperShows = new WeakMap<Object3D, PaintedThreePaperShow>();

/** Sets how `mesh` shows its shared paper material, read as each draw of it begins. */
export const setPaintedThreePaperShow = (mesh: Object3D, show: PaintedThreePaperShow) => void paperShows.set(mesh, show);

/** A per-mesh uniform reading `key` of the drawn mesh's show. */
const paperShowUniform = (key: keyof PaintedThreePaperShow) => uniform(PAINTED_THREE_PAPER_PLAIN[key]).onObjectUpdate(({ object }) => ((object && paperShows.get(object)) ?? PAINTED_THREE_PAPER_PLAIN)[key]);

/** An sRGB hex colour as a node, in linear light (three's Color decodes it). */
const paperColour = (hex: string) => {
  const { r, g, b } = new Color(hex);
  return vec3(r, g, b);
};

/** `rgb` turned by `hue` radians about the grey axis (Rodrigues), kept from going negative, then scaled by 1 + `value`. */
function paperTinted(rgb: Node<'vec3'>, hue: Node<'float'>, value: Node<'float'>) {
  const grey = vec3(1 / Math.sqrt(3)), cos = hue.cos();
  return rgb.mul(cos).add(grey.cross(rgb).mul(hue.sin())).add(grey.mul(grey.dot(rgb).mul(float(1).sub(cos)))).max(0).mul(value.add(1));
}

/**
 * Paper as a sheet's material (PaintedThreeSheetMaterial): every face shows `print` (`widthPx` × `heightPx`) at its
 * flat-layout px, so one print spans the folded sheet, tinted as each mesh's show says; `glow`, when given, an
 * emission map spanning the print alike, added unlit on the front, times the mesh's glow. Share it across a
 * geometry and print; light it with createPaintedThreePaperLights.
 */
export function paintedThreePaperMaterial(
  { widthPx, heightPx }: Pick<PaintedThreeSheet, 'widthPx' | 'heightPx'>, print: ExternalTexture, { light, back = 'kraft', leak = PAINTED_THREE_PAPER_LOOK.leak }: PaintedThreePaperLook,
  glow: ExternalTexture | null = null,
): PaintedThreeSheetMaterial {
  const { edge, lip, side, contact } = PAINTED_THREE_PAPER_LOOK;
  // Print px, y down: sheet space is the flat print's.
  const px = vec2(positionLocal.x, positionLocal.y.negate()), printUv = px.div(vec2(widthPx, heightPx));
  const printed = paperTinted(paintedThreeColorNode(print, printUv).rgb, paperShowUniform('hue'), paperShowUniform('value'));
  // The light in face space, its y turned down as the field's normals run; only its share along the face counts.
  const toward = paintWorldLightDirection(light), lightFace = modelWorldMatrixInverse.mul(vec4(uniform(new Vector3(toward.x, toward.y, toward.z)), 0)).xyz.normalize();
  const front = normalLocal.z.greaterThan(0.5), behind = normalLocal.z.lessThan(-0.5), onFace = select(front.or(behind), float(1), float(0));
  const sideColour = mix(printed.mul(side.shade), paperColour(side.cream), side.towardCream);
  const faceColour = select(front, printed, select(behind, back === 'mirrored' ? printed : paperColour(PAINTED_THREE_PAPER_LOOK.kraft), sideColour));
  const glowing = glow && select(front, paintedThreeColorNode(glow, printUv).rgb.mul(paperShowUniform('glow')), vec3(0));
  const made: PaintedThreePaperNodeMaterial[] = [];
  return {
    faceMaterial: ({ field }) => {
      const at = texture(field.texture, px.sub(vec2(field.box.x0, field.box.y0)).div(vec2(field.box.width, field.box.height)));
      const cut = at.r, stand = at.g, outward = at.ba.div(at.ba.length().max(1e-3));

      // Screen px from the cut: the field's print px over how many of them a screen px spans here.
      const edgePx = cut.div(vec2(dFdx(cut), dFdy(cut)).length().max(PAINTED_THREE_PAPER_GRADIENT_LEAST));
      const line = float(1).sub(smoothstep(edge.px - 0.5, edge.px + 0.5, edgePx));
      const inner = edgePx.sub(edge.px), lipPx = edge.px * lip.share;
      const lipBand = smoothstep(-0.5, 0.5, inner).mul(float(1).sub(smoothstep(lipPx - 0.5, lipPx + 0.5, inner)));
      const facing = outward.dot(vec2(lightFace.x, lightFace.y.negate())).clamp();
      const contactShare = float(1).sub(smoothstep(0, contact.reach * heightPx, stand)).mul(contact.strength);

      const contacted = mix(faceColour, paperColour(contact.tint), contactShare.mul(onFace));
      const lipped = mix(contacted, paperColour(lip.colour), lipBand.mul(facing).mul(lip.strength).mul(onFace));
      const material = new PaintedThreePaperNodeMaterial();
      material.colorNode = vec4(mix(lipped, paperColour(edge.ink), line.mul(edge.strength).mul(onFace)), 1);
      // NodeMaterial adds it after lighting and its cap (setupLighting), so a lit window reads at dusk; @types/three
      // declares it on the lit subclasses alone.
      if (glowing) Object.assign(material, { emissiveNode: glowing });
      // three hands each light's shadow to this before lighting with it; @types/three types it taking nothing.
      Object.assign(material, { receivedShadowNode: (shadow: Node<'float'>) => mix(vec3(...leak), vec3(1), shadow) });
      made.push(material);
      return material;
    },
    dispose: () => {
      for (const each of made) each.dispose();
    },
  };
}

/**
 * Paper's lights: the key, casting; a fill from the camera; a sky. Add `lights` (the directional lights' targets
 * among them) to the scene, not to a rig, so they stay the world's.
 */
export type PaintedThreePaperLights = { readonly key: DirectionalLight; readonly lights: readonly Object3D[]; readonly dispose: () => void };

/** Each light's shadow map side, texels. */
const PAINTED_THREE_PAPER_SHADOW_MAP = 2048;

/**
 * Lights for paper under `light`, normalised to its prints, `shares` the fill's and sky's (zeros for a key-only
 * view). The key's shadow camera fits `around` (world units) once, holding every pose so it doesn't pump. Its normal
 * bias is `paper`, the sheets' thickness, or a shadow texel if wider: under a texel, lit paper shades itself in stripes.
 */
export function createPaintedThreePaperLights(
  light: PaintLight, { around, paper, shares = PAINTED_THREE_PAPER_LIGHT_SHARES }: { around: { centre: Vector3; radius: number }; paper: number; shares?: PaintedThreePaperLightShares },
): PaintedThreePaperLights {
  const strengths = paintedThreePaperLightStrengths(light, shares), { centre, radius } = around, toward = paintWorldLightDirection(light);
  const aim = (each: DirectionalLight, x: number, y: number, z: number) => {
    each.position.copy(centre).add(new Vector3(x, y, z).multiplyScalar(2 * radius));
    each.target.position.copy(centre);
    return each;
  };
  const key = aim(new DirectionalLight(0xffffff, strengths.key), toward.x, toward.y, toward.z);
  key.castShadow = true;
  key.shadow.mapSize.set(PAINTED_THREE_PAPER_SHADOW_MAP, PAINTED_THREE_PAPER_SHADOW_MAP);
  key.shadow.normalBias = Math.max(paper, (2 * radius) / PAINTED_THREE_PAPER_SHADOW_MAP);
  // The shadow camera sits 2 radii out, so `near` lies on the near side of everything it may need to shade.
  Object.assign(key.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: radius, far: 3 * radius });
  key.shadow.camera.updateProjectionMatrix();
  const fill = aim(new DirectionalLight(0xffffff, strengths.fill), 0, 0, 1);
  const ground = PAINTED_THREE_PAPER_SKY_GROUND, sky = new HemisphereLight(0xffffff, new Color(ground, ground, ground), strengths.sky);
  return {
    key,
    lights: [key, key.target, fill, fill.target, sky],
    dispose: () => {
      key.dispose();
      fill.dispose();
      sky.dispose();
    },
  };
}
