// needle.tsx: the reel's signature shot, a tattoo cartridge needle striking the frame itself. A 7-needle round liner,
// wet with ink, stands out of a clear-tipped cartridge that leans back toward the lens. Each strike is one blow: in
// from out of frame in a frame or two, smeared along its path, sharp on the contact, driven in for a frame, then
// snapped back out the way it came. Between strikes it is out of shot, and the frame is the surface's.
//
// The camera looks straight down from where one surface unit is one frame pixel, so each strike lands on its own
// pixel of the layer beneath (the ink grid). The canvas is transparent: needle, shadow and glints over whatever is
// under it. The motion is a pure function of time (`needlePoseAt`), and `needleContactAt` says when each strike lands.

import * as THREE from 'three';
import { FPS, H, W } from '#models/frame/frame.ts';
import { motionCurves } from '#models/motion/motion.ts';
import { pieceMotionAttrs } from '../motion-tag.ts';
import { hashRandom } from '#models/motion/random.ts';
import { ThreeStage, type ThreeEnvironment, type ThreeFrame, type ThreeSample } from '../three-stage.tsx';
import { addVec3, crossVec3, dotVec3, lengthVec3, lerpVec3, scaleVec3, subVec3, unitVec3, type Vec3 } from '#models/camera/vec3.ts';

export type NeedleStrike = {
  /** Seconds on the piece's clock when the tip meets the surface: put it on a beat. */
  at: number;
  /** The frame pixel it strikes. */
  x: number;
  y: number;
  /** The ink wet on its tip as it comes in: the colour the layer beneath should start its ripple from. */
  ink: string;
  /**
   * Its contact frame also shows the way in, a streak behind the sharp needle: for a strike that opens a shot, with no
   * frame before it to come in on.
   */
  streak?: boolean;
};

/**
 * How the needle sits in the shot and strikes. Lengths are mm on the cartridge, times seconds. The defaults come in
 * over two frames, so the frame before a contact catches it halfway, and are gone by the fourth frame after it.
 * Strikes closer together than `enter + dwell + exit` cut the earlier one's exit short.
 */
export type NeedleRig = {
  /** Degrees between the needle and the lens axis: 0 points straight down the lens, 90 lies flat on the surface. */
  tilt: number;
  /** The way its body runs from the tip, on screen: degrees counterclockwise from pointing right (30: upper right). */
  grip: number;
  /** Frame px per mm at the surface: 20 makes the 1.05 mm grouping of needles 21 px across. */
  scale: number;
  /** Vertical field of view, degrees. Narrower moves the lens back and flattens the perspective. */
  fov: number;
  /** The way it comes in from off frame and leaves, as `grip` counts it. Unset: the way its body runs. */
  from?: number;
  /**
   * Degrees its path rises off the surface toward the lens: 0 skims in level, steeper drops it from nearer the lens.
   * With `from` unset, 90 − `tilt` runs it in along its own length, a stab.
   */
  climb: number;
  /** Seconds from wholly out of frame to the contact, at one speed: it lands at full tilt, never braking. */
  enter: number;
  /** Seconds it stays in the surface after contact, driven `overdrive` mm past it a frame in. 0: the contact frame only. */
  dwell: number;
  overdrive: number;
  /** Seconds from the drive to wholly out of frame, gathering speed. */
  exit: number;
  /** Degrees the body leans into a fast move, its grip ahead of its tip; it straightens as the move stops. */
  lean: number;
};

/** The reference rig: gripped from the upper right, standing 40° out of the lens axis, driven in its own frame. */
export const NEEDLE_RIG: NeedleRig = {
  tilt: 40, grip: 30, scale: 20, fov: 20, climb: 30, enter: 2 / FPS, dwell: 1 / FPS, overdrive: 0.6, exit: 2.5 / FPS, lean: 6,
};

// ---------- the pure part: where the tip is ----------

const DEG = Math.PI / 180;

