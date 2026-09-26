// column-field.tsx: the reel's cube field (the reference's "04 — 3D / DEPTH"): rounded columns rising out of flat
// tiles and churning in height, a ball hopping across their tops on the beat, and one camera move from straight
// overhead (at a 2D grid's pitch, for a match cut) down to a low three-quarter view, punching on each landing.
//
// Heights, the ball's path and the camera are pure functions of t (models/reel/column-field.ts and
// column-field-motion.ts), so the same functions draw the frame and aim HUD marks at it (columnFieldProject).
// ColumnField draws them on ThreeStage's accumulated exposures. The columns are one instanced mesh whose tops a vertex
// shader raises (scaling would stretch the bevel), darkened and tinted by their neighbours (column-field-materials.ts).

import * as THREE from 'three';
import { useStudioFontsReady } from '../fonts/fonts.ts';
import { fullFrameRect } from '#models/frame/frame.ts';
import { useVideoFormat } from '../composition/video-format.ts';
import { pieceMotionAttrs } from '../probe/motion-tag.ts';
import { clamp } from '#models/motion/motion.ts';
import { ThreeStage, softboxEnvironment, type ThreeBloom, type ThreeEnvironment, type ThreeFrame, type ThreeLens, type ThreeSample } from '../film/three-stage.tsx';
import { columnFieldHeight, columnFieldPoint, type ColumnCameraState, type ColumnCell, type ColumnFieldLights, type ColumnFieldSpec, type ColumnLabel, type ColumnLight } from '#models/reel/column-field.ts';
import { columnBallAt, columnFieldProject, fieldCamera } from '#models/reel/column-field-motion.ts';
import { ballMaterial, columnDepthMaterial, columnGeometry, columnMaterial, columnTopology, floorMaterial, type BallShadowUniforms } from './column-field-materials.ts';

export type ColumnFieldProps<C extends ColumnCell = ColumnCell> = ColumnFieldSpec<C> & {
  /** Seconds since the piece starts. */
  t: number;
  /** Exposures a frame (12): more for a wider aperture or a faster move. */
  samples?: number;
  shutter?: number;
  bloom?: ThreeBloom;
  environment?: ThreeEnvironment;
  /** Neutral by default: ACES would turn the reds orange and the blues violet. */
  toneMapping?: THREE.ToneMapping;
  exposure?: number;
  motion?: string | false;
};

const REFERENCE_FOG = { color: '#120d16', near: 0, far: 7 };
const REFERENCE_LIGHTS = {
  key: { azimuth: -135, elevation: 25, color: '#fffaf6', intensity: 1.5, softness: 4 },
  pool: { intensity: 2.6, color: '#fffaf6', above: 0.8, spread: 38, size: 3 },
  fill: { sky: '#58505f', ground: '#f4f0f4', intensity: 1.3 },
  environment: 0.05,
} satisfies ColumnFieldLights;

const rad = (d: number) => (d * Math.PI) / 180;
const Y = new THREE.Vector3(0, 1, 0);

// ---------- the component ----------

/**
 * The field, drawn on ThreeStage with the reference's light and fog unless given others. Tagged `column-field`
 * (crane and whip progress as values) with the ball inside it as `ball` (its squash).
 */
