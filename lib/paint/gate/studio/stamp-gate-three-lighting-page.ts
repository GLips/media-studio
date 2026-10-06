// stamp-gate-three-lighting-page.ts: the gate page's lit three.js shot (stamp-gate-three-lighting.ts): each stand
// built as a scene of its own from the case's numbers, the shadowed one with soft shadows and a planar mirror in its
// floor, drawn frame after frame through the shot's renderer; and the shadowed stand's source loaded apart, rendered
// at exposures one straight after another and read back as rendered.

import {
  BoxGeometry, Color, DirectionalLight, Group, HalfFloatType, HemisphereLight, LinearMipmapLinearFilter, Mesh, MeshStandardNodeMaterial, PerspectiveCamera, Plane, PlaneGeometry,
  RenderTarget, Scene, Vector3,
} from 'three/webgpu';
import { float, screenUV, texture } from 'three/tsl';
import { copyStampLayerForReadback, readStampLayerCopy } from '#lib/paint/painting/studio/stamp-layer-readback.ts';
import { loadPaintedThreeSources, type PaintedThreeSourceScene, type PaintedThreeSourceTools } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import { gpuEachInTurn } from '#lib/platform/gpu/models/gpu-in-turn.ts';
import { setThreeMirrorCamera } from '#lib/picture/shot-camera/studio/three-mirror-camera.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import {
  checkStampGateLighting, checkStampGateLightingExposed, STAMP_GATE_LIGHTING_EXPOSED, STAMP_GATE_LIGHTING_FRAMES, STAMP_GATE_STAND, stampGateLightingFrame,
  stampGateLightingPaintCamera, stampGateLightingShot, stampGateStandLightToward, stampGateStandMatrix, stampGateStandPostAt, type StampGateLitRender, type StampGateStandId,
} from '../models/stamp-gate-three-lighting.ts';
import { stampGateRgbBase64, withGateSurface } from './stamp-gate-page-surface.ts';
import { stampGateFramesBeside, stampGateShotFrames } from './stamp-gate-shot-frames.ts';
import { stampGateSheetImageUrl } from './stamp-gate-sheet-owner.ts';

const material = (colour: readonly [number, number, number], roughness: number) => new MeshStandardNodeMaterial({ color: new Color(...colour), roughness, metalness: 0 });

/**
 * Stand `which`'s scene: its floor (on layer 1, so the mirror's camera leaves it out), its post, its sun casting from
 * inside its tilted rig and a sky over all. The shadowed stand asks for soft shadows and mirrors its post in its floor,
 * drawn offscreen through a camera following the source's and read at the floor's screen uv.
 */
function stampGateStandScene(which: StampGateStandId, { frame }: PaintedThreeSourceTools): PaintedThreeSourceScene {
  const { floor, post, light, sky, softness, mirror, colours, roughness } = STAMP_GATE_STAND, shadowed = which === 'shadowed';
  const scene = new Scene(), rig = new Group();
  rig.applyMatrix4(stampGateStandMatrix(which));
  scene.add(rig, new HemisphereLight(sky.sky, sky.ground, sky.strength));

  const floorGeometry = new PlaneGeometry(floor, floor).rotateX(-Math.PI / 2), floorMaterial = material(colours.floor, roughness.floor);
  const floorMesh = new Mesh(floorGeometry, floorMaterial);
  floorMesh.receiveShadow = true;
  floorMesh.layers.set(1);
  const bodyGeometry = new BoxGeometry(post.width, post.body, post.width).translate(0, post.body / 2, 0), bodyMaterial = material(colours.post, roughness.post);
  const capGeometry = new BoxGeometry(post.width, post.cap, post.width).translate(0, post.body + post.cap / 2, 0), capMaterial = material(colours.cap, roughness.cap);
  const standing = new Group();
  for (const mesh of [new Mesh(bodyGeometry, bodyMaterial), new Mesh(capGeometry, capMaterial)]) {
    mesh.castShadow = true;
    standing.add(mesh);
  }
  const sun = new DirectionalLight(0xffffff, light.strength);
  sun.position.copy(stampGateStandLightToward().multiplyScalar(light.distance));
  sun.castShadow = true;
  sun.shadow.mapSize.set(light.mapSize, light.mapSize);
  sun.shadow.bias = light.bias;
  Object.assign(sun.shadow.camera, { left: -light.box, right: light.box, top: light.box, bottom: -light.box, near: light.near, far: light.far });
  sun.shadow.camera.updateProjectionMatrix();
  rig.add(floorMesh, standing, sun, sun.target);
  rig.updateMatrixWorld();

  const target = shadowed ? new RenderTarget(frame.width, frame.height, { type: HalfFloatType, samples: 4, generateMipmaps: true, minFilter: LinearMipmapLinearFilter }) : null;
  const mirrorCamera = new PerspectiveCamera();
  const mirrorPlane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, 1, 0).transformDirection(rig.matrixWorld), new Vector3().setFromMatrixPosition(rig.matrixWorld));
  if (target) floorMaterial.emissiveNode = texture(target.texture, screenUV.flipX()).level(float(mirror.level)).rgb.mul(mirror.strength);
  return {
    scene,
    poseAt: ({ at }) => {
      standing.position.copy(stampGateStandPostAt(at));
    },
    ...(target && { offscreen: [{ scene, camera: mirrorCamera, target, follow: (seen: PerspectiveCamera) => setThreeMirrorCamera(mirrorCamera, seen, mirrorPlane) }] }),
    ...(shadowed && { shadows: { softness } }),
    dispose: () => {
      for (const each of [floorGeometry, floorMaterial, bodyGeometry, bodyMaterial, capGeometry, capMaterial]) each.dispose();
      sun.dispose();
      target?.dispose();
    },
  };
}

