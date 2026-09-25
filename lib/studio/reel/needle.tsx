// needle.tsx: the reel's signature shot, a tattoo cartridge needle striking the frame itself. A 7-needle round liner,
// wet with ink, stands out of a clear-tipped cartridge that leans back toward the lens. Each strike is one blow: in
// from out of frame in a frame or two, smeared along its path, sharp on the contact, driven in for a frame, then
// snapped back out the way it came. Between strikes it is out of shot, and the frame is the surface's.
//
// The camera looks straight down from where one surface unit is one frame pixel, so each strike lands on its own
// pixel of the layer beneath (the ink grid). The canvas is transparent: needle, shadow and glints over whatever is
// under it. The motion is a pure function of time (`needlePoseAt` in #models/reel/needle.ts), drawn here.

import * as THREE from 'three';
import { H, W } from '#models/frame/frame.ts';
import { motionCurves } from '#models/motion/motion.ts';
import { pieceMotionAttrs } from '../motion-tag.ts';
import { hashRandom } from '#models/motion/random.ts';
import { ThreeStage, type ThreeEnvironment, type ThreeFrame, type ThreeSample } from '../three-stage.tsx';
import type { Vec3 } from '#models/camera/vec3.ts';
import {
  NEEDLE_RIG, needleInFrame, needleLensHeight, needlePoseAt, needleRestAxis, needleScreenPoint, needleShotAt, needleTakeExposures,
  type NeedlePose, type NeedleRig, type NeedleStrike,
} from '#models/reel/needle.ts';
import { BODY_BARREL, BODY_FRONT, CLEAR_TIP, needleLine, sampled, SOLDER, type Profile } from '#models/reel/needle-cartridge.ts';

const DEG = Math.PI / 180;

const smooth = (v: number, a: number, b: number) => motionCurves.dissolve((v - a) / (b - a));

/** A surface of revolution about z: each run is smooth, and runs meet at hard edges. */
function latheGeometry(runs: Profile[], segments: number): THREE.BufferGeometry {
  const position: number[] = [], normal: number[] = [], index: number[] = [];
  for (const run of runs) {
    const base = position.length / 3;
    const segmentNormal = (a: [number, number], b: [number, number]): [number, number] => {
      const [dr, dz] = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(dr, dz) || 1;
      return [dz / l, -dr / l];
    };
    run.forEach((point, k) => {
      const nIn = k > 0 ? segmentNormal(run[k - 1], point) : null, nOut = k < run.length - 1 ? segmentNormal(point, run[k + 1]) : null;
      const n = nIn && nOut ? [nIn[0] + nOut[0], nIn[1] + nOut[1]] : (nIn ?? nOut)!;
      const nl = Math.hypot(n[0], n[1]) || 1;
      for (let j = 0; j <= segments; j++) {
        const a = (j / segments) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        position.push(point[0] * c, point[0] * s, point[1]);
        normal.push((n[0] / nl) * c, (n[0] / nl) * s, n[1] / nl);
      }
    });
    for (let k = 0; k < run.length - 1; k++) {
      for (let j = 0; j < segments; j++) {
        const a = base + k * (segments + 1) + j, b = a + 1, c = a + segments + 1, d = c + 1;
        index.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setIndex(index);
  return g;
}

/** A tube whose centre line bends: rings at `zs`, centred at `centre(z)`, of radius `radius(z)` (0 closes it to a point). */
function tubeGeometry(zs: number[], centre: (z: number) => [number, number], radius: (z: number) => number, segments: number): THREE.BufferGeometry {
  const position: number[] = [], normal: number[] = [], index: number[] = [];
  const h = 1e-3;
  for (const z of zs) {
    const [cx, cy] = centre(z), rad = radius(z);
    const [cx1, cy1] = centre(z + h), [cx0, cy0] = centre(z - h);
    const dcx = (cx1 - cx0) / (2 * h), dcy = (cy1 - cy0) / (2 * h), dr = (radius(z + h) - radius(z - h)) / (2 * h);
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      position.push(cx + rad * c, cy + rad * s, z);
      // ∂S/∂θ × ∂S/∂z for S = centre(z) + radius(z)·(cos, sin, 0), divided by the radius.
      const nz = -(dr + dcx * c + dcy * s), nl = Math.hypot(1, nz);
      normal.push(c / nl, s / nl, nz / nl);
    }
  }
  for (let k = 0; k < zs.length - 1; k++) {
    for (let j = 0; j < segments; j++) {
      const a = k * (segments + 1) + j, b = a + 1, c = a + segments + 1, d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setIndex(index);
  return g;
}

/**
 * The studio its steel reflects. From straight above, a cylinder tilted off the lens mirrors only a cone of directions
 * pointing down past its tip, into the ground: so the floor is the ground's colour, and two strips on that cone draw a
 * line of light down each needle, the clear tip and the barrel. A card behind the lens glints on the ink.
 */
function needleStudio(axis: Vec3, ground: string): ThreeEnvironment {
  return {
    key: `needle-studio ${axis.map((v) => v.toFixed(3)).join(' ')} ${ground}`,
    blur: 0.012,
    scene: () => {
      const scene = new THREE.Scene();
      const box = new THREE.BoxGeometry();
      const room = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: '#060607', side: THREE.BackSide }));
      room.scale.setScalar(80);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: ground }));
      floor.position.z = -6;
      scene.add(room, floor);
      const a = new THREE.Vector3(...axis);
      const u = new THREE.Vector3(0, 0, 1).cross(a).normalize(), w = a.clone().cross(u);
      const glow = (intensity: number) => new THREE.MeshLambertMaterial({ color: 0x000000, emissive: '#ffffff', emissiveIntensity: intensity });
      // φ is the angle about the axis of the reflected direction: 90° is the needle's centre line as the lens sees it.
      for (const [phi, intensity] of [[35, 7], [150, 4]] as const) {
        const p = u.clone().multiplyScalar(Math.cos(phi * DEG)).addScaledVector(w, Math.sin(phi * DEG));
        const dir = a.clone().multiplyScalar(-a.z).addScaledVector(p, Math.sqrt(1 - a.z * a.z)).normalize();
        const strip = new THREE.Mesh(box, glow(intensity));
        strip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), a);
        strip.scale.set(0.9, 0.9, 18);
        strip.position.copy(dir.multiplyScalar(5.5));
        scene.add(strip);
      }
      const card = new THREE.Mesh(box, glow(12));
      card.scale.set(2.2, 2.2, 0.2);
      card.position.set(-2.5, 2, 20);
      scene.add(card);
      return scene;
    },
  };
}

