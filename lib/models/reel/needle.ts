// needle.ts: the needle shot's model, where the cartridge needle is at each moment and how each frame is taken. The
// strikes and the rig, the tip's path in and out of frame (`needlePoseAt`), when each strike lands (`needleContactAt`),
// where a point is seen, and each frame's shutter, focus and exposures. Pure: reel/needle.tsx draws it.

import { FPS, H, W } from '#models/frame/frame.ts';
import { addVec3, crossVec3, dotVec3, lengthVec3, lerpVec3, scaleVec3, subVec3, unitVec3, type Vec3 } from '#models/camera/vec3.ts';
import { BODY_BACK, BODY_START, NOSE } from './needle-cartridge.ts';

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

// ---------- where the tip is ----------

const DEG = Math.PI / 180;

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
export const needleRestAxis = (r: NeedleRig): Vec3 =>
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
export function needleInFrame(pose: NeedlePose, r: NeedleRig) {
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

export function needleTakeExposures(strikes: readonly NeedleStrike[], take: NeedleTake, focusDistance: number, r: NeedleRig, o: NeedleSampling): number {
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