/** The lit shot's frames, drawn in turn through one renderer. */
async function drawStampGateLightingFrames(): Promise<readonly Uint8ClampedArray[]> {
  const props = stampGateLightingShot({ shadowed: (tools) => stampGateStandScene('shadowed', tools), twin: (tools) => stampGateStandScene('twin', tools) });
  return (await stampGateShotFrames(props, STAMP_GATE_LIGHTING_FRAMES.map(({ at, mode }) => ({ t: at, mode })))).frames;
}

/**
 * Runs `work` with no animation frame passing: three's loop, which advances its frames, held. The frame it has
 * already asked for runs first, asking for its next into the hold, given back after.
 */
async function withStampGateAnimationHeld<T>(work: () => Promise<T>): Promise<T> {
  const ask = self.requestAnimationFrame, held: FrameRequestCallback[] = [];
  self.requestAnimationFrame = (callback) => held.push(callback);
  try {
    await new Promise((resolve) => ask.call(self, resolve));
    return await work();
  } finally {
    self.requestAnimationFrame = ask;
    for (const callback of held) ask.call(self, callback);
  }
}

/**
 * The shadowed stand's source loaded apart (STAMP_GATE_LIGHTING_EXPOSED), on a device of its own: for each point on
 * the aperture, an exposure at another moment, then straight after it, the two in one animation frame as a fast GPU
 * renders a reference frame's exposures, the exposure from that point, read back.
 */
async function drawStampGateLightingExposed(): Promise<StampGateLitRender[]> {
  const { camera } = stampGateLightingPaintCamera(), { t, before, apertures } = STAMP_GATE_LIGHTING_EXPOSED;
  return withGateSurface(stampGateLightingFrame(), stampGateSheetImageUrl, async ({ owner }) => {
    const loaded = await loadPaintedThreeSources(owner, camera, [{ id: 'shadowed', build: (tools) => stampGateStandScene('shadowed', tools) }], { handles: [], update: () => Promise.resolve() });
    try {
      const source = loaded.sources.get('shadowed');
      if (source?.kind !== 'three') throw new Error('stamp gate: the shadowed stand loaded as no three source');
      return await gpuEachInTurn(apertures, async (aperture, index) => {
        await withStampGateAnimationHeld(async () => {
          await source.render(t, { index, at: before, aperture: [0, 0] });
          await source.render(t, { index, at: t, aperture });
        });
        const { texture: rendered } = source.picture;
        const copy = await owner.checked('reading back the shadowed stand', () => {
          const encoder = owner.device.createCommandEncoder();
          const copied = copyStampLayerForReadback(owner.device, encoder, rendered, { x: 0, y: 0, w: rendered.width, h: rendered.height });
          owner.device.queue.submit([encoder.finish()]);
          return copied;
        });
        const { width, height, values } = await readStampLayerCopy(copy);
        return { width, height, values };
      });
    } finally {
      loaded.dispose();
    }
  });
}

/** The lit shot's baseline, its frames side by side: RGB bytes row by row, in base64. */
export async function paintStampGateLighting(): Promise<string> {
  return stampGateRgbBase64(stampGateFramesBeside(await drawStampGateLightingFrames(), stampGateLightingFrame()));
}

/** The lit shot's checks (checkStampGateLighting) on its frames as drawn, and its exposures' (checkStampGateLightingExposed) as rendered. */
export async function checkStampGateLightingCase(): Promise<StampGateWashCheck[]> {
  return [...checkStampGateLighting(await drawStampGateLightingFrames()), ...checkStampGateLightingExposed(await drawStampGateLightingExposed())];
}
