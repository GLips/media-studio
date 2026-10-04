// painted-three-shadows.ts: shadow maps for a three source that asks for them (PaintedThreeSourceScene.shadows), on
// around that source's renders alone and put back after, as the renderer is the device's one.
//
// Soft shadows are percentage-closer soft shadows: a search round the receiver finds how far its blockers lie,
// and the penumbra widens with the gap behind them, so a contact stays tight and a cast shadow softens. The search
// reaches as far as a blocker on the shadow camera's near plane could shade. The taps' noise is fixed per pixel,
// so a fast frame and a reference exposure draw one shadow.
// Negative space: a reversed depth buffer would turn the search's comparison round; the studio's renderer has none.

import { DirectionalLight, PCFShadowMap, SpotLight, Vector3, type DepthTexture, type LightShadow, type Node, type Scene, type TextureNode, type WebGPURenderer } from 'three/webgpu';
import {
  float, Fn, int, interleavedGradientNoise, ivec2, Loop, orthographicDepthToViewZ, perspectiveDepthToViewZ, reference, screenCoordinate, step, tan, texture, textureLoad, uniform,
  vec2, vogelDiskSample,
} from 'three/tsl';

/**
 * Shadow maps for one source: directional and spot lights with `castShadow` cast, from meshes with `castShadow` onto
 * those with `receiveShadow`, through each light's shadow camera, map size and bias. `softness`: each light's angular
 * radius in degrees, as ThreeStage's `softShadows` (0, hard, when left out). Negative space: a point light casts as
 * three.js filters it, hard throughout.
 */
export type PaintedThreeShadows = { readonly softness?: number };

/**
 * The widest a soft light may be, degrees. The search's disc grows with the light, its taps fixed: past this they
 * lie too far apart to find a caster's edge.
 */
const PAINTED_THREE_SOFTNESS_MOST = 20;
/** Taps finding a receiver's blockers (raw depth reads), then filtering its penumbra (each a hardware 2 × 2 comparison). */
const PAINTED_THREE_SEARCH_TAPS = 32;
const PAINTED_THREE_FILTER_TAPS = 32;

/**
 * What three hands a light's shadow filter as it builds the light's shadow (ShadowNode's filterNode): `depthLayer`, the
 * layer of a map that's an array texture.
 */
type PaintedThreeShadowFilterInputs = { readonly depthTexture: DepthTexture; readonly shadowCoord: Node<'vec3'>; readonly shadow: LightShadow; readonly depthLayer: number };

const fromLight = new Vector3(), toTarget = new Vector3();

/**
 * `light`'s soft shadow filter, `tangent` the tangent of its angular radius. Distances run from the light along its
 * view: a directional light's penumbra is the gap behind its blocker times the tangent; a spot light's, its disc (its
 * distance to its target times the tangent) scaled by that gap over the blocker's distance.
 */
