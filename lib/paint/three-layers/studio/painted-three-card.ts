// painted-three-card.ts: a three.js card that reads as cut paper (its outline, field and numbers are models'): a
// painted texture cut along an authored outline, extruded to the paper's thickness. Its material:
// - wrap-lights, normalised with its lights so a card facing the camera shows its print as painted, capped at
//   printLightMost of the print: pigment is never relit;
// - lerps a shadow toward the leak, never black; darkens toward the hinge; kraft back, sides toward cream;
// - draws the cut edge and, facing the light, a lip from a field of the cut segments alone (none on a hinge).
// It keeps three's own output, so the lens's motion MRT (lens-three-motion.ts) records it.

import {
  Color, DataTexture, DataUtils, DirectionalLight, ExtrudeGeometry, HalfFloatType, HemisphereLight, LightingModel, LinearFilter, Mesh, NodeMaterial, RGBAFormat, Shape, Vector2, Vector3,
  type ExternalTexture, type LightingModelDirectInput, type Object3D, type LightingModelReflectedLight, type Node, type NodeBuilder,
} from 'three/webgpu';
import { dFdx, dFdy, diffuseColor, float, mix, modelWorldMatrixInverse, normalLocal, normalView, positionLocal, select, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { paintWorldLightDirection } from '#lib/paint/animation/models/paint-camera-world.ts';
import type { PaintLight } from '#lib/paint/painting/models/stamp-form.ts';
import {
  PAINTED_THREE_CARD_LIGHT_SHARES, PAINTED_THREE_CARD_LOOK, PAINTED_THREE_CARD_SKY_GROUND, paintedThreeCardField, paintedThreeCardLightStrengths, paintedThreeCardCut,
  paintedThreeCardThickness, type PaintedThreeCard, type PaintedThreeCardLeak, type PaintedThreeCardLightShares,
} from '../models/painted-three-card.ts';
import { paintedThreeColorNode } from './painted-three-material.ts';

/** The smallest screen-space change of distance read as one: a face seen edge-on, or a flat stretch of the field. */
const PAINTED_THREE_CARD_GRADIENT_LEAST = 1e-4;

/**
 * Wrap lighting with no 1/π (its lights are normalised to the print: paintedThreeCardLightStrengths), the total
 * capped at PAINTED_THREE_CARD_LOOK.printLightMost of the print.
 */
class PaintedThreeCardLighting extends LightingModel {
  direct({ lightDirection, lightColor, reflectedLight }: LightingModelDirectInput) {
    const { wrap } = PAINTED_THREE_CARD_LOOK;
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
    outgoingLight.assign(outgoingLight.min(diffuseColor.rgb.mul(PAINTED_THREE_CARD_LOOK.printLightMost)));
  }
}

class PaintedThreeCardMaterial extends NodeMaterial {
  constructor() {
    super();
    this.lights = true;
  }

  setupLightingModel() {
    return new PaintedThreeCardLighting();
  }
}

/**
 * How a card looks: `light`, the shot's (the lip faces it); `back`, its back's face: kraft (the default: blank paper)
 * or its print, mirrored as paper shows through; `leak`, the key's share its shadows keep (PaintedThreeCardLeak).
 */
export type PaintedThreeCardLook = { readonly light: PaintLight; readonly back?: 'kraft' | 'mirrored'; readonly leak?: PaintedThreeCardLeak };

/** An sRGB hex colour as a node, in linear light (three's Color decodes it). */
const paperColour = (hex: string) => {
  const { r, g, b } = new Color(hex);
  return vec3(r, g, b);
};

/** `card`'s distance field as a half-float texture, filtered. */
function paintedThreeCardFieldTexture(card: PaintedThreeCard): { texture: DataTexture; extent: { width: number; height: number } } {
  const { columns, rows, cell, values } = paintedThreeCardField(card);
  const halves = new DataTexture(Uint16Array.from(values, (v) => DataUtils.toHalfFloat(v)), columns, rows, RGBAFormat, HalfFloatType);
  halves.magFilter = halves.minFilter = LinearFilter;
  halves.needsUpdate = true;
  return { texture: halves, extent: { width: columns * cell, height: rows * cell } };
}

/**
 * `card` as a mesh showing `print` (its painted texture), in card space: print px, x right, y up from its top left,
 * its front facing +z and centred on z. Scale it to the world (a plane's `length`) and place it. Casts and receives
 * shadows; light it with createPaintedThreeCardLights.
 */
export function createPaintedThreeCard(card: PaintedThreeCard, print: ExternalTexture, { light, back = 'kraft', leak = PAINTED_THREE_CARD_LOOK.leak }: PaintedThreeCardLook): { mesh: Mesh; dispose: () => void } {
  const { polygon } = paintedThreeCardCut(card), thickness = paintedThreeCardThickness(card), { edge, lip, side, contact } = PAINTED_THREE_CARD_LOOK;
  const geometry = new ExtrudeGeometry(new Shape(polygon.map(({ x, y }) => new Vector2(x, -y))), { depth: thickness, bevelEnabled: false, steps: 1 }).translate(0, 0, -thickness / 2);
  const field = paintedThreeCardFieldTexture(card);

  // Print px, y down; the print and the field each read in its own extent.
  const px = vec2(positionLocal.x, positionLocal.y.negate());
  const printed = paintedThreeColorNode(print, px.div(vec2(card.widthPx, card.heightPx))).rgb;
  const at = texture(field.texture, px.div(vec2(field.extent.width, field.extent.height)));
  const cut = at.r, hinge = at.g, outward = at.ba.div(at.ba.length().max(1e-3));

  // Screen px from the cut: the field's print px over how many of them a screen px spans here.
  const edgePx = cut.div(vec2(dFdx(cut), dFdy(cut)).length().max(PAINTED_THREE_CARD_GRADIENT_LEAST));
  const line = float(1).sub(smoothstep(edge.px - 0.5, edge.px + 0.5, edgePx));
  const inner = edgePx.sub(edge.px), lipPx = edge.px * lip.share;
  const lipBand = smoothstep(-0.5, 0.5, inner).mul(float(1).sub(smoothstep(lipPx - 0.5, lipPx + 0.5, inner)));
  // The light in card space, its y turned down as the field's normals run; only its share along the face counts.
  const toward = paintWorldLightDirection(light), lightCard = modelWorldMatrixInverse.mul(vec4(uniform(new Vector3(toward.x, toward.y, toward.z)), 0)).xyz.normalize();
  const facing = outward.dot(vec2(lightCard.x, lightCard.y.negate())).clamp();
  const contactShare = float(1).sub(smoothstep(0, contact.reach * card.heightPx, hinge)).mul(contact.strength);

  const front = normalLocal.z.greaterThan(0.5), behind = normalLocal.z.lessThan(-0.5), onFace = select(front.or(behind), float(1), float(0));
  const sideColour = mix(printed.mul(side.shade), paperColour(side.cream), side.towardCream);
  const faceColour = select(front, printed, select(behind, back === 'mirrored' ? printed : paperColour(PAINTED_THREE_CARD_LOOK.kraft), sideColour));
  const contacted = mix(faceColour, paperColour(contact.tint), contactShare.mul(onFace));
  const lipped = mix(contacted, paperColour(lip.colour), lipBand.mul(facing).mul(lip.strength).mul(onFace));

  const material = new PaintedThreeCardMaterial();
  material.colorNode = vec4(mix(lipped, paperColour(edge.ink), line.mul(edge.strength).mul(onFace)), 1);
  // three hands each light's shadow to this before lighting with it; @types/three types it taking nothing.
  Object.assign(material, { receivedShadowNode: (shadow: Node<'float'>) => mix(vec3(...leak), vec3(1), shadow) });

  const mesh = new Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  return {
    mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      field.texture.dispose();
    },
  };
}