const smooth = (v: number, a: number, b: number) => motionCurves.dissolve((v - a) / (b - a));

/** Where the needle is at one moment. Positions are world px: x right and y up from the frame's centre, z toward the lens. */
export type NeedlePose = {
  tip: Vec3;
  /** Unit vector from the tip up the needle toward the body. */
  axis: Vec3;
  /** The ink on the tip: the strike's it's coming in to or has made. */
  ink: string;
  /** How full the drop of ink on the tip is, 0..1: full coming in, spent into the surface on contact. */
  load: number;
  /** Coming in or leaving: the moves too quick to shoot crisp. */
  fast: boolean;
};

/** The lens's height above the surface, in frame px: the distance at which one surface unit is one frame pixel. */
export const needleLensHeight = (fov: number) => H / 2 / Math.tan((fov * DEG) / 2);

/** The frame pixel that a world point (see `NeedlePose`) is seen at. */
export function needleScreenPoint(p: Vec3, fov = NEEDLE_RIG.fov): { x: number; y: number } {
  const m = needleLensHeight(fov) / (needleLensHeight(fov) - p[2]);
  return { x: W / 2 + p[0] * m, y: H / 2 - p[1] * m };
}

const surfacePoint = (s: NeedleStrike): Vec3 => [s.x - W / 2, H / 2 - s.y, 0];

// A frame's time can land a hair under the beat it's on (a frame over the fps, less a scene's start): within this
// it has reached it, or its ripple would start a frame late.
const CONTACT_SLACK = 1e-6;

/** The latest strike to have landed by `t`, with seconds since; null before the first. A contact frame is one whose `t` has reached `at`. */
export function needleContactAt(strikes: readonly NeedleStrike[], t: number): { index: number; strike: NeedleStrike; since: number } | null {
  let found: { index: number; strike: NeedleStrike; since: number } | null = null;
  strikes.forEach((strike, index) => {
    if (strike.at <= t + CONTACT_SLACK && (!found || strike.at >= found.strike.at)) found = { index, strike, since: Math.max(0, t - strike.at) };
  });
  return found;
}

/** The needle's pose at `t`, or null while it's out of shot: between one strike's exit and the next one's way in. */
export function needlePoseAt(strikes: readonly NeedleStrike[], t: number, rig: Partial<NeedleRig> = {}): NeedlePose | null {
  const r = { ...NEEDLE_RIG, ...rig };
  const order = [...strikes].sort((p, q) => p.at - q.at);
  const rest = needleRestAxis(r);
  const here = tipPath(order, t, r, rest);
  if (!here) return null;
  // The lean follows the tip's velocity across its axis, a quarter frame back: so the contact frame still leans into
  // the blow, and the drive straightens it.
  const before = tipPath(order, t - LEAN_DT, r, rest);
  let axis = rest;
  if (before) {
    const velocity = scaleVec3(subVec3(here.tip, before.tip), 1 / LEAN_DT);
    const across = subVec3(velocity, scaleVec3(rest, dotVec3(velocity, rest)));
    const speed = lengthVec3(across);
    if (speed > 1e-6) axis = unitVec3(addVec3(rest, scaleVec3(across, (Math.tan(r.lean * DEG) * Math.tanh(speed / LEAN_SPEED)) / speed)));
  }
  return { ...here, axis };
}

/** The needle's axis at rest, tip to body: `tilt` off the lens, its body running toward `grip`. */
const needleRestAxis = (r: NeedleRig): Vec3 =>
  [Math.sin(r.tilt * DEG) * Math.cos(r.grip * DEG), Math.sin(r.tilt * DEG) * Math.sin(r.grip * DEG), Math.cos(r.tilt * DEG)];

const LEAN_DT = 1 / (4 * FPS);
// Frame px a second across its axis at which the lean is three quarters of `lean`: a blow reaches it, a drift doesn't.
const LEAN_SPEED = 3000;
// The ink drop keeps this much of itself through a strike.
const SPENT = 0.35;
// The exit covers its path as v^EXIT_POWER: it tears out of the surface and is fastest leaving frame, so its first
// frame smears short and its last long.
const EXIT_POWER = 1.6;

