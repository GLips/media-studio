// painted-three-shadows.ts: shadow maps for a three source that asks for them (PaintedThreeSourceScene.shadows), on
// around that source's renders alone and put back after, as the renderer is the device's one.
//
// Soft shadows are percentage-closer soft shadows: a search of the map round the receiver finds how far its
// blockers lie, and the penumbra widens with the gap behind them, so a contact stays tight and a cast shadow softens.
// The noise turning each pixel's taps is fixed per pixel, so a fast frame and a reference exposure draw one shadow.
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

/** The widest a soft light may be, degrees: past it a penumbra outgrows any search of the map. */
const PAINTED_THREE_SOFTNESS_MOST = 20;
/** Taps finding a receiver's blockers (raw depth reads), then filtering its penumbra (each a hardware 2 × 2 comparison). */
const PAINTED_THREE_SEARCH_TAPS = 16;
const PAINTED_THREE_FILTER_TAPS = 24;
/** How far round a receiver the search reaches at most, shadow-map texels: past it, blockers go unseen. */
const PAINTED_THREE_SEARCH_MOST_TEXELS = 48;

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

    // Blockers anywhere from the shadow camera's near plane can shade the receiver: search as wide as one there would.
    const search = uvPerUnit.mul(penumbra(near)).clamp(texel, texel.mul(PAINTED_THREE_SEARCH_MOST_TEXELS));
    const blockers = float(0).toVar(), blockersReach = float(0).toVar();
    Loop(PAINTED_THREE_SEARCH_TAPS, ({ i }) => {
      const tap = shadowCoord.xy.add(vogelDiskSample(i, int(PAINTED_THREE_SEARCH_TAPS), phi).mul(search)).mul(mapSize).clamp(vec2(0), mapSize.sub(1));
      // A depth texture reads as one float; @types/three types it a vec4, whose .r three passes over.
      const depth = layered(textureLoad(depthTexture, ivec2(tap), int(0))).r.toVar();
      const blocks = step(depth, receiver);
      blockers.addAssign(blocks);
      blockersReach.addAssign(distanceAt(depth).mul(blocks));
    });
    // A texel's width at the least, so a hard edge is antialiased as three's own filter does.
    const spread = uvPerUnit.mul(penumbra(blockersReach.div(blockers.max(1)))).max(texel);
    const lit = float(0).toVar();
    Loop(PAINTED_THREE_FILTER_TAPS, ({ i }) => {
      lit.addAssign(layered(texture(depthTexture, shadowCoord.xy.add(vogelDiskSample(i, int(PAINTED_THREE_FILTER_TAPS), phi).mul(spread)))).compare(receiver));
    });
    // No blocker within the search: a blocker past it (or none) shades the receiver as the map alone says.
    return blockers.greaterThan(0).select(lit.div(PAINTED_THREE_FILTER_TAPS), own);
  });
}

/** How a source's renders take shadows: `on` sets the renderer as it asks, returning what puts it back as it was. */
export type PaintedThreeShadowing = { readonly on: (renderer: WebGPURenderer) => () => void };

/**
 * Shadows for source `id`'s `scene`, as `shadows` asks, or none when left out. Each casting directional or spot light
 * is given its soft filter before it first renders, so one a pose adds is soft too. Refuses a softness out of range.
 */
export function createPaintedThreeShadowing(id: string, scene: Scene, shadows: PaintedThreeShadows | undefined): PaintedThreeShadowing {
  const softness = shadows?.softness ?? 0;
  if (!(softness >= 0 && softness <= PAINTED_THREE_SOFTNESS_MOST)) {
    throw new Error(`painted three: source ${id}'s shadows.softness is a light's angular radius from 0 to ${PAINTED_THREE_SOFTNESS_MOST} degrees, not ${softness}`);
  }
  const tangent = Math.tan((softness * Math.PI) / 180), filtered = new WeakSet<DirectionalLight | SpotLight>();
  const filterLights = () => scene.traverse((light) => {
    if (!((light instanceof DirectionalLight || light instanceof SpotLight) && light.castShadow) || filtered.has(light)) return;
    // three reads a shadow's filterNode as it builds the light's shadow; @types/three leaves the field out.
    Object.assign(light.shadow, { filterNode: paintedThreeSoftShadowFilter(light, tangent) });
    filtered.add(light);
  });
  return {
    on: (renderer) => {
      if (shadows) filterLights();
      const { enabled, type } = renderer.shadowMap;
      renderer.shadowMap.enabled = !!shadows;
      renderer.shadowMap.type = PCFShadowMap;
      return () => {
        renderer.shadowMap.enabled = enabled;
        renderer.shadowMap.type = type;
      };
    },
  };
}