export function ColumnField<C extends ColumnCell>({ t, samples = 12, shutter = 0.5, bloom, environment = softboxEnvironment, toneMapping = THREE.NeutralToneMapping, exposure, motion, ...spec }: ColumnFieldProps<C>) {
  const format = useVideoFormat(), box = spec.box ?? fullFrameRect(format);
  const fontsReady = useStudioFontsReady(Boolean(spec.labels));
  const cam = fieldCamera(spec, t);
  const ball = columnBallAt(spec, t);
  const mark = ball && columnFieldProject(spec, t, ball.position, format);
  const whip = spec.camera.whip;
  const key = fieldLights(spec).key;
  // Built on a frame's first exposure and shared by the rest; a new render is a new frame.
  const frame: { build?: FieldBuild } = {};
  return (
    <div {...pieceMotionAttrs(motion, 'column-field', { kind: 'column-field', values: { crane: round(cam.crane), whip: round(cam.whip) } })} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }}>
      <ThreeStage
        samples={whip && t > whip.at ? Math.max(samples, whip.samples ?? 32) : samples} shutter={shutter} lens={spec.lens && lensAt(spec, t, cam)}
        shadows softShadows={key ? key.softness ?? 3 : 0} bloom={bloom} environment={environment} toneMapping={toneMapping} exposure={exposure}
        box={{ x: 0, y: 0, w: box.w, h: box.h }} draw={(sample) => drawColumnField(spec, t, sample, frame, fontsReady)}
      />
      {mark && ball && motion !== false && (
        <div
          {...pieceMotionAttrs(undefined, 'ball', { kind: 'column-field-ball', values: { squash: round(ball.squash) } })}
          style={{ position: 'absolute', left: mark.x - box.x - ball.radius * mark.scale, top: mark.y - box.y - ball.radius * mark.scale, width: 2 * ball.radius * mark.scale, height: 2 * ball.radius * mark.scale }}
        />
      )}
    </div>
  );
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
const fieldLights = <C extends ColumnCell>(spec: ColumnFieldSpec<C>): ColumnFieldLights => ({ ...REFERENCE_LIGHTS, ...spec.lights });

/**
 * The lens for frame t. On the ball, the focus follows its depth over the last 0.12 s, as a puller a moment behind, so
 * it racks as the ball lands; held within reach of the target, so a ball flying off pulls it only so far.
 */
function lensAt<C extends ColumnCell>(spec: ColumnFieldSpec<C>, t: number, cam: ColumnCameraState): ThreeLens {
  const { aperture, focus = 'ball' } = spec.lens!;
  const toTarget = cam.target.distanceTo(cam.position);
  let distance = typeof focus === 'number' ? focus : toTarget;
  if (focus === 'ball' && spec.ball) {
    let sum = 0;
    for (let s = 0; s < 5; s++) sum += columnBallAt(spec, t - s * 0.03)!.position.sub(cam.position).dot(cam.forward);
    distance = clamp(sum / 5, 0.6 * toTarget, 1.5 * toTarget);
  }
  return { focus: distance * (1 - cam.whip * (spec.camera.whip?.defocus ?? 0.35)), aperture };
}

// ---------- the scene ----------

type FieldBuild = {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; fog: THREE.Fog | null;
  heights: Float32Array; neighbourHeights: Float32Array; neighbours: Int32Array;
  heightAttr: THREE.InstancedBufferAttribute; neighbourAttr: THREE.InstancedBufferAttribute;
  key: THREE.DirectionalLight | null; rim: THREE.DirectionalLight | null; pool: THREE.SpotLight | null;
  ball: THREE.Mesh | null; ballShadow: BallShadowUniforms; labels: { mesh: THREE.Mesh; label: ColumnLabel }[];
};

