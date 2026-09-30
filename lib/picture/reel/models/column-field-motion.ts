// column-field-motion.ts: the cube field's camera move and ball, pure functions of t, and where a point of the
// field lands in the frame through that camera.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { fullFrameRect, type FrameSize } from '#lib/picture/frame/models/frame.ts';
import { clamp, lerp, sineInOutEase } from '#lib/picture/motion/models/motion.ts';
import type { Vec3 } from '#lib/picture/frame/models/vec3.ts';
import { columnFieldPoint, type ColumnBall, type ColumnBallState, type ColumnCameraMove, type ColumnCameraPose, type ColumnCameraState, type ColumnCell, type ColumnFieldSpec } from './column-field.ts';

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const focalPx = (fov: number, h: number) => h / 2 / Math.tan(rad(fov) / 2);
const Y = new Vector3(0, 1, 0);

// ---------- camera ----------

/**
 * Straight down on the field with one pitch `pitch` px across at the tops' `height`, in a box `frameHeight` px tall
 * (the field's `box`, or the frame): the first frame of a match cut from a 2D grid drawn at that pitch (the
 * reference's steps from 100 to 101.25). `centre` is the cell under the centre.
 */
export function topDownPose({ pitch, fov = 27, centre = [0, 0], height = 0, frameHeight }: { pitch: number; fov?: number; centre?: readonly [number, number]; height?: number; frameHeight: number }): ColumnCameraPose {
  return { target: [centre[0], height, centre[1]], distance: focalPx(fov, frameHeight) / pitch, elevation: 90, azimuth: 0, fov };
}

/**
 * The camera at t. `punchAt` evaluates the punches at another moment: a frame's exposures share the frame's, since a
 * one-frame punch smeared across the shutter would be lost. `ballAt` feeds the follow.
 */
export function columnCameraAt(move: ColumnCameraMove, t: number, o: { punchAt?: number; ballAt?: (t: number) => Vector3 | null } = {}): ColumnCameraState {
  const { from, to } = move;
  const [c0, c1] = move.crane;
  const k = (move.ease ?? sineInOutEase)(clamp((t - c0) / Math.max(1e-6, c1 - c0)));
  // The drift eases in over its first 0.3 s, so the move carries on from the crane without a kink.
  const after = Math.max(0, t - c1), ramp = after < 0.3 ? (after * after) / 0.6 : after - 0.15;
  const azimuth = lerp(from.azimuth, to.azimuth, k) + (move.drift?.azimuth ?? 0) * ramp;
  const elevation = lerp(from.elevation, to.elevation, k);
  const distance = lerp(from.distance, to.distance, k) + (move.drift?.distance ?? 0) * ramp;
  const target = new Vector3(...from.target).lerp(new Vector3(...to.target), k);

  const a = rad(azimuth), e = rad(elevation);
  const out = new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const position = target.clone().addScaledVector(out, distance);
  const forward = out.clone().negate();
  const right = new Vector3(Math.cos(a), 0, -Math.sin(a));
  // Screen-up from the azimuth, which stays defined looking straight down, where lookAt's world-up doesn't.
  const up = right.clone().cross(forward);

  let pan = 0;
  for (const p of move.pans ?? []) pan += p.deg * sineInOutEase((t - p.at) / p.dur);
  if (move.follow && o.ballAt) pan += move.follow.amount * k * followPan(position, forward, o.ballAt, t - move.follow.lag);
  let whip = 0;
  if (move.whip && t > move.whip.at) {
    const { rate = 30, double = 0.02 } = move.whip;
    const growth = 2 ** ((t - move.whip.at) / double);
    pan += ((rate * double) / Math.LN2) * (growth - 1);
    whip = clamp(Math.log2(growth) / 5);
  }
  const turn = new Quaternion().setFromAxisAngle(Y, -rad(pan));
  for (const v of [forward, right, up]) v.applyQuaternion(turn);

  let zoom = 1;
  const tp = o.punchAt ?? t;
  for (const p of move.punches ?? []) if (tp >= p.at) zoom *= 1 + p.amount * Math.exp(-(tp - p.at) / (move.punchDecay ?? 0.025));
  const fov = deg(2 * Math.atan(Math.tan(rad(lerp(from.fov, to.fov, k)) / 2) / zoom));
  return { position, forward, right, up, fov, target, crane: k, whip };
}

