// needle.ts: the needle shot's model, where the cartridge needle is at each moment and how each frame is taken. The
// strikes and the rig, the tip's path in and out of frame (`needlePoseAt`), when each strike lands (`needleContactAt`),
// where a point is seen, and each frame's shutter, focus and exposures. Pure: reel/needle.tsx draws it.

import type { FrameSize, VideoFormat } from '#lib/picture/frame/models/frame.ts';
import { Vector3 } from 'three';
import type { Vector3Tuple } from 'three';
import { shotCameraProject, shotCameraRolled, type ShotCamera, type ShotPoint } from '#lib/picture/shot-camera/models/shot-camera.ts';
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
  /** The video's: strikes are px of its frame, and the default times its frames. */
  format: VideoFormat;
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

/** A rig as a scene gives it: the video's format, and any settings that differ from the reference rig's. */
export type NeedleRigSettings = Partial<NeedleRig> & Pick<NeedleRig, 'format'>;

/** The reference rig, under `settings`: gripped from the upper right, standing 40° out of the lens axis, driven in its own frame. */
export const needleRig = ({ format, ...settings }: NeedleRigSettings): NeedleRig => ({
  tilt: 40, grip: 30, scale: 20, fov: 20, climb: 30, enter: 2 / format.fps, dwell: 1 / format.fps, overdrive: 0.6, exit: 2.5 / format.fps, lean: 6,
  ...settings, format,
});

// ---------- where the tip is ----------

const DEG = Math.PI / 180;

/** Where the needle is at one moment. Positions are world px: x right and y up from the frame's centre, z toward the lens. */
export type NeedlePose = {
  tip: ShotPoint;
  /** Unit vector from the tip up the needle toward the body. */
  axis: Readonly<Vector3Tuple>;
  /** The ink on the tip: the strike's it's coming in to or has made. */
  ink: string;
  /** How full the drop of ink on the tip is, 0..1: full coming in, spent into the surface on contact. */
  load: number;
  /** Coming in or leaving: the moves too quick to shoot crisp. */
  fast: boolean;
};

/** The lens's height above the surface, in frame px: the distance at which one surface unit is one frame pixel. */
export const needleLensHeight = ({ fov, format }: Pick<NeedleRig, 'fov' | 'format'>) => format.height / 2 / Math.tan((fov * DEG) / 2);

/**
 * The rig's camera: straight down from the lens height, the frame's centre over the origin, slid by `shift` px as a
 * lens shift (the layers under the needle's shake).
 */
export function needleShotCamera(r: Pick<NeedleRig, 'fov' | 'format'>, shift = { x: 0, y: 0 }): ShotCamera {
  const lens = needleLensHeight(r), { width, height } = r.format;
  return shotCameraRolled({ frame: { width, height }, fov: r.fov, near: lens * 0.02, far: lens * 1.5, shift }, { position: [0, 0, lens], rollZ: 0 });
}

const surfacePoint = (s: NeedleStrike, { width, height }: FrameSize) => new Vector3(s.x - width / 2, height / 2 - s.y, 0);
const tupleOf = (v: Vector3): [number, number, number] => [v.x, v.y, v.z];

/** Whether frame point `s` is in the frame, or within `margin` px past its edges (negative: that far inside them). */
const inFrame = (s: { x: number; y: number }, { width, height }: FrameSize, margin: number) =>
  s.x > -margin && s.x < width + margin && s.y > -margin && s.y < height + margin;

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
export function needlePoseAt(strikes: readonly NeedleStrike[], t: number, rig: NeedleRigSettings): NeedlePose | null {
  const r = needleRig(rig);
  const order = strikes.toSorted((p, q) => p.at - q.at);
  const rest = new Vector3(...needleRestAxis(r));
  const here = tipPath(order, t, r, rest);
  if (!here) return null;
  // The lean follows the tip's velocity across its axis, a quarter frame back: so the contact frame still leans into
  // the blow, and the drive straightens it.
  const leanDt = 1 / (4 * r.format.fps);
  const before = tipPath(order, t - leanDt, r, rest);
  const axis = rest.clone();
  if (before) {
    const velocity = new Vector3(...here.tip).sub(new Vector3(...before.tip)).multiplyScalar(1 / leanDt);
    const across = velocity.clone().sub(rest.clone().multiplyScalar(velocity.dot(rest)));
    const speed = across.length();
    if (speed > 1e-6) axis.addScaledVector(across, (Math.tan(r.lean * DEG) * Math.tanh(speed / LEAN_SPEED)) / speed).normalize();
  }
  return { ...here, axis: tupleOf(axis) };
}

/** The needle's axis at rest, tip to body: `tilt` off the lens, its body running toward `grip`. */
export const needleRestAxis = (r: NeedleRig): Readonly<Vector3Tuple> =>
  [Math.sin(r.tilt * DEG) * Math.cos(r.grip * DEG), Math.sin(r.tilt * DEG) * Math.sin(r.grip * DEG), Math.cos(r.tilt * DEG)];

