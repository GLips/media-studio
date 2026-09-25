// needle.tsx: the reel's signature shot, a tattoo cartridge needle striking the frame itself. A 7-needle round liner,
// wet with ink, stands out of a clear-tipped cartridge; each strike plunges it into the surface on its beat, and
// between strikes it whips across to hover over the next point.
//
// The camera looks straight down from where one surface unit is one frame pixel, so each strike lands on its own
// pixel of the layer beneath (the ink grid). The canvas is transparent: needle, shadow and glints over whatever is
// under it. The motion is a pure function of time (`needlePoseAt`), and `needleContactAt` says when each strike lands.

import * as THREE from 'three';
import { FPS, H, W } from '../frame.ts';
import { motionCurves } from '../motion.ts';
import { pieceMotionAttrs } from '../motion-tag.ts';
import { hashRandom } from '../random.ts';
import { ThreeStage, type ThreeEnvironment, type ThreeFrame, type ThreeSample } from '../three-stage.tsx';

export type NeedleStrike = {
  /** Seconds on the piece's clock when the tip meets the surface: put it on a beat. */
  at: number;
  /** The frame pixel it strikes. */
  x: number;
  y: number;
  /** The ink wet on its tip as it comes in: the colour the layer beneath should start its ripple from. */
  ink: string;
};

/**
 * How the needle sits in the shot and moves between strikes. Lengths are mm on the cartridge, times seconds; the
 * defaults are a 120 BPM beat (15 frames): a 2-frame dwell, a whip that has covered 80% of the way in 2 frames, a
 * hover, a 5-frame plunge.
 */
export type NeedleRig = {
  /** Degrees between the needle and the lens axis: 0 points straight down the lens, 90 lies flat on the surface. */
  tilt: number;
  /** The direction the body comes from, on screen: degrees counterclockwise from pointing right (40: upper right). */
  from: number;
  /** Frame px per mm at the surface: 44 makes the 1.05 mm grouping of needles 46 px across. */
  scale: number;
  /** Vertical field of view, degrees. Narrower moves the lens back and flattens the perspective. */
  fov: number;
  /** The plunge: it leaves its hover this long before contact, accelerating (expo in) all the way down. */
  approach: number;
  /** Time it stays in the surface after contact before it lifts. */
  dwell: number;
  /** How far past the surface it drives on contact (mm along its axis), deepest a frame after. */
  overdrive: number;
  /** Where it waits above the next point (mm along its axis), and how far it cocks back from there before plunging. */
  hover: number;
  cock: number;
  /** Rise of the arc between strikes, as a share of the distance across. */
  arc: number;
  /** Degrees the body leans into a fast move; it straightens as the move settles. */
  lean: number;
  /** The first strike dives in from off frame over this long. */
  enter: number;
  /** Seconds after the last contact that it pulls out and leaves frame; `false` leaves it in the surface. */
  exit: number | false;
};

/** The reference rig. `exit` defaults to the end of the dwell: out as soon as the strike has landed. */
export const NEEDLE_RIG: NeedleRig = {
  tilt: 30, from: 40, scale: 44, fov: 30,
  approach: 5 / FPS, dwell: 2 / FPS, overdrive: 0.4, hover: 5, cock: 0.8, arc: 0.3, lean: 9,
  enter: 9 / FPS, exit: 2 / FPS,
};

// ---------- the pure part: where the tip is ----------

type Vec3 = readonly [number, number, number];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3) => mul(a, 1 / length(a));
const mix = (a: Vec3, b: Vec3, k: number) => add(a, mul(sub(b, a), k));
const bezier = (a: Vec3, c: Vec3, b: Vec3, k: number) => mix(mix(a, c, k), mix(c, b, k), k);
const DEG = Math.PI / 180;

const expoIn = motionCurves.expo.exit;
const expoOut = motionCurves.expo.entrance;
const smooth = (v: number, a: number, b: number) => motionCurves.dissolve((v - a) / (b - a));