/** One exposure: the frame's scene (built on its first) moved to this exposure's moment. */
function drawColumnField<C extends ColumnCell>(spec: ColumnFieldSpec<C>, t: number, sample: ThreeSample, frame: { build?: FieldBuild }, fontsReady: boolean): ThreeFrame {
  const at = t + sample.dt;
  const build = (frame.build ??= buildColumnField(spec, t, sample.environment, fontsReady));
  const { heights, neighbourHeights, neighbours } = build;
  for (const [k, cell] of spec.cells.entries()) heights[k] = columnFieldHeight(spec, cell, at);
  for (let k = 0; k < neighbours.length; k++) neighbourHeights[k] = neighbours[k] < 0 ? 0 : heights[neighbours[k]];
  build.heightAttr.needsUpdate = build.neighbourAttr.needsUpdate = true;

  const cam = fieldCamera(spec, at, t);
  build.camera.position.copy(cam.position);
  build.camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(cam.right, cam.up, cam.forward.clone().negate()));
  build.camera.fov = cam.fov;
  const reach = cam.position.distanceTo(cam.target);
  const fog = spec.fog === undefined ? REFERENCE_FOG : spec.fog;
  if (build.fog && fog) [build.fog.near, build.fog.far] = [reach + fog.near, reach + fog.far];

  const lights = fieldLights(spec);
  const ground = new THREE.Vector3(cam.target.x, 0, cam.target.z);
  if (build.key && lights.key) aimLight(build.key, ground, lights.key);
  if (build.rim && lights.rim) aimLight(build.rim, ground, lights.rim);
  if (build.pool && lights.pool) {
    const height = (lights.pool.above ?? 0.8) * Math.max(cam.position.y - cam.target.y, 1);
    build.pool.position.copy(cam.target).addScaledVector(Y, height);
    build.pool.target.position.copy(cam.target);
    build.pool.intensity = lights.pool.intensity * height * height;
    build.ballShadow.columnLamp.value.set(build.pool.position.x, build.pool.position.y, build.pool.position.z, (lights.pool.size ?? 3) / 2);
  }
  if (build.ball) {
    const ball = columnBallAt(spec, at)!;
    build.ball.matrix.copy(ball.matrix);
    build.ball.matrixWorldNeedsUpdate = true;
    build.ballShadow.columnBall.value.set(ball.position.x, ball.position.y, ball.position.z, ball.radius);
  }
  for (const { mesh, label } of build.labels) placeLabel(mesh, label, spec, at, cam);
  return { scene: build.scene, camera: build.camera };
}

function buildColumnField<C extends ColumnCell>(spec: ColumnFieldSpec<C>, t: number, environment: THREE.Texture | null, fontsReady: boolean): FieldBuild {
  const scene = new THREE.Scene();
  const fogSpec = spec.fog === undefined ? REFERENCE_FOG : spec.fog;
  const groundColor = spec.ground ?? '#0c0604';
  const fog = fogSpec ? new THREE.Fog(fogSpec.color, 1, 2) : null;
  scene.fog = fog;
  scene.background = new THREE.Color(fogSpec ? fogSpec.color : groundColor);
  const lights = fieldLights(spec);
  const reflect = lights.environment ?? 0.25;

  const column = { width: 0.64, corner: 0.1, bevel: 0.1, roughness: 0.8, ao: 0.9, bleed: 0.6, vary: 0.08, ...spec.column };
  const n = spec.cells.length;
  const topology = columnTopology(spec.cells, column.vary, spec.seed ?? 1);
  const geometry = columnGeometry(column.width, column.corner, column.bevel);
  const heights = new Float32Array(n), neighbourHeights = new Float32Array(4 * n);
  const heightAttr = new THREE.InstancedBufferAttribute(heights, 1).setUsage(THREE.DynamicDrawUsage);
  const neighbourAttr = new THREE.InstancedBufferAttribute(neighbourHeights, 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('columnHeight', heightAttr);
  geometry.setAttribute('columnNeighbourHeights', neighbourAttr);
  geometry.setAttribute('columnNeighbourColors', new THREE.InstancedBufferAttribute(topology.neighbourColors, 4));
  const ballShadow: BallShadowUniforms = { columnBall: { value: new THREE.Vector4() }, columnLamp: { value: new THREE.Vector4() } };
  const columns = new THREE.InstancedMesh(geometry, columnMaterial(column, environment, reflect, ballShadow), n);
  columns.customDepthMaterial = columnDepthMaterial();
  columns.instanceColor = new THREE.InstancedBufferAttribute(topology.colors, 3);
  const place = new THREE.Matrix4();
  for (const [k, c] of spec.cells.entries()) columns.setMatrixAt(k, place.makeTranslation(c.i, 0, c.j));
  columns.castShadow = columns.receiveShadow = true;
  // The shader raises the tops past the geometry's bounds, which culling would trust.
  columns.frustumCulled = false;
  scene.add(columns);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), floorMaterial(groundColor, environment, reflect, ballShadow));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  let key: THREE.DirectionalLight | null = null, rim: THREE.DirectionalLight | null = null, pool: THREE.SpotLight | null = null;
  if (lights.key) {
    key = new THREE.DirectionalLight(lights.key.color, lights.key.intensity);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    Object.assign(key.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 160 });
    key.shadow.camera.updateProjectionMatrix();
    Object.assign(key.shadow, { bias: -0.0004, normalBias: 0.02 });
    scene.add(key, key.target);
  }
  if (lights.rim) {
    rim = new THREE.DirectionalLight(lights.rim.color, lights.rim.intensity);
    scene.add(rim, rim.target);
  }
  if (lights.pool) {
    // Placed and scaled each exposure, as the camera moves. It casts no shadow map: the shader shadows it, by the ball.
    pool = new THREE.SpotLight(lights.pool.color, 0, 0, rad(lights.pool.spread ?? 38), 1, 2);
    scene.add(pool, pool.target);
  }
  if (lights.fill) scene.add(new THREE.HemisphereLight(lights.fill.sky, lights.fill.ground, lights.fill.intensity));

  let ball: THREE.Mesh | null = null;
  if (spec.ball?.contacts.length) {
    ball = new THREE.Mesh(new THREE.SphereGeometry(spec.ball.radius ?? 0.55, 96, 64), ballMaterial(spec.ball.material ?? 'gloss', environment));
    ball.matrixAutoUpdate = false;
    ball.castShadow = spec.ball.keyShadow ?? false;
    ball.receiveShadow = true;
    scene.add(ball);
  }
  const labels = fontsReady ? (spec.labels?.(t) ?? []).map((label) => ({ label, mesh: labelMesh(label) })) : [];
  for (const { mesh } of labels) scene.add(mesh);

  // ThreeStage sets the aspect to its box's before each exposure.
  const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 600);
  return { scene, camera, fog, heights, neighbourHeights, neighbours: topology.neighbours, heightAttr, neighbourAttr, key, rim, pool, ball, ballShadow, labels };
}

