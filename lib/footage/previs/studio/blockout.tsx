// blockout.tsx: a 3D blockout of a shot, the previs a generated video renders from (see skills/video-gen). Grey
// primitives stand in for each subject on a gridded ground, seen through the studio's one camera from a look-at
// (blockout-camera.ts), so the video model gets true parallax to follow: a move made here doesn't read as a zoom.
//
// Staged on ThreeStage as a plain render: one exposure, no lens, no tone mapping, since the video model wants the
// shot's layout and motion, not a look. The scene is built afresh each frame and freed after it, so a frame's bytes,
// which are the blockout's cache key, depend only on its props.

import { BoxGeometry, CapsuleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, GridHelper, Group, HemisphereLight, MathUtils, Mesh, MeshStandardMaterial, NoToneMapping, PlaneGeometry, Scene, SphereGeometry, type BufferGeometry, type Material, type Object3D, type Vector3Tuple } from 'three/webgpu';
import { blockoutShotCamera, type BlockoutLookAt } from '#lib/footage/previs/models/blockout-camera.ts';
import { ThreeStage, type ThreeFrame } from '#lib/picture/film/studio/three-stage.tsx';
import type { FrameSize } from '#lib/picture/frame/models/frame.ts';
import type { ShotPoint } from '#lib/picture/shot-camera/models/shot-camera.ts';

/**
 * `figure` is a person stand-in (body and head), `card` a flat panel such as a phone, screen or sign (give it a small
 * depth), and the rest are what they say.
 */
export type BlockoutShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'figure' | 'card';
export type BlockoutSubject = {
  shape: BlockoutShape;
  /** The centre of its base, in metres. */
  at: ShotPoint;
  /** Width, height and depth in metres. */
  size: Readonly<Vector3Tuple>;
  /**
   * Tell subjects apart by tint, and name them by it in the prompt ("the orange box is the espresso machine"). Muted
   * tints: the model copies what it sees, and a saturated block comes back as a saturated object.
   */
  color?: string;
  /** Turned about the vertical, in degrees. */
  turnDeg?: number;
  /** Tipped back about its own width, in degrees: a phone lying at an angle, a screen leaning. */
  tiltDeg?: number;
};

const GREY = '#b9bcc2';

function subjectMesh(subject: BlockoutSubject, material: (color: string) => Material): Object3D {
  const [w, h, d] = subject.size;
  const mat = material(subject.color ?? GREY);
  const group = new Group();
  const add = (geometry: BufferGeometry, y: number) => {
    const mesh = new Mesh(geometry, mat);
    mesh.position.y = y;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  switch (subject.shape) {
    case 'box': case 'card': add(new BoxGeometry(w, h, d), h / 2); break;
    case 'sphere': add(new SphereGeometry(0.5, 48, 24).scale(w, h, d), h / 2); break;
    case 'cylinder': add(new CylinderGeometry(0.5, 0.5, 1, 48).scale(w, h, d), h / 2); break;
    case 'cone': add(new ConeGeometry(0.5, 1, 48).scale(w, h, d), h / 2); break;
    case 'figure': {
      // A body and a head in a person's proportions (the head a seventh of the height, sunk a little into the body's
      // rounded top so it reads as attached), filling the size given. The capsule is 2 units tall before scaling.
      const head = h / 7, body = h - head * 0.8;
      add(new CapsuleGeometry(0.5, 1, 8, 24).scale(w, body / 2, d), body / 2);
      add(new SphereGeometry(head / 2, 32, 16), h - head / 2);
      break;
    }
  }
  group.position.set(...subject.at);
  group.rotation.set(-MathUtils.degToRad(subject.tiltDeg ?? 0), MathUtils.degToRad(subject.turnDeg ?? 0), 0, 'YXZ');
  return group;
}

type BlockoutLook = { lookAt: BlockoutLookAt; subjects: readonly BlockoutSubject[]; ground: string; sky: string };

/** The blockout's scene under soft daylight, and the camera it's seen through. */
function blockoutFrame({ lookAt, subjects, ground, sky }: BlockoutLook, frame: FrameSize): ThreeFrame {
  const scene = new Scene();
  scene.background = new Color(sky);
  scene.add(new HemisphereLight('#ffffff', '#9a9ca3', 1.6));
  const sun = new DirectionalLight('#ffffff', 2.2);
  sun.position.set(6, 10, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
  scene.add(sun);

  const floor = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({ color: ground, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  // A metre grid: the lines converging and sliding past are what make a camera move legible as travel.
  const grid = new GridHelper(60, 60, '#c3c6cc', '#cfd2d7');
  grid.position.y = 0.002;
  scene.add(grid);

  const materials = new Map<string, Material>();
  const material = (color: string) => {
    if (!materials.has(color)) materials.set(color, new MeshStandardMaterial({ color, roughness: 0.85 }));
    return materials.get(color)!;
  };
  for (const subject of subjects) scene.add(subjectMesh(subject, material));
  return { scene, camera: blockoutShotCamera(lookAt, frame) };
}

/**
 * The blockout seen from `lookAt`: `subjects` on a gridded ground under soft daylight. Compute both from the scene
 * clock and subjects move as freely as the camera does.
 */
export function Blockout({ lookAt, subjects, ground = '#e4e5e8', sky = '#f4f5f7' }: {
  lookAt: BlockoutLookAt;
  subjects: readonly BlockoutSubject[];
  ground?: string;
  sky?: string;
}) {
  return <ThreeStage shadows toneMapping={NoToneMapping} draw={({ frame }) => blockoutFrame({ lookAt, subjects, ground, sky }, frame)} />;
}