/** The tip's pose without the lean: the whole choreography. */
function tipPath(order: readonly NeedleStrike[], t: number, r: NeedleRig, axis: Vec3): Omit<NeedlePose, 'axis'> | null {
  const next = order.find((s) => s.at > t + CONTACT_SLACK);
  if (next && next.at - t < r.enter) {
    const p = surfacePoint(next);
    return { tip: lerpVec3(needleOffFrame(p, axis, r), p, 1 - (next.at - t) / r.enter), ink: next.ink, load: 1, fast: true };
  }
  const strike = order.findLast((s) => s.at <= t + CONTACT_SLACK);
  if (!strike) return null;
  const tau = Math.max(0, t - strike.at), p = surfacePoint(strike);
  const driven = subVec3(p, scaleVec3(axis, overdriveDepth(Math.min(tau, r.dwell), r.overdrive * r.scale)));
  const spent = { ink: strike.ink, load: SPENT };
  // Within the slack a frame on the dwell's last beat is still in the surface.
  if (tau < r.dwell + CONTACT_SLACK) return { tip: driven, ...spent, fast: false };
  const v = (tau - r.dwell) / r.exit;
  if (v >= 1) return null;
  return { tip: lerpVec3(driven, needleOffFrame(p, axis, r), v ** EXIT_POWER), ...spent, fast: true };
}

/** Depth past the surface `tau` seconds after contact: driven to `overdrive` a frame in, then easing back as it dwells. */
function overdriveDepth(tau: number, overdrive: number) {
  const k = Math.max(0, tau) * FPS;
  return overdrive * k * Math.exp(1 - k);
}

// Past the frame's edge by this much before the needle counts as gone, so its lean can't tip an edge back in.
const OFF_FRAME_MARGIN = 40;

/**
 * Where the tip comes in from and leaves to for a strike at `p`: the first point out along its path (toward `from`,
 * rising at `climb`) at which the needle is wholly out of frame.
 */
function needleOffFrame(p: Vec3, axis: Vec3, r: NeedleRig): Vec3 {
  const way = (r.from ?? r.grip) * DEG, rise = r.climb * DEG, lens = needleLensHeight(r.fov);
  const out: Vec3 = [Math.cos(rise) * Math.cos(way), Math.cos(rise) * Math.sin(way), Math.sin(rise)];
  const m = OFF_FRAME_MARGIN;
  for (let d = 20; ; d += 20) {
    const tip = addVec3(p, scaleVec3(out, d));
    if (tip[2] > 0.8 * lens) throw new Error(`the needle's path reaches the lens before it leaves frame: lower its climb (${r.climb}°)`);
    const pose = { tip, axis };
    const seen = NEEDLE_OUTLINE.some(([along, radius]) => [0, 1, 2, 3].some((j) => {
      const q = outlinePoint(pose, along * r.scale, radius * r.scale, (j * Math.PI) / 2);
      if (q[2] >= lens) return false;
      const s = needleScreenPoint(q, r.fov);
      return s.x > -m && s.x < W + m && s.y > -m && s.y < H + m;
    }));
    if (!seen) return tip;
  }
}

// ---------- the model, in mm, with the tip at the origin and the needle running up +z ----------

const NEEDLE_R = 0.175; // a #12 needle, 0.35 mm
const RING = 2 * NEEDLE_R; // the outer six sit touching the centre one
const TAPER = 4.4; // a long taper: point to full width
const CONVERGE = 0.2; // the outer points close in to this share of RING, so the grouping ends in one point
const SHAFT_TOP = 20; // hidden in the body past here
// The clear tip's mouth: the needle hangs this far out of it. A long hang, so the grouping reads from above.
const NOSE = 3.4;
const BODY_BACK = 40;

type Profile = [r: number, z: number][];

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