/**
 * A card's lights: the key, casting; a fill from the camera; a sky. Add `lights` (the directional lights' targets
 * among them) to the scene, not to a rig, so they stay the world's.
 */
export type PaintedThreeCardLights = { readonly key: DirectionalLight; readonly lights: readonly Object3D[]; readonly dispose: () => void };

/** Each light's shadow map side, texels. */
const PAINTED_THREE_CARD_SHADOW_MAP = 2048;

/**
 * Lights for cards under `light`, normalised to their prints (paintedThreeCardLightStrengths), `shares` the fill's
 * and sky's (PAINTED_THREE_CARD_LIGHT_SHARES when left out; zeros for a key-only view). The key's shadow camera is
 * fitted once round `around` (world units), which must hold every pose, so it doesn't pump between shutter ends; its
 * normal bias is `paper`, the cards' thickness in world units.
 */
export function createPaintedThreeCardLights(
  light: PaintLight, { around, paper, shares = PAINTED_THREE_CARD_LIGHT_SHARES }: { around: { centre: Vector3; radius: number }; paper: number; shares?: PaintedThreeCardLightShares },
): PaintedThreeCardLights {
  const strengths = paintedThreeCardLightStrengths(light, shares), { centre, radius } = around, toward = paintWorldLightDirection(light);
  const aim = (each: DirectionalLight, x: number, y: number, z: number) => {
    each.position.copy(centre).add(new Vector3(x, y, z).multiplyScalar(2 * radius));
    each.target.position.copy(centre);
    return each;
  };
  const key = aim(new DirectionalLight(0xffffff, strengths.key), toward.x, toward.y, toward.z);
  key.castShadow = true;
  key.shadow.mapSize.set(PAINTED_THREE_CARD_SHADOW_MAP, PAINTED_THREE_CARD_SHADOW_MAP);
  key.shadow.normalBias = paper;
  // The shadow camera sits 2 radii out, so `near` lies on the near side of everything it may need to shade.
  Object.assign(key.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: radius, far: 3 * radius });
  key.shadow.camera.updateProjectionMatrix();
  const fill = aim(new DirectionalLight(0xffffff, strengths.fill), 0, 0, 1);
  const ground = PAINTED_THREE_CARD_SKY_GROUND, sky = new HemisphereLight(0xffffff, new Color(ground, ground, ground), strengths.sky);
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