/** Degrees right that would aim the view at the ball's recent place, averaged over 0.1 s to follow travel, not hops. */
function followPan(position: Vector3, forward: Vector3, ballAt: (t: number) => Vector3 | null, t: number) {
  const sum = new Vector3();
  let n = 0;
  for (let s = 0; s < 5; s++) {
    const p = ballAt(t - s * 0.025);
    if (p) [sum.add(p), n++];
  }
  if (!n) return 0;
  const to = sum.divideScalar(n).sub(position);
  const d = Math.atan2(forward.x, forward.z) - Math.atan2(to.x, to.z);
  return deg(Math.atan2(Math.sin(d), Math.cos(d)));
}

export function fieldCamera<C extends ColumnCell>(spec: ColumnFieldSpec<C>, t: number, punchAt = t) {
  const ballAt = spec.ball && spec.camera.follow ? (at: number) => columnBallAt(spec, at)?.position ?? null : undefined;
  return columnCameraAt(spec.camera, t, { punchAt, ballAt });
}

// ---------- the ball ----------

/** A parabola from `p0` at `start`, flown over [t0, t1]: the fall in has t0 −∞, the launch out t1 ∞. */
type Flight = { start: number; t0: number; t1: number; p0: Vector3; v0: Vector3 };
type BallContact = { t0: number; t1: number; cell: readonly [number, number]; squash: number };
type BallPath = { flights: Flight[]; contacts: BallContact[] };

const ballPaths = new WeakMap<ColumnBall, WeakMap<readonly ColumnCell[], BallPath>>();

/** Parabolas joined at the contacts, each landing on its column's top as it stands at that moment. */
function ballPath<C extends ColumnCell>(spec: ColumnFieldSpec<C>, ball: ColumnBall): BallPath {
  const byCells = ballPaths.get(ball) ?? new WeakMap<readonly ColumnCell[], BallPath>();
  ballPaths.set(ball, byCells);
  const known = byCells.get(spec.cells);
  if (known) return known;
  const r = ball.radius ?? 0.55, g = ball.gravity ?? 100, c = ball.contact ?? 0.066;
  const top = (cell: readonly [number, number], at: number) => new Vector3(...columnFieldPoint(spec, at, cell, r));
  const aim = (t0: number, p0: Vector3, t1: number, p1: Vector3): Flight => {
    const T = Math.max(1e-3, t1 - t0);
    return { start: t0, t0, t1, p0, v0: p1.clone().sub(p0).divideScalar(T).addScaledVector(Y, 0.5 * g * T) };
  };
  const contacts = ball.contacts.toSorted((p, q) => p.at - q.at);
  const first = contacts[0];
  const { from, duration } = ball.enter ?? { from: [-1, 9, -7] as Vec3, duration: 0.45 };
  const landing = top(first.cell, first.at);
  const flights: Flight[] = [{ ...aim(first.at - duration, landing.clone().add(new Vector3(...from)), first.at, landing), t0: -Infinity }];
  for (const [k, contact] of contacts.entries()) {
    const next = contacts[k + 1], off = contact.at + c;
    if (next) flights.push(aim(off, top(contact.cell, off), next.at, top(next.cell, next.at)));
    else flights.push({ start: off, t0: off, t1: Infinity, p0: top(contact.cell, off), v0: new Vector3(...(ball.launch ?? [16, 20, -5])) });
  }
  const path = { flights, contacts: contacts.map((p) => ({ t0: p.at, t1: p.at + c, cell: p.cell, squash: p.squash ?? 0.25 })) };
  byCells.set(spec.cells, path);
  return path;
}