const arcPoints = (cr: number, cz: number, radius: number, from: number, to: number, n: number): Profile =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (from + ((to - from) * i) / n) * DEG;
    return [cr + radius * Math.cos(a), cz + radius * Math.sin(a)];
  });

const sampled = (n: number, f: (u: number) => [number, number]): Profile => Array.from({ length: n + 1 }, (_, i) => f(i / n));

/** One needle of the grouping: its centre line and radius at each height, and where its point is. */
function needleLine(i: number) {
  const angle = ((i - 1) * 60 + 12) * DEG;
  const [bx, by] = i === 0 ? [0, 0] : [RING * Math.cos(angle), RING * Math.sin(angle)];
  // The outer points sit a hair behind the centre one, each its own amount, as a hand-soldered grouping does.
  const point = i === 0 ? 0 : 0.07 + 0.06 * hashRandom('needle-point', i);
  const top = point + TAPER;
  const along = (z: number) => Math.min(1, Math.max(0, (z - point) / TAPER));
  const centre = (z: number): [number, number] => {
    const k = CONVERGE + (1 - CONVERGE) * motionCurves.dissolve(along(z));
    return [bx * k, by * k];
  };
  // A ground point: sharp at the tip, rounding into the shaft.
  const radius = (z: number) => (z <= point ? 0 : NEEDLE_R * (1 - Math.pow(1 - along(z), 1.6)));
  const zs = [...Array.from({ length: 17 }, (_, k) => point + TAPER * (k / 16) ** 2), SHAFT_TOP];
  return { centre, radius, zs, point, top };
}

// The clear tip, a closed shell: rounded mouth, outer cone, collar into the body, back down the bore.
const CLEAR_TIP: Profile[] = [
  arcPoints(1.0, NOSE + 0.34, 0.34, 180, 360, 10),
  sampled(12, (u) => [1.34 + (3.45 - 1.34) * u + 0.1 * Math.sin(Math.PI * u), NOSE + 0.34 + 8.56 * u]),
  [[3.45, NOSE + 8.9], [3.75, NOSE + 9.2]],
  [[3.75, NOSE + 9.2], [3.75, NOSE + 11.4]],
  [[3.75, NOSE + 11.4], [3.05, NOSE + 11.4]],
  [[3.05, NOSE + 11.4], [2.95, NOSE + 8.9]],
  sampled(10, (u) => [2.95 + (0.72 - 2.95) * u, NOSE + 8.9 - 8.1 * u]),
  [[0.72, NOSE + 0.8], [0.66, NOSE + 0.34]],
];

// The cartridge body: a flat front the tip plugs into, a neck, three grip grooves, a long barrel, a chamfered back.
const BODY_START = NOSE + 10.6;
const BODY_FRONT: Profile[] = [
  [[0.001, BODY_START], [3.98, BODY_START]],
  [[3.98, BODY_START], [3.98, BODY_START + 1.4]],
  [[3.98, BODY_START + 1.4], [4.75, BODY_START + 2.3]],
];
const BODY_BARREL: Profile[] = [
  [[4.75, BODY_START + 2.3], [4.75, BODY_START + 4.8]],
  ...[4.8, 5.8, 6.8].map((d) => BODY_START + d).flatMap((z): Profile[] => [[[4.75, z], [4.45, z + 0.14]], [[4.45, z + 0.14], [4.45, z + 0.46]], [[4.45, z + 0.46], [4.75, z + 0.6]], [[4.75, z + 0.6], [4.75, z + 1.0]]]),
  [[4.75, BODY_START + 7.8], [4.75, BODY_BACK - 0.8]],
  [[4.75, BODY_BACK - 0.8], [4.3, BODY_BACK]],
  [[4.3, BODY_BACK], [1.6, BODY_BACK]],
  [[1.6, BODY_BACK], [1.6, BODY_BACK - 1]],
  [[1.6, BODY_BACK - 1], [0.001, BODY_BACK - 1]],
];