/** Clear plastic over a DOM ground: its haze covers what's behind a little (more at grazing angles), its reflections add. */
function clearPlasticMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: '#8c9398', metalness: 0, roughness: 0.04, ior: 1.58, transparent: true, premultipliedAlpha: true, depthWrite: false });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <opaque_fragment>', /* glsl */ `
        float clearFacing = saturate( dot( normal, geometryViewDir ) );
        float clearAlpha = mix( 0.22, 0.03, clearFacing );
        gl_FragColor = vec4( totalDiffuse * clearAlpha + totalSpecular, clearAlpha );`)
      // Already premultiplied above: the reflections must not be scaled down by the haze's alpha.
      .replace('#include <premultiplied_alpha_fragment>', '');
  };
  m.customProgramCacheKey = () => 'needle-clear-plastic';
  return m;
}

/**
 * The frame's scene, built once and re-posed for each exposure: the needle over a surface that takes its shadow and
 * hides what's driven into it. What changes within a frame's shutter is only where the needle is and its ink.
 */
function needleStage(r: NeedleRig, color: string, shadow: number, shift: { x: number; y: number }) {
  const lens = needleLensHeight(r.fov);
  const camera = new THREE.PerspectiveCamera(r.fov, W / H, lens * 0.02, lens * 1.5);
  camera.position.set(0, 0, lens);
  camera.lookAt(0, 0, 0);
  // A lens shift, not a move: the picture slides whole, as the layers under it do, and draws what slides in.
  camera.setViewOffset(W, H, -shift.x, -shift.y, W, H);
  const scene = new THREE.Scene();

  // The surface: depth only, drawn first, so what's driven past it is hidden; and a layer that is only shadow.
  const occluder = new THREE.Mesh(new THREE.PlaneGeometry(W * 4, H * 4), new THREE.MeshBasicMaterial({ colorWrite: false }));
  occluder.renderOrder = -1;
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(W * 4, H * 4), new THREE.ShadowMaterial({ opacity: shadow }));
  catcher.receiveShadow = true;
  scene.add(occluder, catcher);

  const steel = new THREE.MeshPhysicalMaterial({ color: '#e2e5ea', metalness: 1, roughness: 0.15 });
  const ink = new THREE.MeshPhysicalMaterial({ metalness: 0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.45 });
  const needle = new THREE.Group();
  needle.scale.setScalar(r.scale);
  for (let i = 0; i < 7; i++) {
    const n = needleLine(i);
    const wire = new THREE.Mesh(tubeGeometry(n.zs, n.centre, n.radius, 14), steel);
    // The wet end: a film over the last mm, ragged per needle, thinning to nothing where it stops.
    const wet = n.point + 0.85 + 0.35 * hashRandom('needle-wet', i);
    const film = (z: number) => n.radius(z) + (z <= n.point ? 0 : 0.02 * (1 - smooth(z, wet - 0.3, wet)) - 0.004 * smooth(z, wet - 0.3, wet));
    const zs = Array.from({ length: 13 }, (_, k) => n.point - 0.004 + (wet + 0.004 - n.point) * (k / 12) ** 1.5);
    const coat = new THREE.Mesh(tubeGeometry(zs, n.centre, (z) => Math.max(0, film(z)), 14), ink);
    wire.castShadow = coat.castShadow = true;
    needle.add(wire, coat);
  }
  // The drop held between the points, 0.9 mm long and 0.3 mm round when full; posed per exposure by its load.
  const drop = new THREE.Mesh(latheGeometry([sampled(16, (u) => [0.3 * Math.sin(Math.PI * u ** 0.8) ** 0.6, 0.9 * u])], 28), ink);
  drop.castShadow = true;
  const solder = new THREE.Mesh(latheGeometry(SOLDER, 28), new THREE.MeshPhysicalMaterial({ color: '#cdc7bc', metalness: 1, roughness: 0.42 }));
  const plastic = new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.34, clearcoat: 0.4, clearcoatRoughness: 0.2 });
  const body = new THREE.Mesh(latheGeometry([...BODY_FRONT, ...BODY_BARREL], 72), plastic);
  body.castShadow = true;
  // Two passes of one shell, far faces then near, so the transparent walls blend in depth order.
  const clearGeometry = latheGeometry(CLEAR_TIP, 72);
  const clearBack = new THREE.Mesh(clearGeometry, Object.assign(clearPlasticMaterial(), { side: THREE.BackSide }));
  const clearFront = new THREE.Mesh(clearGeometry, clearPlasticMaterial());
  clearBack.renderOrder = 1;
  clearFront.renderOrder = 2;
  needle.add(drop, solder, body, clearBack, clearFront);
  scene.add(needle);

  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(-0.55 * lens, 0.5 * lens, lens);
  key.castShadow = true;
  // Wide enough to hold the body's far end when the needle lifts near a corner: a caster outside it casts nothing,
  // and its shadow would end in a straight edge.
  key.shadow.mapSize.set(4096, 4096);
  Object.assign(key.shadow.camera, { left: -2400, right: 2400, top: 2400, bottom: -2400, near: 10, far: lens * 4 });
  key.shadow.bias = -0.0004;
  scene.add(key, key.target);

  const up = new THREE.Vector3(0, 0, 1), down = new THREE.Vector3();
  const frame: ThreeFrame = { scene, camera };
  return (pose: NeedlePose | null): ThreeFrame => {
    needle.visible = pose !== null;
    if (!pose) return frame;
    needle.position.set(...pose.tip);
    needle.quaternion.setFromUnitVectors(up, new THREE.Vector3(...pose.axis));
    ink.color.set(pose.ink);
    // Spent, the drop is smaller and shorter; it hangs a touch downhill, toward the surface.
    const fill = 0.45 + 0.55 * pose.load;
    down.set(0, 0, -1).applyQuaternion(needle.quaternion.clone().invert());
    drop.scale.set(fill, fill, 0.6 + 0.4 * pose.load);
    drop.position.set(down.x * 0.12 * fill, down.y * 0.12 * fill, 0.06);
    return frame;
  };
}

export type NeedleProps = Partial<NeedleRig> & {
  /** Seconds on the piece's clock, the one `strikes` are timed on. */
  t: number;
  strikes: readonly NeedleStrike[];
  /** The cartridge body's colour: a satin plastic. */
  color?: string;
  /** How dark its shadow falls on the ground beneath, 0..1. */
  shadow?: number;
  /** Exposures averaged into a frame at rest, for the depth of field and the soft shadow. */
  samples?: number;
  /** The most a fast frame takes; it takes as many as its smear needs (`needleExposuresAt`), about 0.7 ms each. */
  maxSamples?: number;
  /**
   * How long the shutter stays open, as a share of a frame, on the drive: a quarter keeps the grouping and the clear
   * tip crisp. A contact frame's shutter opens on the strike, so it never streaks.
   */
  shutter?: number;
  /** The shutter while it comes in or leaves: a whole frame smears each of those frames into one streak along its path. */
  fastShutter?: number;
  /**
   * The lens's opening in px. At 16 the needle and the clear tip are sharp, and the body softens toward its back end:
   * a little when it lies flat, a lot at the rig's 40° tilt, where the back end stands near the lens.
   */
  aperture?: number;
  /** Mm up the needle from its tip that the lens holds sharp, following it: 6 is the clear tip's mouth. */
  focus?: number;
  /**
   * The colour of the surface it strikes, which is what its polished steel mostly mirrors. The stage is composited
   * for it too: pass the ground it's drawn over, or its soft edges wash out over a light one.
   */
  ground?: string;
  /**
   * Frame px the shot is knocked by at `t`, as a shake translates the layers under the needle: the needle's picture
   * moves with them through its lens, so the canvas's edge never shows. Strikes stay in unshifted frame px.
   */
  shift?: { x: number; y: number };
  /**
   * Its name in the motion tracks (the tip's point on screen, reporting `lift`, mm above the surface; `grow`, the share
   * its image is bigger than on the surface; `tilt`, degrees off the lens axis; and `inFrame`, the share of its length
   * seen in frame); `false`: none.
   */
  motion?: string | false;
};

/**
 * The needle striking `strikes` in turn, on a transparent full-frame canvas: put it over the layer it strikes. The
 * tip meets each strike's pixel exactly at its `at`, and the ink on it is that strike's `ink`.
 *
 *   <Needle t={s.t} strikes={[{ at: g.at(0), x: 880, y: 590, ink: '#ee4c23' }, …]} />
 */
export function Needle({
  t, strikes, color = '#34353a', shadow = 0.45, samples = 32, maxSamples = 256, shutter = 0.25, fastShutter = 1, aperture = 16, focus = 6,
  ground = '#0c0c0e', shift = { x: 0, y: 0 }, motion, ...rig
}: NeedleProps) {
  const r = { ...NEEDLE_RIG, ...rig };
  const shot = needleShotAt(strikes, t, { rig: r, shutter, fastShutter, focus });
  const { pose } = shot;
  const tip = pose && needleScreenPoint(pose.tip, r.fov);
  // Each take is its own stage: the streak is laid down first, and the sharp contact over it.
  const takes = [shot.streak, shot].filter((take) => take !== null).map((take) => {
    // Built on the take's first exposure and shared by the rest; its stage frees it after the frame.
    let stage: ReturnType<typeof needleStage> | null = null;
    const draw = ({ dt }: ThreeSample) => (stage ??= needleStage(r, color, shadow, shift))(needlePoseAt(strikes, take.exposureAt(dt), r));
    return { take, draw, exposures: needleTakeExposures(strikes, take, shot.focusDistance, r, { samples, maxSamples, aperture }) };
  });
  // No bloom: the grouping's wires lie side by side, and their glints would glow together into a white smear that
  // hides them, and haze the ground around.
  return (
    <>
      {takes.map(({ take, draw, exposures }) => exposures > 0 && (
        <ThreeStage key={take === shot ? 'shot' : 'streak'} transparent backdrop={ground} environment={needleStudio(needleRestAxis(r), ground)} shadows samples={exposures}
          shutter={take.shutter} softShadows={3} lens={{ focus: shot.focusDistance, aperture }} draw={draw} />
      ))}
      {tip && (
        <div {...pieceMotionAttrs(motion, 'needle', { kind: 'needle', values: {
          lift: pose.tip[2] / r.scale, grow: pose.tip[2] / (needleLensHeight(r.fov) - pose.tip[2]), tilt: Math.acos(pose.axis[2]) / DEG, inFrame: needleInFrame(pose, r),
        } })}
          style={{ position: 'absolute', left: tip.x + shift.x - 3, top: tip.y + shift.y - 3, width: 6, height: 6, pointerEvents: 'none' }} />
      )}
    </>
  );
}