function paintedThreeSoftShadowFilter(light: DirectionalLight | SpotLight, tangent: number) {
  // Its disc's radius, world units: read each render, as the light or its target may move.
  const disc = uniform(0).onRenderUpdate(() => light.getWorldPosition(fromLight).distanceTo(light.target.getWorldPosition(toTarget)) * tangent);
  return Fn(({ depthTexture, shadowCoord, shadow, depthLayer }: PaintedThreeShadowFilterInputs) => {
    const { camera } = shadow, spot = light instanceof SpotLight;
    const at = (name: string) => reference(name, 'float', camera);
    const near = at('near'), far = at('far'), zoom = at('zoom');
    const mapSize = reference('mapSize', 'vec2', shadow), texel = vec2(1).div(mapSize);
    const distanceAt = (depth: Node<'float'>): Node<'float'> => (spot ? perspectiveDepthToViewZ(depth, near, far) : orthographicDepthToViewZ(depth, near, far)).negate();
    const receiver = shadowCoord.z, reached = distanceAt(receiver).toVar();
    // Shadow-map uv a world unit spans across the light's view where the receiver lies.
    const uvPerUnit = spot
      ? vec2(at('aspect').reciprocal(), 1).mul(zoom.div(reached.mul(2).mul(tan(at('fov').mul(Math.PI / 360)))))
      : vec2(zoom.div(at('right').sub(at('left'))), zoom.div(at('top').sub(at('bottom'))));
    // The penumbra's radius on the receiver, world units, cast by a blocker `blocker` from the light.
    const penumbra = (blocker: Node<'float'>) => (spot ? disc.mul(reached.sub(blocker)).div(blocker) : reached.sub(blocker).mul(tangent));
    const phi = interleavedGradientNoise(screenCoordinate.xy).mul(2 * Math.PI);
    const layered = <T extends TextureNode>(read: T): T => (depthTexture.isArrayTexture ? read.depth(int(depthLayer)) : read);
    // Read first: a texture's first read in a shader sets its binding, and this one wants a comparison sampler. The
    // search below loads texels, which takes no sampler.
    const own = layered(texture(depthTexture, shadowCoord.xy)).compare(receiver).toVar();

    // The widest penumbra any blocker casts here is one's on the near plane: search that far, and a texel at the
    // least, so a hard edge is antialiased as three's own filter does.
    const search = uvPerUnit.mul(penumbra(near)).max(texel);
    const blockers = float(0).toVar(), blockersReach = float(0).toVar();
    Loop(PAINTED_THREE_SEARCH_TAPS, ({ i }) => {
      const tap = shadowCoord.xy.add(vogelDiskSample(i, int(PAINTED_THREE_SEARCH_TAPS), phi).mul(search)).mul(mapSize).clamp(vec2(0), mapSize.sub(1));
      // A depth texture reads as one float; @types/three types it a vec4, whose .r three passes over.
      const depth = layered(textureLoad(depthTexture, ivec2(tap), int(0))).r.toVar();
      const blocks = step(depth, receiver);
      blockers.addAssign(blocks);
      blockersReach.addAssign(distanceAt(depth).mul(blocks));
    });
    // Blockers lie past the near plane, so their penumbra is never wider than the search: the shadow fades out
    // within it rather than stepping to lit at its edge.
    const spread = uvPerUnit.mul(penumbra(blockersReach.div(blockers.max(1)))).max(texel);
    const lit = float(0).toVar();
    Loop(PAINTED_THREE_FILTER_TAPS, ({ i }) => {
      lit.addAssign(layered(texture(depthTexture, shadowCoord.xy.add(vogelDiskSample(i, int(PAINTED_THREE_FILTER_TAPS), phi).mul(spread)))).compare(receiver));
    });
    // No blocker found: lit, unless one too thin for the search's taps covers the receiver itself.
    return blockers.greaterThan(0).select(lit.div(PAINTED_THREE_FILTER_TAPS), own);
  });
}

/** Sets a renderer's shadow maps as a source asks, returning what puts them back as they were. */
export type PaintedThreeShadowsOn = (renderer: WebGPURenderer) => () => void;

/**
 * Shadows for source `id`'s renders of `scenes` (its own and its offscreen passes'), as `shadows` asks, or none when
 * left out. Each casting directional or spot light in them is given its soft filter before it first renders, so one a
 * pose adds is soft too. Refuses a softness out of range.
 */
export function createPaintedThreeShadowsOn(id: string, scenes: readonly Scene[], shadows: PaintedThreeShadows | undefined): PaintedThreeShadowsOn {
  const softness = shadows?.softness ?? 0;
  if (!(softness >= 0 && softness <= PAINTED_THREE_SOFTNESS_MOST)) {
    throw new Error(`painted three: source ${id}'s shadows.softness is a light's angular radius from 0 to ${PAINTED_THREE_SOFTNESS_MOST} degrees, not ${softness}`);
  }
  const tangent = Math.tan((softness * Math.PI) / 180), filtered = new WeakSet<DirectionalLight | SpotLight>();
  const filterLights = (scene: Scene) => scene.traverse((light) => {
    if (!((light instanceof DirectionalLight || light instanceof SpotLight) && light.castShadow) || filtered.has(light)) return;
    // three reads a shadow's filterNode as it builds the light's shadow; @types/three leaves the field out.
    Object.assign(light.shadow, { filterNode: paintedThreeSoftShadowFilter(light, tangent) });
    filtered.add(light);
  });
  return (renderer) => {
    if (shadows) for (const scene of scenes) filterLights(scene);
    const { enabled, type } = renderer.shadowMap;
    renderer.shadowMap.enabled = !!shadows;
    renderer.shadowMap.type = PCFShadowMap;
    return () => {
      renderer.shadowMap.enabled = enabled;
      renderer.shadowMap.type = type;
    };
  };
}