// The solder that holds the grouping, a slightly lumpy sleeve behind the taper, seen through the clear tip.
const SOLDER: Profile[] = [sampled(14, (u) => [0.36 + 0.26 * Math.sin(Math.PI * Math.min(1, u * 1.4)) ** 0.5, NOSE + 3.2 + 2.6 * u])];

// ---------- exposures: as many as a fast frame needs to smear ----------

// Rings on the needle's outline, [mm up the axis, mm out from it]: the points, the mouth, the nose, the body's ends.
const NEEDLE_OUTLINE: readonly (readonly [number, number])[] = [
  [0, 0], [NOSE, 0.7], [NOSE + 8.9, 3.45], [BODY_START + 2.3, 4.75], [(BODY_START + BODY_BACK) / 2, 4.75], [BODY_BACK, 4.75],
];
// A sharp edge copied every 2.5 px or closer reads as a smear; further apart, as copies.
const SHARP_STEP = 2.5;

const outlinePoint = (pose: Pick<NeedlePose, 'tip' | 'axis'>, along: number, out: number, angle: number): Vec3 => {
  const a = pose.axis;
  const across: Vec3 = Math.hypot(a[0], a[1]) > 1e-6 ? unitVec3([-a[1], a[0], 0]) : [1, 0, 0];
  const side = crossVec3(a, across);
  return addVec3(addVec3(pose.tip, scaleVec3(a, along)), addVec3(scaleVec3(across, out * Math.cos(angle)), scaleVec3(side, out * Math.sin(angle))));
};

/** The share of the needle's length, tip to back end, whose image is in frame. */
function needleInFrame(pose: NeedlePose, r: NeedleRig) {
  const steps = 40;
  let seen = 0;
  for (let k = 0; k <= steps; k++) {
    const s = needleScreenPoint(addVec3(pose.tip, scaleVec3(pose.axis, (k / steps) * BODY_BACK * r.scale)), r.fov);
    if (s.x >= 0 && s.x <= W && s.y >= 0 && s.y <= H) seen++;
  }
  return seen / (steps + 1);
}

/**
 * Whether frame point `p` lies on the needle's picture at `t`, for a HUD judging its ground: the outline as discs a mm
 * apart down the axis. Only a frame that shows it sharp counts (the contact, the drive); a fast frame smears it into a
 * veil too faint to be the ground, so it covers nothing.
 */
export function needleCoversAt(strikes: readonly NeedleStrike[], t: number, p: { x: number; y: number }, rig: Partial<NeedleRig> = {}): boolean {
  const r = { ...NEEDLE_RIG, ...rig };
  const pose = needlePoseAt(strikes, t, r);
  if (!pose || pose.fast) return false;
  const lens = needleLensHeight(r.fov);
  return NEEDLE_OUTLINE.slice(1).some(([along1, out1], k) => {
    const [along0, out0] = NEEDLE_OUTLINE[k], steps = Math.max(1, Math.ceil(along1 - along0));
    return Array.from({ length: steps + 1 }, (_, j) => j / steps).some((u) => {
      const centre = addVec3(pose.tip, scaleVec3(pose.axis, (along0 + (along1 - along0) * u) * r.scale));
      const s = needleScreenPoint(centre, r.fov);
      return Math.hypot(p.x - s.x, p.y - s.y) <= ((out0 + (out1 - out0) * u) * r.scale * lens) / (lens - centre[2]);
    });
  });
}

/** How the lens is set for the needle's frames; `NeedleProps` says what each does. */
export type NeedleLensing = { rig?: Partial<NeedleRig>; shutter: number; fastShutter: number; focus: number };

/** One exposure of the frame: how long its shutter is open, as a share of a frame, and when each moment of it is taken. */
export type NeedleTake = {
  shutter: number;
  /** When the exposure `dt` seconds into the frame (−shutter/FPS … 0) is taken. */
  exposureAt: (dt: number) => number;
};