/** Where the ball is at t, or null for a field without one. */
export function columnBallAt<C extends ColumnCell>(spec: ColumnFieldSpec<C>, t: number): ColumnBallState | null {
  const ball = spec.ball;
  if (!ball?.contacts.length) return null;
  const r = ball.radius ?? 0.55, g = ball.gravity ?? 100;
  const path = ballPath(spec, ball);
  const roll = rollAt(path, t, r);
  const contact = path.contacts.find((p) => t >= p.t0 && t <= p.t1);
  if (contact) {
    // Squashed about the point it rests on: deepest a third of the way through the contact, round again by its end.
    const s = contact.squash * Math.sin(Math.PI * ((t - contact.t0) / (contact.t1 - contact.t0)) ** 0.7) ** 2;
    const position = new Vector3(...columnFieldPoint(spec, t, contact.cell, r * (1 - s)));
    const matrix = new Matrix4().makeTranslation(position).multiply(new Matrix4().makeScale(1 + s / 2, 1 - s, 1 + s / 2)).multiply(roll);
    return { position, velocity: new Vector3(), matrix, squash: s, radius: r };
  }
  const flight = path.flights.find((f) => t >= f.t0 && t <= f.t1)!;
  const dt = t - flight.start;
  const position = flight.p0.clone().addScaledVector(flight.v0, dt).addScaledVector(Y, -0.5 * g * dt * dt);
  const velocity = flight.v0.clone().addScaledVector(Y, -g * dt);
  const speed = velocity.length();
  const along = 1 + (ball.stretch ?? 0.12) * Math.min(speed / 50, 1.5), across = 1 / Math.sqrt(along);
  const toPath = new Quaternion().setFromUnitVectors(Y, speed > 1e-6 ? velocity.clone().divideScalar(speed) : Y);
  const stretch = new Matrix4().makeRotationFromQuaternion(toPath).multiply(new Matrix4().makeScale(across, along, across)).multiply(new Matrix4().makeRotationFromQuaternion(toPath.clone().invert()));
  const matrix = new Matrix4().makeTranslation(position).multiply(stretch).multiply(roll);
  return { position, velocity, matrix, squash: 0, radius: r };
}

/**
 * The spin of a ball rolling along its travel without slipping, zero at its first landing: each flight's turn, in
 * order (backwards along the fall in, before it). It shows only on a ball with a pattern, as the titanium's film.
 */
function rollAt(path: BallPath, t: number, r: number) {
  const total = new Quaternion();
  const landed = path.contacts[0].t0;
  for (const f of path.flights) {
    const span = Number.isFinite(f.t0) ? clamp(t, f.t0, f.t1) - f.t0 : Math.min(0, t - landed);
    const horizontal = new Vector3(f.v0.x, 0, f.v0.z);
    const speed = horizontal.length();
    if (span === 0 || speed < 1e-6) continue;
    total.premultiply(new Quaternion().setFromAxisAngle(Y.clone().cross(horizontal).normalize(), (speed * span) / r));
  }
  return new Matrix4().makeRotationFromQuaternion(total);
}

// ---------- projection ----------


/**
 * Where a point of the field (pitches) lands in a frame `frameSize` big at t: px, `box` included; its depth along the
 * view; px per pitch there. Null behind the camera. For HUD marks and type that must sit on a column or the ball.
 */
export function columnFieldProject<C extends ColumnCell>(spec: ColumnFieldSpec<C>, t: number, point: Vec3 | Vector3, frameSize: FrameSize) {
  const cam = fieldCamera(spec, t);
  const box = spec.box ?? fullFrameRect(frameSize);
  const v = (point instanceof Vector3 ? point.clone() : new Vector3(...point)).sub(cam.position);
  const depth = v.dot(cam.forward);
  if (depth <= 0.1) return null;
  const f = focalPx(cam.fov, box.h);
  return { x: box.x + box.w / 2 + (v.dot(cam.right) / depth) * f, y: box.y + box.h / 2 - (v.dot(cam.up) / depth) * f, depth, scale: f / depth };
}