// Frame px a second across its axis at which the lean is three quarters of `lean`: a blow reaches it, a drift doesn't.
const LEAN_SPEED = 3000;
// The ink drop keeps this much of itself through a strike.
const SPENT = 0.35;
// The exit covers its path as v^EXIT_POWER: it tears out of the surface and is fastest leaving frame, so its first
// frame smears short and its last long.
const EXIT_POWER = 1.6;

/** The tip's pose without the lean: the whole choreography. */
function tipPath(order: readonly NeedleStrike[], t: number, r: NeedleRig, axis: Vector3): Omit<NeedlePose, 'axis'> | null {
  const next = order.find((s) => s.at > t + CONTACT_SLACK);
  if (next && next.at - t < r.enter) {
    const p = surfacePoint(next, r.format);
    return { tip: tupleOf(needleOffFrame(p, axis, r).lerp(p, 1 - (next.at - t) / r.enter)), ink: next.ink, load: 1, fast: true };
  }
  const strike = order.findLast((s) => s.at <= t + CONTACT_SLACK);
  if (!strike) return null;
  const tau = Math.max(0, t - strike.at), p = surfacePoint(strike, r.format);
  const driven = p.clone().sub(axis.clone().multiplyScalar(overdriveDepth(Math.min(tau, r.dwell), r.overdrive * r.scale, r.format.fps)));
  const spent = { ink: strike.ink, load: SPENT };
  // Within the slack a frame on the dwell's last beat is still in the surface.
  if (tau < r.dwell + CONTACT_SLACK) return { tip: tupleOf(driven), ...spent, fast: false };
  const v = (tau - r.dwell) / r.exit;
  if (v >= 1) return null;
  return { tip: tupleOf(driven.lerp(needleOffFrame(p, axis, r), v ** EXIT_POWER)), ...spent, fast: true };
}

/** Depth past the surface `tau` seconds after contact: driven to `overdrive` a frame in, then easing back as it dwells. */
function overdriveDepth(tau: number, overdrive: number, fps: number) {
  const k = Math.max(0, tau) * fps;
  return overdrive * k * Math.exp(1 - k);
}

// Past the frame's edge by this much before the needle counts as gone, so its lean can't tip an edge back in.
const OFF_FRAME_MARGIN = 40;

/**
 * Where the tip comes in from and leaves to for a strike at `p`: the first point out along its path (toward `from`,
 * rising at `climb`) at which the needle is wholly out of frame.
 */
