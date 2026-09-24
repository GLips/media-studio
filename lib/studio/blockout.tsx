// blockout.tsx: a 3D blockout of a shot, the previs a generated video renders from (see skills/video-gen). Grey
// primitives stand in for each subject on a gridded ground, seen through a real perspective camera (blockout-camera.ts),
// so the video model gets true parallax to follow: a move made here doesn't read as a zoom.
//
// Plain three.js drawn straight onto a canvas, once per frame, from props alone: no scene graph survives between
// frames, so any frame renders the same whether or not the one before it did, which is what Remotion's tabs need.
// Only the renderer outlives a frame. Materials are made afresh each frame on purpose: kept across frames, they change
// the output's bytes with the frames a tab happened to render before, and a blockout's bytes are its cache key.

import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { BlockoutPose, Vec3 } from './blockout-camera.ts';
import { H, W } from './frame.ts';

/**
 * `figure` is a person stand-in (body and head), `card` a flat panel such as a phone, screen or sign (give it a small
 * depth), and the rest are what they say.
 */
export type BlockoutShape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'figure' | 'card';
export type BlockoutSubject = {
  shape: BlockoutShape;
  /** The centre of its base, in metres. */
  at: Vec3;
  /** Width, height and depth in metres. */
  size: Vec3;
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

function subjectMesh(subject: BlockoutSubject, material: (color: string) => THREE.Material): THREE.Object3D {
  const [w, h, d] = subject.size;
  const mat = material(subject.color ?? GREY);
  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, y: number) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.y = y;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  };
  switch (subject.shape) {
    case 'box': case 'card': add(new THREE.BoxGeometry(w, h, d), h / 2); break;
    case 'sphere': add(new THREE.SphereGeometry(0.5, 48, 24).scale(w, h, d), h / 2); break;
    case 'cylinder': add(new THREE.CylinderGeometry(0.5, 0.5, 1, 48).scale(w, h, d), h / 2); break;
    case 'cone': add(new THREE.ConeGeometry(0.5, 1, 48).scale(w, h, d), h / 2); break;
    case 'figure': {
      // A body and a head in a person's proportions (the head a seventh of the height, sunk a little into the body's
      // rounded top so it reads as attached), filling the size given. The capsule is 2 units tall before scaling.
      const head = h / 7, body = h - head * 0.8;
      add(new THREE.CapsuleGeometry(0.5, 1, 8, 24).scale(w, body / 2, d), body / 2);
      add(new THREE.SphereGeometry(head / 2, 32, 16), h - head / 2);
      break;
    }
  }
  group.position.set(...subject.at);
  group.rotation.set(-THREE.MathUtils.degToRad(subject.tiltDeg ?? 0), THREE.MathUtils.degToRad(subject.turnDeg ?? 0), 0, 'YXZ');
  return group;
}

/**
 * The blockout at one pose: `subjects` on a gridded ground under soft daylight. Compute both from the scene clock and
 * subjects move as freely as the camera does.
 */
export function Blockout({ pose, subjects, ground = '#e4e5e8', sky = '#f4f5f7' }: {
  pose: BlockoutPose;
  subjects: readonly BlockoutSubject[];
  ground?: string;
  sky?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<THREE.WebGLRenderer>(null);

  useLayoutEffect(() => {
    // preserveDrawingBuffer: Remotion screenshots the page after this effect, and a cleared buffer would come out blank.
    renderer.current ??= new THREE.WebGLRenderer({ canvas: canvas.current!, antialias: true, preserveDrawingBuffer: true });
    const gl = renderer.current;
    gl.setPixelRatio(1);
    gl.setSize(W, H, false);
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(sky);
    scene.add(new THREE.HemisphereLight('#ffffff', '#9a9ca3', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(6, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
    scene.add(sun);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: ground, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    // A metre grid: the lines converging and sliding past are what make a camera move legible as travel.
    const grid = new THREE.GridHelper(60, 60, '#c3c6cc', '#cfd2d7');
    grid.position.y = 0.002;
    scene.add(grid);

    const materials = new Map<string, THREE.Material>();
    const material = (color: string) => {
      if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
      return materials.get(color)!;
    };
    for (const subject of subjects) scene.add(subjectMesh(subject, material));

    const camera = new THREE.PerspectiveCamera(pose.fov, W / H, 0.05, 400);
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    gl.render(scene, camera);

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose();
    });
    floor.material.dispose();
    grid.dispose();
    for (const m of materials.values()) m.dispose();
    sun.shadow.dispose();
  });
  // Scrubbing the Studio mounts a blockout per scene, and Chrome drops contexts past about 16 live ones.
  useLayoutEffect(() => () => {
    renderer.current?.forceContextLoss();
    renderer.current?.dispose();
    renderer.current = null;
  }, []);

  return <canvas ref={canvas} width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }} />;
}
