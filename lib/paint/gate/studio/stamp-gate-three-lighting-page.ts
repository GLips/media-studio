// stamp-gate-three-lighting-page.ts: the gate page's lit three.js shot (stamp-gate-three-lighting.ts): each stand
// built as a scene of its own from the case's numbers, the shadowed one with soft shadows and a planar mirror in its
// floor, drawn frame after frame through the shot's renderer.

import {
  BoxGeometry, Color, DirectionalLight, Group, HalfFloatType, HemisphereLight, LinearMipmapLinearFilter, Mesh, MeshStandardNodeMaterial, PerspectiveCamera, Plane, PlaneGeometry,
  RenderTarget, Scene, Vector3,
} from 'three/webgpu';
import { float, screenUV, texture } from 'three/tsl';
import { paintedThreeMirrorCamera } from '#lib/paint/three-layers/studio/painted-three-mirror.ts';
import type { PaintedThreeSourceScene, PaintedThreeSourceTools } from '#lib/paint/three-layers/studio/painted-three-sources.ts';
import type { StampGateWashCheck } from '../models/stamp-gate-layer.ts';
import {
  checkStampGateLighting, STAMP_GATE_LIGHTING_FRAMES, STAMP_GATE_STAND, stampGateLightingFrame, stampGateLightingShot, stampGateStandLightToward, stampGateStandMatrix,
  stampGateStandPostAt, type StampGateStandId,
} from '../models/stamp-gate-three-lighting.ts';
import { stampGateRgbBase64 } from './stamp-gate-page-surface.ts';
import { stampGateFramesBeside, stampGateShotFrames } from './stamp-gate-shot-frames.ts';

const material = (colour: readonly [number, number, number], roughness: number) => new MeshStandardNodeMaterial({ color: new Color(...colour), roughness, metalness: 0 });

/**
 * Stand `which`'s scene: its floor (on layer 1, so the mirror's camera leaves it out), its post, its sun casting from
 * inside its tilted rig and a sky over all. The shadowed stand asks for soft shadows and mirrors its post in its floor,
 * drawn offscreen at the source's frame size each render and read at the floor's screen uv.
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
  Object.assign(sun.shadow.camera, { left: -light.box, right: light.box, top: light.box, bottom: -light.box, near: 1, far: 2 * light.distance });
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
    ...(target && { offscreen: (camera: PerspectiveCamera) => [{ scene, camera: paintedThreeMirrorCamera(camera, mirrorPlane, mirrorCamera), target }] }),
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
  return (await stampGateShotFrames(props, STAMP_GATE_LIGHTING_FRAMES)).frames;
}

/** The lit shot's baseline, its frames side by side: RGB bytes row by row, in base64. */
export async function paintStampGateLighting(): Promise<string> {
  return stampGateRgbBase64(stampGateFramesBeside(await drawStampGateLightingFrames(), stampGateLightingFrame()));
}

/** The lit shot's checks (checkStampGateLighting), on its frames as drawn. */
export async function checkStampGateLightingCase(): Promise<StampGateWashCheck[]> {
  return checkStampGateLighting(await drawStampGateLightingFrames());
}