function needleOffFrame(p: Vector3, axis: Vector3, r: NeedleRig): Vector3 {
  const way = (r.from ?? r.grip) * DEG, rise = r.climb * DEG, lens = needleLensHeight(r), camera = needleShotCamera(r);
  const out = new Vector3(Math.cos(rise) * Math.cos(way), Math.cos(rise) * Math.sin(way), Math.sin(rise));
  for (let d = 20; ; d += 20) {
    const tip = p.clone().add(out.clone().multiplyScalar(d));
    if (tip.z > 0.8 * lens) throw new Error(`the needle's path reaches the lens before it leaves frame: lower its climb (${r.climb}°)`);
    const seen = NEEDLE_OUTLINE.some(([along, radius]) => [0, 1, 2, 3].some((j) => {
      // A point at or behind the lens has no image, so it isn't seen.
      const s = shotCameraProject(camera, outlinePoint(tip, axis, along * r.scale, radius * r.scale, (j * Math.PI) / 2));
      return s !== null && inFrame(s, r.format, OFF_FRAME_MARGIN);
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

/** The point `along` up the needle's axis from `tip` and `out` from it, `angle` round it. */
function outlinePoint(tip: Vector3 | ShotPoint, axis: Vector3 | ShotPoint, along: number, out: number, angle: number): Vector3 {
  const a = axis instanceof Vector3 ? axis : new Vector3(...axis);
  const across = Math.hypot(a.x, a.y) > 1e-6 ? new Vector3(-a.y, a.x, 0).normalize() : new Vector3(1, 0, 0);
  const side = new Vector3().crossVectors(a, across);
  const ring = across.multiplyScalar(out * Math.cos(angle)).addScaledVector(side, out * Math.sin(angle));
  return (tip instanceof Vector3 ? tip.clone() : new Vector3(...tip)).addScaledVector(a, along).add(ring);
}

/** The share of the needle's length, tip to back end, whose image is in frame. */
export function needleInFrame(pose: NeedlePose, r: NeedleRig) {
  const steps = 40, camera = needleShotCamera(r);
  let seen = 0;
  for (let k = 0; k <= steps; k++) {
    const s = shotCameraProject(camera, outlinePoint(pose.tip, pose.axis, (k / steps) * BODY_BACK * r.scale, 0, 0));
    if (s && s.x >= 0 && s.x <= r.format.width && s.y >= 0 && s.y <= r.format.height) seen++;
  }
  return seen / (steps + 1);
}

/**
 * Whether frame point `p` lies on the needle's picture at `t`, for a HUD judging its ground: the outline as discs a mm
 * apart down the axis. Only a frame that shows it sharp counts (the contact, the drive); a fast frame smears it into a
 * veil too faint to be the ground, so it covers nothing.
 */
export function needleCoversAt(strikes: readonly NeedleStrike[], t: number, p: { x: number; y: number }, rig: NeedleRigSettings): boolean {
  const r = needleRig(rig);
  const pose = needlePoseAt(strikes, t, r);
  if (!pose || pose.fast) return false;
  const camera = needleShotCamera(r);
  return NEEDLE_OUTLINE.slice(1).some(([along1, out1], k) => {
    const [along0, out0] = NEEDLE_OUTLINE[k], steps = Math.max(1, Math.ceil(along1 - along0));
    return Array.from({ length: steps + 1 }, (_, j) => j / steps).some((u) => {
      const s = shotCameraProject(camera, outlinePoint(pose.tip, pose.axis, (along0 + (along1 - along0) * u) * r.scale, 0, 0));
      return s !== null && Math.hypot(p.x - s.x, p.y - s.y) <= (out0 + (out1 - out0) * u) * r.scale * s.scale;
    });
  });
}

/** How the lens is set for the needle's frames; `NeedleProps` says what each does. */
export type NeedleLensing = { rig: NeedleRigSettings; shutter: number; fastShutter: number; focus: number };

/** One exposure of the frame: how long its shutter is open, as a share of a frame, and when each moment of it is taken. */
export type NeedleTake = {
  shutter: number;
  /** When the exposure `dt` seconds into the frame (−shutter/fps … 0) is taken. */
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
  const r = needleRig(o.rig), { fps } = r.format;
  const pose = needlePoseAt(strikes, t, r);
  const lens = needleLensHeight(r);
  const contact = needleContactAt(strikes, t);
  // A contact frame's shutter opens on the strike, so the needle lands sharp rather than streaking down its path.
  const opens = contact?.strike.at ?? -Infinity;
  // The frame after it has gone still catches the end of its exit, in the fast shutter.
  const tail = pose ? null : needlePoseAt(strikes, t - o.fastShutter / fps, r);
  const seen = pose ?? tail;
  return {
    pose,
    shutter: seen?.fast ? o.fastShutter : o.shutter,
    focusDistance: seen ? lens - (seen.tip[2] + o.focus * r.scale * seen.axis[2]) : lens,
    exposureAt: (dt) => Math.max(t + dt, opens),
    streak: contact?.strike.streak && contact.since < 0.5 / fps ? { shutter: r.enter * fps, exposureAt: (dt) => t + dt } : null,
  };
}

/**
 * Exposures for the frame at `t`: enough that no point of the needle's outline in view moves further between two
 * than the lens already blurs it there, so a blow smears rather than strobes. At rest, `samples`; 0 while it's out of
 * the shot for the whole shutter, when there's nothing to draw.
 */
export function needleExposuresAt(strikes: readonly NeedleStrike[], t: number, o: NeedleLensing & NeedleSampling): number {
  const shot = needleShotAt(strikes, t, o);
  return needleTakeExposures(strikes, shot, shot.focusDistance, needleRig(o.rig), o);
}

type NeedleSampling = { samples: number; maxSamples: number; aperture: number };

export function needleTakeExposures(strikes: readonly NeedleStrike[], take: NeedleTake, focusDistance: number, r: NeedleRig, o: NeedleSampling): number {
  const lens = needleLensHeight(r), camera = needleShotCamera(r), steps = 12;
  const poses = Array.from({ length: steps + 1 }, (_, k) => needlePoseAt(strikes, take.exposureAt(-((steps - k) / steps) * (take.shutter / r.format.fps)), r));
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
        const s = shotCameraProject(camera, outlinePoint(pose.tip, pose.axis, along * r.scale, out * r.scale, (q * Math.PI) / 2));
        if (!s) {
          last = null;
          continue;
        }
        const seen = inFrame(s, r.format, 0);
        if (last && (seen || last.seen)) travel += Math.hypot(s.x - last.x, s.y - last.y);
        // The defocus disc's diameter, by ThreeLens's thin lens (its focal length in px is the lens height).
        if (seen) blur = Math.min(blur, lens * o.aperture * Math.abs(1 / focusDistance - 1 / s.depth));
        last = { x: s.x, y: s.y, seen };
      }
      if (travel > 0) need = Math.max(need, travel / Math.max(SHARP_STEP, blur / 2) + 1);
    }
  }
  return Math.min(o.maxSamples, Math.max(o.samples, Math.ceil(need)));
}