function aimLight(light: THREE.DirectionalLight, at: THREE.Vector3, { azimuth, elevation }: ColumnLight) {
  const a = rad(azimuth), e = rad(elevation), reach = 60;
  light.position.set(at.x + reach * Math.sin(a) * Math.cos(e), at.y + reach * Math.sin(e), at.z + reach * Math.cos(a) * Math.cos(e));
  light.target.position.copy(at);
}

/**
 * A label's card: premultiplied, so its soft edges filter without dark fringes, and unfogged, since fog would tint
 * its clear parts. Opacity and the label's `intensity` scale its colour, as premultiplied blending wants.
 */
function labelMesh(label: ColumnLabel) {
  const res = label.resolution ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(label.size[0] * res));
  canvas.height = Math.max(1, Math.round(label.size[1] * res));
  label.paint(canvas.getContext('2d')!, canvas.width, canvas.height);
  const map = new THREE.CanvasTexture(canvas);
  Object.assign(map, { colorSpace: THREE.SRGBColorSpace, anisotropy: 8, premultiplyAlpha: true });
  const opacity = label.opacity ?? 1;
  const material = new THREE.MeshBasicMaterial({
    map, color: new THREE.Color().setScalar(opacity * (label.intensity ?? 1)), opacity, transparent: true, fog: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(label.size[0], label.size[1]), material);
}

function placeLabel<C extends ColumnCell>(mesh: THREE.Mesh, label: ColumnLabel, spec: ColumnFieldSpec<C>, t: number, cam: ColumnCameraState) {
  const turn = label.turn === undefined || label.turn === 'camera' ? Math.atan2(-cam.right.z, cam.right.x) : rad(label.turn);
  const tilt = label.tilt === 'camera' ? Math.PI / 2 - Math.asin(clamp(-cam.forward.y, -1, 1)) : rad(label.tilt ?? 0);
  mesh.rotation.set(tilt - Math.PI / 2, turn, 0, 'YXZ');
  const [ox, oy, oz] = label.offset ?? [0, 0, 0];
  const [x, y, z] = columnFieldPoint(spec, t, label.cell, 0.004);
  // Hinged on its bottom edge, which rests on the top at any tilt.
  mesh.position.set(x + ox, y + oy, z + oz).addScaledVector(new THREE.Vector3(0, 1, 0).applyEuler(mesh.rotation), label.size[1] / 2);
}