/** Where the needle is at one moment. Positions are world px: x right and y up from the frame's centre, z toward the lens. */
export type NeedlePose = {
  tip: Vec3;
  /** Unit vector from the tip up the needle toward the body. */
  axis: Vec3;
  /** The ink on the tip, changing from `inkFrom` as `inkMix` runs 0 → 1 on the way to a strike. */
  ink: string;
  inkFrom: string;
  inkMix: number;
  /** How full the drop of ink on the tip is, 0..1: spent into the surface on contact, refilled on the way to the next. */
  load: number;
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

/** The needle's pose at `t`, or null while it's out of frame (before its entrance, after its exit). */
export function needlePoseAt(strikes: readonly NeedleStrike[], t: number, rig: Partial<NeedleRig> = {}): NeedlePose | null {
  const r = { ...NEEDLE_RIG, ...rig };
  const order = [...strikes].sort((p, q) => p.at - q.at);
  const rest = needleRestAxis(r);
  const here = tipPath(order, t, r, rest);
  if (!here) return null;
  // The lean follows the tip's velocity across its axis, a frame's quarter back: zero on the plunge, which runs along it.
  const before = tipPath(order, t - LEAN_DT, r, rest);
  let axis = rest;
  if (before) {
    const velocity = mul(sub(here.tip, before.tip), 1 / LEAN_DT);
    const across = sub(velocity, mul(rest, dot(velocity, rest)));
    const speed = length(across);
    if (speed > 1e-6) axis = unit(add(rest, mul(across, (Math.tan(r.lean * DEG) * Math.tanh(speed / LEAN_SPEED)) / speed)));
  }
  return { ...here, axis };
}

/** The needle's axis at rest, tip to body: `tilt` off the lens, leaning toward `from`. */
const needleRestAxis = (r: NeedleRig): Vec3 =>
  [Math.sin(r.tilt * DEG) * Math.cos(r.from * DEG), Math.sin(r.tilt * DEG) * Math.sin(r.from * DEG), Math.cos(r.tilt * DEG)];

const LEAN_DT = 1 / (4 * FPS);
// Frame px a second across its axis at which the lean is three quarters of `lean`: a whip reaches it, a drift doesn't.
const LEAN_SPEED = 3000;
// The ink drop keeps this much of itself through a strike.
const SPENT = 0.35;
// The dive in (and pull out) curves through a point this many hovers up the axis, so it arrives running along it.
const DIVE_RISE = 3;

/** The tip's pose without the lean: the whole choreography. */
function tipPath(order: readonly NeedleStrike[], t: number, r: NeedleRig, axis: Vec3): Omit<NeedlePose, 'axis'> | null {
  if (!order.length) return null;
  const px = r.scale;
  const depth = (tau: number) => overdriveDepth(tau, r.overdrive * px);
  const first = order[0];
  if (t < first.at - CONTACT_SLACK) {
    const v = (t - (first.at - r.enter)) / r.enter;
    if (v <= 0) return null;
    // A fall from rest just off frame: it's in view for most of the dive and fastest as it lands.
    const { start, bend } = offFrameDive(surfacePoint(first), axis, r);
    return { tip: bezier(start, bend, surfacePoint(first), v ** 2), ink: first.ink, inkFrom: first.ink, inkMix: 1, load: 1 };
  }
  const i = order.findLastIndex((s) => s.at <= t + CONTACT_SLACK);
  const strike = order[i], next = order[i + 1], tau = t - strike.at, p = surfacePoint(strike);
  const held = { ink: strike.ink, inkFrom: strike.ink, inkMix: 1 };

  if (!next) {
    const dwell = Math.min(r.dwell, r.exit === false ? Infinity : r.exit);
    const inside = sub(p, mul(axis, depth(Math.min(tau, dwell))));
    const spent = 1 - (1 - SPENT) * smooth(tau, 0, r.dwell);
    if (r.exit === false || tau < r.exit) return { tip: inside, ...held, load: spent };
    const v = (tau - r.exit) / r.enter;
    if (v >= 1) return null;
    const { start, bend } = offFrameDive(p, axis, r);
    return { tip: bezier(inside, bend, start, v ** 3), ...held, load: spent };
  }

  const gap = next.at - strike.at;
  const approach = Math.min(r.approach, 0.45 * gap), dwell = Math.min(r.dwell, 0.2 * gap);
  if (tau < dwell) return { tip: sub(p, mul(axis, depth(tau))), ...held, load: 1 - (1 - SPENT) * smooth(tau, 0, dwell) };

  const target = surfacePoint(next), hover = add(target, mul(axis, r.hover * px));
  const plunge = gap - approach;
  if (tau < plunge) {
    const u = (tau - dwell) / (plunge - dwell), k = expoOut(u);
    const from = sub(p, mul(axis, depth(dwell)));
    const across = sub(hover, from);
    const rise = r.arc * length(sub(across, mul(axis, dot(across, axis))));
    // The cock comes after the whip has all but landed: the hover draws back a little before the plunge.
    const lift = rise * 4 * k * (1 - k) + r.cock * px * smooth(u, 0.45, 1);
    return {
      tip: add(mix(from, hover, k), mul(axis, lift)),
      ink: next.ink, inkFrom: strike.ink, inkMix: smooth(u, 0.03, 0.25),
      load: SPENT + (1 - SPENT) * smooth(u, 0.08, 0.5),
    };
  }
  const v = (tau - plunge) / approach;
  return { tip: add(target, mul(axis, (r.hover + r.cock) * px * (1 - expoIn(v)))), ink: next.ink, inkFrom: next.ink, inkMix: 1, load: 1 };
}

/** Depth past the surface `tau` seconds after contact: driven to `overdrive` a frame in, then easing back as it dwells. */
function overdriveDepth(tau: number, overdrive: number) {
  const k = Math.max(0, tau) * FPS;
  return overdrive * k * Math.exp(1 - k);
}

/**
 * The curve a dive runs from off frame to the surface point `p`: it bends through a point up the needle's axis, so
 * the last of it runs along the axis. The start is out along the direction the body comes from, far enough that the
 * tip and the clear nose around it are past the frame's edge.
 */
function offFrameDive(p: Vec3, axis: Vec3, r: NeedleRig) {
  const bend = add(p, mul(axis, DIVE_RISE * r.hover * r.scale));
  const out: Vec3 = [Math.cos(r.from * DEG), Math.sin(r.from * DEG), 0];
  const lens = needleLensHeight(r.fov);
  let start = bend;
  for (let d = 0; d < 20 * W; d += 25) {
    start = add(bend, mul(out, d));
    const m = lens / (lens - start[2]), margin = 6 * r.scale * m;
    if (Math.abs(start[0] * m) > W / 2 + margin || Math.abs(start[1] * m) > H / 2 + margin) break;
  }
  return { start, bend };
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

const outlinePoint = (pose: NeedlePose, along: number, out: number, angle: number): Vec3 => {
  const a = pose.axis;
  const across: Vec3 = Math.hypot(a[0], a[1]) > 1e-6 ? unit([-a[1], a[0], 0]) : [1, 0, 0];
  const side = cross(a, across);
  return add(add(pose.tip, mul(a, along)), add(mul(across, out * Math.cos(angle)), mul(side, out * Math.sin(angle))));
};

/**
 * Exposures for the frame at `t`: enough that no point of the needle's outline in view moves further between two
 * than the lens already blurs it there, so a plunge or a whip smears rather than strobes. At rest, `samples`; 0 while
 * it's out of the shot for the whole shutter, when there's nothing to draw.
 */
export function needleExposuresAt(
  strikes: readonly NeedleStrike[], t: number, o: { rig?: Partial<NeedleRig>; samples: number; maxSamples: number; shutter: number; aperture: number },
): number {
  const r = { ...NEEDLE_RIG, ...o.rig };
  const lens = needleLensHeight(r.fov), steps = 12;
  const poses = Array.from({ length: steps + 1 }, (_, k) => needlePoseAt(strikes, t - ((steps - k) / steps) * (o.shutter / FPS), r));
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
        // The defocus disc's diameter: the lens is focused on the surface.
        if (seen) blur = Math.min(blur, (o.aperture * Math.max(0, p[2])) / (lens - p[2]));
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
function needleStage(r: NeedleRig, color: string, shadow: number) {
  const lens = needleLensHeight(r.fov);
  const camera = new THREE.PerspectiveCamera(r.fov, W / H, lens * 0.02, lens * 1.5);
  camera.position.set(0, 0, lens);
  camera.lookAt(0, 0, 0);
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
  // Wide enough to hold the body's far end when the needle hovers near a corner: a caster outside it casts nothing,
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
    ink.color.set(pose.inkFrom).lerp(new THREE.Color(pose.ink), pose.inkMix);
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
  /** How long the shutter stays open, as a share of a frame: 1 smears each frame into the next. */
  shutter?: number;
  /** The lens's opening in px: the body's middle blurs to about this wide a disc, the tip stays sharp. */
  aperture?: number;
  /**
   * The colour of the surface it strikes, which is what its polished steel mostly mirrors. The stage is composited
   * for it too: pass the ground it's drawn over, or its soft edges wash out over a light one.
   */
  ground?: string;
  /** Its name in the motion tracks (the tip's point on screen, reporting `lift`, mm above the surface); `false`: none. */
  motion?: string | false;
};

/**
 * The needle striking `strikes` in turn, on a transparent full-frame canvas: put it over the layer it strikes. The
 * tip meets each strike's pixel exactly at its `at`, and the ink on it is that strike's `ink`.
 *
 *   <Needle t={s.t} strikes={[{ at: g.at(0), x: 880, y: 590, ink: '#ee4c23' }, …]} />
 */
export function Needle({
  t, strikes, color = '#34353a', shadow = 0.45, samples = 32, maxSamples = 256, shutter = 1, aperture = 50, ground = '#0c0c0e', motion, ...rig
}: NeedleProps) {
  const r = { ...NEEDLE_RIG, ...rig };
  const pose = needlePoseAt(strikes, t, r);
  const tip = pose && needleScreenPoint(pose.tip, r.fov);
  const exposures = needleExposuresAt(strikes, t, { rig: r, samples, maxSamples, shutter, aperture });
  // Built on the frame's first exposure and shared by the rest; the stage frees it after the frame.
  let stage: ReturnType<typeof needleStage> | null = null;
  const draw = ({ dt }: ThreeSample) => (stage ??= needleStage(r, color, shadow))(needlePoseAt(strikes, t + dt, r));
  return (
    <>
      {exposures > 0 && (
        <ThreeStage transparent backdrop={ground} environment={needleStudio(needleRestAxis(r), ground)} shadows samples={exposures} shutter={shutter} softShadows={3}
          lens={{ focus: needleLensHeight(r.fov), aperture }} bloom={{ strength: 0.6, radius: 0.25, threshold: 1.6 }} draw={draw} />
      )}
      {tip && (
        <div {...pieceMotionAttrs(motion, 'needle', { kind: 'needle', values: { lift: pose.tip[2] / r.scale } })}
          style={{ position: 'absolute', left: tip.x - 3, top: tip.y - 3, width: 6, height: 6, pointerEvents: 'none' }} />
      )}
    </>
  );
}