/** How the frame at `t` is taken: the needle's pose, how long the shutter is open, what's in focus, when each exposure is. */
export type NeedleShot = NeedleTake & {
  /** Null while the needle is out of shot. */
  pose: NeedlePose | null;
  /** Frame px from the lens to the plane that's sharp: through the point `focus` mm up the needle. */
  focusDistance: number;
  /** On a `streak` strike's contact frame, the whole way in, drawn behind the sharp needle; otherwise null. */
  streak: NeedleTake | null;
};

export function needleShotAt(strikes: readonly NeedleStrike[], t: number, o: NeedleLensing): NeedleShot {
  const r = { ...NEEDLE_RIG, ...o.rig };
  const pose = needlePoseAt(strikes, t, r);
  const lens = needleLensHeight(r.fov);
  const contact = needleContactAt(strikes, t);
  // A contact frame's shutter opens on the strike, so the needle lands sharp rather than streaking down its path.
  const opens = contact?.strike.at ?? -Infinity;
  // The frame after it has gone still catches the end of its exit, in the fast shutter.
  const tail = pose ? null : needlePoseAt(strikes, t - o.fastShutter / FPS, r);
  const seen = pose ?? tail;
  return {
    pose,
    shutter: seen?.fast ? o.fastShutter : o.shutter,
    focusDistance: seen ? lens - (seen.tip[2] + o.focus * r.scale * seen.axis[2]) : lens,
    exposureAt: (dt) => Math.max(t + dt, opens),
    streak: contact?.strike.streak && contact.since < 0.5 / FPS ? { shutter: r.enter * FPS, exposureAt: (dt) => t + dt } : null,
  };
}

/**
 * Exposures for the frame at `t`: enough that no point of the needle's outline in view moves further between two
 * than the lens already blurs it there, so a blow smears rather than strobes. At rest, `samples`; 0 while it's out of
 * the shot for the whole shutter, when there's nothing to draw.
 */
export function needleExposuresAt(strikes: readonly NeedleStrike[], t: number, o: NeedleLensing & NeedleSampling): number {
  const shot = needleShotAt(strikes, t, o);
  return needleTakeExposures(strikes, shot, shot.focusDistance, { ...NEEDLE_RIG, ...o.rig }, o);
}

type NeedleSampling = { samples: number; maxSamples: number; aperture: number };

function needleTakeExposures(strikes: readonly NeedleStrike[], take: NeedleTake, focusDistance: number, r: NeedleRig, o: NeedleSampling): number {
  const lens = needleLensHeight(r.fov), steps = 12;
  const poses = Array.from({ length: steps + 1 }, (_, k) => needlePoseAt(strikes, take.exposureAt(-((steps - k) / steps) * (take.shutter / FPS)), r));
  if (poses.every((pose) => pose === null)) return 0;
  let need = 0;
  for (const [along, out] of NEEDLE_OUTLINE) {
    for (let q = 0; q < 4; q++) {
      let travel = 0, blur = Infinity, last: { x: number; y: number; seen: boolean } | null = null;
      for (const pose of poses) {
        if (!pose) {
          last = null;
          continue;
        }
        const p = outlinePoint(pose, along * r.scale, out * r.scale, (q * Math.PI) / 2);
        const s = needleScreenPoint(p, r.fov), seen = s.x > 0 && s.x < W && s.y > 0 && s.y < H;
        if (last && (seen || last.seen)) travel += Math.hypot(s.x - last.x, s.y - last.y);
        // The defocus disc's diameter, by ThreeLens's thin lens (its focal length in px is the lens height).
        if (seen) blur = Math.min(blur, lens * o.aperture * Math.abs(1 / focusDistance - 1 / (lens - p[2])));
        last = { ...s, seen };
      }
      if (travel > 0) need = Math.max(need, travel / Math.max(SHARP_STEP, blur / 2) + 1);
    }
  }
  return Math.min(o.maxSamples, Math.max(o.samples, Math.ceil(need)));
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
