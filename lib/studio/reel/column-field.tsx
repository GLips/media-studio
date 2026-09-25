// column-field.tsx: the reel's cube field (the reference's "04 — 3D / DEPTH"): rounded columns rising out of flat
// tiles and churning in height, a ball hopping across their tops on the beat, and one camera move from straight
// overhead (at a 2D grid's pitch, for a match cut) down to a low three-quarter view, punching on each landing.
//
// Heights, the ball's path and the camera are pure functions of t, so the same functions draw the frame and aim HUD
// marks at it (columnFieldProject). ColumnField draws them on ThreeStage's accumulated exposures. The columns are one
// instanced mesh whose tops a vertex shader raises (scaling would stretch the bevel), darkened and tinted by their
// neighbours.

import { useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useDelayRender } from 'remotion';
import * as THREE from 'three';
import { areStudioFontsLoaded, studioFontsLoaded } from '../fonts.ts';
import { H, W } from '../frame.ts';
import { pieceMotionAttrs } from '../motion-tag.ts';
import { clamp, lerp, motionCurves, type EaseFn } from '../motion.ts';
import { hashRandom } from '../random.ts';
import { ThreeStage, softboxEnvironment, type ThreeBloom, type ThreeEnvironment, type ThreeFrame, type ThreeLens, type ThreeSample } from '../three-stage.tsx';

export type ColumnVec3 = readonly [number, number, number];

/** A column: its place on the grid (i across, j down the overhead frame, a pitch apart) and its colour. */
export type ColumnCell = { i: number; j: number; color: string };

/**
 * An orbit camera, in pitches and degrees: `elevation` above the ground (90 looks straight down), `azimuth` round the
 * target (0 looks from +z, the bottom of the overhead frame; negative circles clockwise seen from above), vertical `fov`.
 */
export type ColumnCameraPose = { target: ColumnVec3; distance: number; elevation: number; azimuth: number; fov: number };

/**
 * One continuous move: a crane between two poses over `crane` (seconds, on `ease`, an in-out sine), then `drift` per
 * second. On top: `punches` (the image grows by `amount`, 0.019 = 1.9 %, relaxing over `punchDecay` s), `pans`
 * (degrees, + right), a `follow` panning `amount` of the way toward where the ball was `lag` s ago, and a `whip` right.
 */
export type ColumnCameraMove = {
  from: ColumnCameraPose;
  to: ColumnCameraPose;
  crane: readonly [number, number];
  ease?: EaseFn;
  drift?: { azimuth?: number; distance?: number };
  punches?: readonly { at: number; amount: number }[];
  punchDecay?: number;
  pans?: readonly { at: number; deg: number; dur: number }[];
  follow?: { amount: number; lag: number };
  /**
   * From `at`, a turn at `rate` °/s (30; negative whips left) doubling every `double` s (0.02, the reference's 0.5, 1.2,
   * 2.3 °/f at 60 fps). The focus gives way by `defocus` of its distance; its frames take `samples` exposures (32).
   */
  whip?: { at: number; rate?: number; double?: number; defocus?: number; samples?: number };
};

/** The camera at a moment: where it is, its axes, its vertical fov (punches in), crane progress and whip (0..1). */
export type ColumnCameraState = {
  position: THREE.Vector3; forward: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3;
  fov: number; target: THREE.Vector3; crane: number; whip: number;
};

/**
 * A ball landing on column tops at `contacts` (seconds, cell, squash 0.13–0.27 in the reference), hopping between them
 * on parabolas under `gravity` (pitch/s², 100: earth's at a 10 cm pitch). It falls in from `enter.from` (pitches from
 * its first landing, over `enter.duration` s) and leaves at `launch` (pitch/s). `radius` (0.55) above 0.68 grazes
 * neighbours.
 */
export type ColumnBall = {
  contacts: readonly { at: number; cell: readonly [number, number]; squash?: number }[];
  radius?: number;
  gravity?: number;
  enter?: { from: ColumnVec3; duration: number };
  launch?: ColumnVec3;
  /** Seconds it stays on a top while it squashes: the reference's squash peaks 25 ms in and is gone by 70. */
  contact?: number;
  /** How far it stretches along its path at 50 pitch/s (0.12). */
  stretch?: number;
  /** 'gloss' is the reference's orange-red plastic; 'titanium' is anodized, blue going violet at the rim. */
  material?: 'gloss' | 'chrome' | 'titanium' | ((environment: THREE.Texture | null) => THREE.Material);
  /** Also cast the key's shadow, long under a raking key. Off, its only shadow is the pool's, straight down. */
  keyShadow?: boolean;
};

/** Where the ball is: its centre, the matrix that places, squashes, stretches and rolls it, and how squashed it is. */
export type ColumnBallState = { position: THREE.Vector3; velocity: THREE.Vector3; matrix: THREE.Matrix4; squash: number; radius: number };

/** Tiles extruding into columns in a wave from `from` (cell) at `speed` pitch/s, each over `duration` s. */
export type ColumnRise = { at: number; from?: readonly [number, number]; speed?: number; duration?: number; tile?: number };

/**
 * A card on a column's top, drawn in the scene so it takes the shot's perspective, focus and motion blur. `paint` draws
 * it once a frame at `resolution` canvas px a pitch. `tilt` 0 lies flat, 90 stands; 'camera' stands it up as the
 * camera comes down. `turn` (degrees about the vertical; 'camera') faces the lens.
 */
export type ColumnLabel = {
  cell: readonly [number, number];
  size: readonly [number, number];
  paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  resolution?: number;
  tilt?: number | 'camera';
  turn?: number | 'camera';
  /** From the centre of the column's top, pitches. */
  offset?: ColumnVec3;
  opacity?: number;
  /** Multiplies its colours: above 1 holds a white against the tone mapping, which takes 1 down to about 0.8. */
  intensity?: number;
};

export type ColumnLight = { azimuth: number; elevation: number; color: string; intensity: number };

/** The shot's lights; each one left out is the reference's. */
export type ColumnFieldLights = {
  /** Casts the columns' shadows (the reference's from the upper left: azimuth −135); `softness` is their penumbra in degrees. */
  key?: ColumnLight & { softness?: number };
  /** Lights edges from behind. */
  rim?: ColumnLight;
  /**
   * A lamp over the camera's target, lighting to `spread` degrees (38) off straight down, `intensity` on the target.
   * It rides `above` (0.8) times the camera's height over the target: looking straight down it washes the frame; as
   * the camera comes down its light gathers into a pool. Under the camera, it throws a falling ball's shadow ahead of it.
   */
  pool?: {
    intensity: number; color: string; above?: number; spread?: number;
    /** The lamp's width in pitches (3): the ball's shadow is as soft as the lamp is wide. */
    size?: number;
  };
  /** A hemisphere: `sky` from above, `ground` from below. */
  fill?: { sky: string; ground: string; intensity: number };
  /** How much of the room columns and ground reflect. */
  environment?: number;
};

export type ColumnFieldSpec<C extends ColumnCell = ColumnCell> = {
  cells: readonly C[];
  /** A column's height in pitches at t; default the reference's churn, columnNoise({ seed }). */
  height?: (cell: C, t: number) => number;
  seed?: number;
  rise?: ColumnRise;
  camera: ColumnCameraMove;
  ball?: ColumnBall;
  /** A thin lens `aperture` pitches across (the reference's 0.17 is about f/3), focused on the ball, target or a distance. */
  lens?: { aperture: number; focus?: 'ball' | 'target' | number };
  lights?: ColumnFieldLights;
  /** In pitches: `width` 0.64, `corner` radius seen from above 0.1, top `bevel` 0.1; `ao` (0.9), `bleed` (0.6) and `vary` (0.08) 0..1. */
  column?: { width?: number; corner?: number; bevel?: number; roughness?: number; ao?: number; bleed?: number; vary?: number };
  ground?: string;
  /** Fades to `color` from `near` to `far` pitches beyond the camera's target (the reference's #120d16, 0 to 7). */
  fog?: { color: string; near: number; far: number } | false;
  labels?: (t: number) => readonly ColumnLabel[];
  box?: { x: number; y: number; w: number; h: number };
};

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

const FULL_BOX = { x: 0, y: 0, w: W, h: H };
const REFERENCE_FOG = { color: '#120d16', near: 0, far: 7 };
const REFERENCE_LIGHTS = {
  key: { azimuth: -135, elevation: 25, color: '#fffaf6', intensity: 1.5, softness: 4 },
  pool: { intensity: 2.6, color: '#fffaf6', above: 0.8, spread: 38, size: 3 },
  fill: { sky: '#58505f', ground: '#f4f0f4', intensity: 1.3 },
  environment: 0.05,
} satisfies ColumnFieldLights;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const focalPx = (fov: number, h: number) => h / 2 / Math.tan(rad(fov) / 2);
const sineInOut: EaseFn = (k) => (1 - Math.cos(Math.PI * clamp(k))) / 2;
const Y = new THREE.Vector3(0, 1, 0);

// ---------- heights ----------

/**
 * Smooth value noise over the grid and time, for columns that churn like the reference's: `min`–`max` pitches (0.6–3),
 * a column doubling in about a third of a second. `scale` is noise cells per pitch, `speed` noise cells per second.
 * Value noise bunches around its middle: `contrast` stretches it toward the ends (clamped there).
 */
export function columnNoise({ seed = 1, min = 0.6, max = 3, scale = 0.2, speed = 0.8, contrast = 1 }: { seed?: number; min?: number; max?: number; scale?: number; speed?: number; contrast?: number } = {}) {
  const s = Math.floor(hashRandom('column-noise', seed) * 0x7fffffff);
  return (cell: { i: number; j: number }, t: number) => min + (max - min) * clamp(0.5 + contrast * (valueNoise(s, cell.i * scale, cell.j * scale, t * speed) - 0.5));
}

const noiseBySeed = new Map<number, (cell: ColumnCell, t: number) => number>();
function defaultHeight(seed = 1) {
  let height = noiseBySeed.get(seed);
  if (!height) noiseBySeed.set(seed, (height = columnNoise({ seed })));
  return height;
}

/** A column's height at t, rise included: the tile it starts as, until the wave reaches it. */
export function columnFieldHeight<C extends ColumnCell>(spec: Pick<ColumnFieldSpec<C>, 'height' | 'rise' | 'seed'>, cell: C, t: number) {
  const full = (spec.height ?? defaultHeight(spec.seed))(cell, t);
  const rise = spec.rise;
  if (!rise) return full;
  const [fi, fj] = rise.from ?? [0, 0];
  const start = rise.at + Math.hypot(cell.i - fi, cell.j - fj) / (rise.speed ?? 42);
  return lerp(rise.tile ?? 0.12, full, motionCurves.cubic.entrance((t - start) / (rise.duration ?? 0.12)));
}

/** Cells filling a disc `radius` pitches about `centre`, each coloured by `color(i, j)`: a floor that reaches the fog. */
export function columnDiscCells({ radius, centre = [0, 0], color }: { radius: number; centre?: readonly [number, number]; color: (i: number, j: number) => string }): ColumnCell[] {
  const cells: ColumnCell[] = [];
  const r = Math.ceil(radius);
  for (let j = centre[1] - r; j <= centre[1] + r; j++) {
    for (let i = centre[0] - r; i <= centre[0] + r; i++) if ((i - centre[0]) ** 2 + (j - centre[1]) ** 2 <= radius * radius) cells.push({ i, j, color: color(i, j) });
  }
  return cells;
}

function valueNoise(seed: number, x: number, y: number, z: number) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = fade(x - x0), fy = fade(y - y0), fz = fade(z - z0);
  const v = (dx: number, dy: number, dz: number) => lattice(seed, x0 + dx, y0 + dy, z0 + dz);
  const near = lerp(lerp(v(0, 0, 0), v(1, 0, 0), fx), lerp(v(0, 1, 0), v(1, 1, 0), fx), fy);
  const far = lerp(lerp(v(0, 0, 1), v(1, 0, 1), fx), lerp(v(0, 1, 1), v(1, 1, 1), fx), fy);
  return lerp(near, far, fz);
}

const fade = (k: number) => k * k * k * (k * (k * 6 - 15) + 10);

/** A value in [0, 1) per integer lattice point, from 32-bit integer mixing, so every engine agrees to the bit. */
function lattice(seed: number, x: number, y: number, z: number) {
  let h = seed | 0;
  h = Math.imul(h ^ x, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16) ^ y, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ z, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2d);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const cellIndexes = new WeakMap<readonly ColumnCell[], Map<string, number>>();
function cellIndex(cells: readonly ColumnCell[]) {
  let index = cellIndexes.get(cells);
  if (!index) cellIndexes.set(cells, (index = new Map(cells.map((c, k) => [`${c.i},${c.j}`, k]))));
  return index;
}
function cellAt<C extends ColumnCell>(cells: readonly C[], i: number, j: number): C | undefined {
  const k = cellIndex(cells).get(`${i},${j}`);
  return k === undefined ? undefined : cells[k];
}

// ---------- camera ----------

/**
 * Straight down on the field with one pitch `pitch` px across at the tops' `height`: the first frame of a match cut
 * from a 2D grid drawn at that pitch (the reference's steps from 100 to 101.25). `centre` is the cell under the centre.
 */
export function topDownPose({ pitch, fov = 27, centre = [0, 0], height = 0, frameHeight = H }: { pitch: number; fov?: number; centre?: readonly [number, number]; height?: number; frameHeight?: number }): ColumnCameraPose {
  return { target: [centre[0], height, centre[1]], distance: focalPx(fov, frameHeight) / pitch, elevation: 90, azimuth: 0, fov };
}

/**
 * The camera at t. `punchAt` evaluates the punches at another moment: a frame's exposures share the frame's, since a
 * one-frame punch smeared across the shutter would be lost. `ballAt` feeds the follow.
 */
export function columnCameraAt(move: ColumnCameraMove, t: number, o: { punchAt?: number; ballAt?: (t: number) => THREE.Vector3 | null } = {}): ColumnCameraState {
  const { from, to } = move;
  const [c0, c1] = move.crane;
  const k = (move.ease ?? sineInOut)(clamp((t - c0) / Math.max(1e-6, c1 - c0)));
  // The drift eases in over its first 0.3 s, so the move carries on from the crane without a kink.
  const after = Math.max(0, t - c1), ramp = after < 0.3 ? (after * after) / 0.6 : after - 0.15;
  const azimuth = lerp(from.azimuth, to.azimuth, k) + (move.drift?.azimuth ?? 0) * ramp;
  const elevation = lerp(from.elevation, to.elevation, k);
  const distance = lerp(from.distance, to.distance, k) + (move.drift?.distance ?? 0) * ramp;
  const target = new THREE.Vector3(...from.target).lerp(new THREE.Vector3(...to.target), k);

  const a = rad(azimuth), e = rad(elevation);
  const out = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const position = target.clone().addScaledVector(out, distance);
  const forward = out.clone().negate();
  const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
  // Screen-up from the azimuth, which stays defined looking straight down, where lookAt's world-up doesn't.
  const up = right.clone().cross(forward);

  let pan = 0;
  for (const p of move.pans ?? []) pan += p.deg * sineInOut((t - p.at) / p.dur);
  if (move.follow && o.ballAt) pan += move.follow.amount * k * followPan(position, forward, o.ballAt, t - move.follow.lag);
  let whip = 0;
  if (move.whip && t > move.whip.at) {
    const { rate = 30, double = 0.02 } = move.whip;
    const growth = 2 ** ((t - move.whip.at) / double);
    pan += ((rate * double) / Math.LN2) * (growth - 1);
    whip = clamp(Math.log2(growth) / 5);
  }
  const turn = new THREE.Quaternion().setFromAxisAngle(Y, -rad(pan));
  for (const v of [forward, right, up]) v.applyQuaternion(turn);

  let zoom = 1;
  const tp = o.punchAt ?? t;
  for (const p of move.punches ?? []) if (tp >= p.at) zoom *= 1 + p.amount * Math.exp(-(tp - p.at) / (move.punchDecay ?? 0.025));
  const fov = deg(2 * Math.atan(Math.tan(rad(lerp(from.fov, to.fov, k)) / 2) / zoom));
  return { position, forward, right, up, fov, target, crane: k, whip };
}

/** Degrees right that would aim the view at the ball's recent place, averaged over 0.1 s to follow travel, not hops. */
function followPan(position: THREE.Vector3, forward: THREE.Vector3, ballAt: (t: number) => THREE.Vector3 | null, t: number) {
  const sum = new THREE.Vector3();
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

function fieldCamera<C extends ColumnCell>(spec: ColumnFieldSpec<C>, t: number, punchAt = t) {
  const ballAt = spec.ball && spec.camera.follow ? (at: number) => columnBallAt(spec, at)?.position ?? null : undefined;
  return columnCameraAt(spec.camera, t, { punchAt, ballAt });
}

// ---------- the ball ----------

/** A parabola from `p0` at `start`, flown over [t0, t1]: the fall in has t0 −∞, the launch out t1 ∞. */
type Flight = { start: number; t0: number; t1: number; p0: THREE.Vector3; v0: THREE.Vector3 };
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
  const top = (cell: readonly [number, number], at: number) => new THREE.Vector3(...columnFieldPoint(spec, at, cell, r));
  const aim = (t0: number, p0: THREE.Vector3, t1: number, p1: THREE.Vector3): Flight => {
    const T = Math.max(1e-3, t1 - t0);
    return { start: t0, t0, t1, p0, v0: p1.clone().sub(p0).divideScalar(T).addScaledVector(Y, 0.5 * g * T) };
  };
  const contacts = [...ball.contacts].sort((p, q) => p.at - q.at);
  const first = contacts[0];
  const { from, duration } = ball.enter ?? { from: [-1, 9, -7] as ColumnVec3, duration: 0.45 };
  const landing = top(first.cell, first.at);
  const flights: Flight[] = [{ ...aim(first.at - duration, landing.clone().add(new THREE.Vector3(...from)), first.at, landing), t0: -Infinity }];
  for (const [k, contact] of contacts.entries()) {
    const next = contacts[k + 1], off = contact.at + c;
    if (next) flights.push(aim(off, top(contact.cell, off), next.at, top(next.cell, next.at)));
    else flights.push({ start: off, t0: off, t1: Infinity, p0: top(contact.cell, off), v0: new THREE.Vector3(...(ball.launch ?? [16, 20, -5])) });
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
    const position = new THREE.Vector3(...columnFieldPoint(spec, t, contact.cell, r * (1 - s)));
    const matrix = new THREE.Matrix4().makeTranslation(position).multiply(new THREE.Matrix4().makeScale(1 + s / 2, 1 - s, 1 + s / 2)).multiply(roll);
    return { position, velocity: new THREE.Vector3(), matrix, squash: s, radius: r };
  }
  const flight = path.flights.find((f) => t >= f.t0 && t <= f.t1)!;
  const dt = t - flight.start;
  const position = flight.p0.clone().addScaledVector(flight.v0, dt).addScaledVector(Y, -0.5 * g * dt * dt);
  const velocity = flight.v0.clone().addScaledVector(Y, -g * dt);
  const speed = velocity.length();
  const along = 1 + (ball.stretch ?? 0.12) * Math.min(speed / 50, 1.5), across = 1 / Math.sqrt(along);
  const toPath = new THREE.Quaternion().setFromUnitVectors(Y, speed > 1e-6 ? velocity.clone().divideScalar(speed) : Y);
  const stretch = new THREE.Matrix4().makeRotationFromQuaternion(toPath).multiply(new THREE.Matrix4().makeScale(across, along, across)).multiply(new THREE.Matrix4().makeRotationFromQuaternion(toPath.clone().invert()));
  const matrix = new THREE.Matrix4().makeTranslation(position).multiply(stretch).multiply(roll);
  return { position, velocity, matrix, squash: 0, radius: r };
}

/**
 * The spin of a ball rolling along its travel without slipping, zero at its first landing: each flight's turn, in
 * order (backwards along the fall in, before it). It shows only on a ball with a pattern, as the titanium's film.
 */
function rollAt(path: BallPath, t: number, r: number) {
  const total = new THREE.Quaternion();
  const landed = path.contacts[0].t0;
  for (const f of path.flights) {
    const span = Number.isFinite(f.t0) ? clamp(t, f.t0, f.t1) - f.t0 : Math.min(0, t - landed);
    const horizontal = new THREE.Vector3(f.v0.x, 0, f.v0.z);
    const speed = horizontal.length();
    if (span === 0 || speed < 1e-6) continue;
    total.premultiply(new THREE.Quaternion().setFromAxisAngle(Y.clone().cross(horizontal).normalize(), (speed * span) / r));
  }
  return new THREE.Matrix4().makeRotationFromQuaternion(total);
}

// ---------- projection ----------

/** The centre of a column's top at t, `lift` pitches above it: the point to hand columnFieldProject for a mark. */
export function columnFieldPoint<C extends ColumnCell>(spec: Pick<ColumnFieldSpec<C>, 'cells' | 'height' | 'rise' | 'seed'>, t: number, cell: readonly [number, number], lift = 0): ColumnVec3 {
  const found = cellAt(spec.cells, cell[0], cell[1]);
  return [cell[0], (found ? columnFieldHeight(spec, found, t) : 0) + lift, cell[1]];
}

/**
 * Where a point of the field (pitches) lands in the frame at t: px, `box` included; its depth along the view; px per
 * pitch there. Null behind the camera. For HUD marks and type that must sit on a column or the ball.
 */
export function columnFieldProject<C extends ColumnCell>(spec: ColumnFieldSpec<C>, t: number, point: ColumnVec3 | THREE.Vector3) {
  const cam = fieldCamera(spec, t);
  const box = spec.box ?? FULL_BOX;
  const v = (point instanceof THREE.Vector3 ? point.clone() : new THREE.Vector3(...point)).sub(cam.position);
  const depth = v.dot(cam.forward);
  if (depth <= 0.1) return null;
  const f = focalPx(cam.fov, box.h);
  return { x: box.x + box.w / 2 + (v.dot(cam.right) / depth) * f, y: box.y + box.h / 2 - (v.dot(cam.up) / depth) * f, depth, scale: f / depth };
}

// ---------- the component ----------

/**
 * The field, drawn on ThreeStage with the reference's light and fog unless given others. Tagged `column-field`
 * (crane and whip progress as values) with the ball inside it as `ball` (its squash).
 */
export function ColumnField<C extends ColumnCell>({ t, samples = 12, shutter = 0.5, bloom, environment = softboxEnvironment, toneMapping = THREE.NeutralToneMapping, exposure, motion, ...spec }: ColumnFieldProps<C>) {
  const box = spec.box ?? FULL_BOX;
  const fontsReady = useFontsReady(Boolean(spec.labels));
  const cam = fieldCamera(spec, t);
  const ball = columnBallAt(spec, t);
  const mark = ball && columnFieldProject(spec, t, ball.position);
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

/** Holds the frame until the studio's faces are in: labels painted before would keep the fallback face. */
function useFontsReady(needed: boolean) {
  const [ready, setReady] = useState(areStudioFontsLoaded);
  const { delayRender, continueRender } = useDelayRender();
  useLayoutEffect(() => {
    if (!needed || ready) return;
    const handle = delayRender('column field labels waiting for fonts');
    let open = true;
    const release = () => {
      if (open) continueRender(handle);
      open = false;
    };
    studioFontsLoaded.then(() => {
      if (!open) return;
      flushSync(() => setReady(true));
      release();
    });
    return release;
  }, [needed, ready, delayRender, continueRender]);
  return ready || !needed;
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

  const camera = new THREE.PerspectiveCamera(27, W / H, 0.1, 600);
  return { scene, camera, fog, heights, neighbourHeights, neighbours: topology.neighbours, heightAttr, neighbourAttr, key, rim, pool, ball, ballShadow, labels };
}

function aimLight(light: THREE.DirectionalLight, at: THREE.Vector3, { azimuth, elevation }: ColumnLight) {
  const a = rad(azimuth), e = rad(elevation), reach = 60;
  light.position.set(at.x + reach * Math.sin(a) * Math.cos(e), at.y + reach * Math.sin(e), at.z + reach * Math.cos(a) * Math.cos(e));
  light.target.position.copy(at);
}

type ColumnTopology = { neighbours: Int32Array; colors: Float32Array; neighbourColors: Float32Array };
const topologies = new WeakMap<readonly ColumnCell[], Map<string, ColumnTopology>>();
const NEIGHBOUR_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Each column's neighbours (+x, −x, +z, −z; −1 for none) and colours: its own, its value varied by up to `vary` as
 * painted plaster's is, and its neighbours' packed a float each (8 bits a channel: exact in a float's 24-bit mantissa).
 */
function columnTopology(cells: readonly ColumnCell[], vary: number, seed: number): ColumnTopology {
  const byKey = topologies.get(cells) ?? new Map<string, ColumnTopology>();
  topologies.set(cells, byKey);
  const known = byKey.get(`${vary}|${seed}`);
  if (known) return known;
  const index = cellIndex(cells), n = cells.length;
  const neighbours = new Int32Array(4 * n), colors = new Float32Array(3 * n), packed = new Float32Array(n), neighbourColors = new Float32Array(4 * n);
  const color = new THREE.Color();
  const byte = (v: number) => Math.round(clamp(v) * 255);
  for (const [k, cell] of cells.entries()) {
    color.set(cell.color).multiplyScalar(1 + vary * (2 * hashRandom('column-vary', seed, cell.i, cell.j) - 1));
    colors.set([color.r, color.g, color.b], 3 * k);
    packed[k] = byte(color.r) * 65536 + byte(color.g) * 256 + byte(color.b);
    for (const [s, [di, dj]] of NEIGHBOUR_STEPS.entries()) neighbours[4 * k + s] = index.get(`${cell.i + di},${cell.j + dj}`) ?? -1;
  }
  for (let k = 0; k < 4 * n; k++) neighbourColors[k] = neighbours[k] < 0 ? 0 : packed[neighbours[k]];
  const topology = { neighbours, colors, neighbourColors };
  byKey.set(`${vary}|${seed}`, topology);
  return topology;
}

/**
 * A column `width` wide, its rounded-square section (radius `corner`) rounded over at the top by `bevel`, as an offset
 * surface: every ring shares the corner centres. Vertices at y ≥ −0.5 are its top, raised by its height in the shader;
 * the rest is a skirt underground at y = −1, so a column never shows a base.
 */
function columnGeometry(width: number, corner: number, bevel: number) {
  const a = width / 2, rc = Math.min(corner, a), rb = Math.min(bevel, rc);
  const CORNER = 3, BEVEL = 3, ring = 4 * (CORNER + 1);
  const position: number[] = [], normal: number[] = [], index: number[] = [];
  const addRing = (y: number, radius: number, theta: number) => {
    for (let q = 0; q < 4; q++) {
      const sx = q === 0 || q === 3 ? 1 : -1, sz = q < 2 ? 1 : -1;
      for (let s = 0; s <= CORNER; s++) {
        const phi = ((q + s / CORNER) * Math.PI) / 2, cx = Math.cos(phi), cz = Math.sin(phi);
        position.push(sx * (a - rc) + radius * cx, y, sz * (a - rc) + radius * cz);
        normal.push(cx * Math.cos(theta), Math.sin(theta), cz * Math.cos(theta));
      }
    }
  };
  addRing(-1, rc, 0);
  addRing(-rb, rc, 0);
  for (let b = 1; b <= BEVEL; b++) {
    const theta = ((b / BEVEL) * Math.PI) / 2;
    addRing(-rb + rb * Math.sin(theta), rc - rb + rb * Math.cos(theta), theta);
  }
  const rings = 2 + BEVEL;
  for (let r = 0; r + 1 < rings; r++) {
    for (let k = 0; k < ring; k++) {
      const a0 = r * ring + k, a1 = r * ring + ((k + 1) % ring);
      index.push(a0, a1 + ring, a1, a0, a0 + ring, a1 + ring);
    }
  }
  const centre = position.length / 3, last = (rings - 1) * ring;
  position.push(0, 0, 0);
  normal.push(0, 1, 0);
  for (let k = 0; k < ring; k++) index.push(centre, last + ((k + 1) % ring), last + k);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setIndex(index);
  return geometry;
}

const COLUMN_RAISE = /* glsl */ 'transformed.y += step( -0.5, transformed.y ) * columnHeight;';

// The neighbour data is flat: an interpolated packed colour could land an ulp off and unpack to another colour.
const COLUMN_VERTEX_HEAD = /* glsl */ `
attribute float columnHeight;
attribute vec4 columnNeighbourHeights;
attribute vec4 columnNeighbourColors;
varying float vColumnY;
flat varying vec4 vColumnNeighbourHeights;
flat varying vec4 vColumnNeighbourColors;
`;

const COLUMN_VERTEX_PASS = /* glsl */ `
vColumnY = transformed.y;
vColumnNeighbourHeights = columnNeighbourHeights;
vColumnNeighbourColors = columnNeighbourColors;
`;

const COLUMN_FRAGMENT_HEAD = /* glsl */ `
uniform float columnAo;
uniform float columnBleed;
uniform float columnGap;
varying float vColumnY;
flat varying vec4 vColumnNeighbourHeights;
flat varying vec4 vColumnNeighbourColors;
vec3 columnUnpack( float p ) {
	float r = floor( p / 65536.0 );
	float g = floor( ( p - r * 65536.0 ) / 256.0 );
	return vec3( r, g, p - r * 65536.0 - g * 256.0 ) / 255.0;
}
`;

// A face across the gap from a taller neighbour loses the share of sky it hides (the sine of the angle up to its
// top), plus half the others' share, and more near the ground. That neighbour bounces that share of the ambient light
// back in its own colour, so a gap is never lit brighter than its stage.
const COLUMN_OCCLUSION = /* glsl */ `
{
	// Instances only move, so world normals are the grid's axes.
	vec3 cn = normalize( vColumnWorldNormal );
	vec4 facing = max( vec4( cn.x, - cn.x, cn.z, - cn.z ), 0.0 );
	float sides = max( dot( facing, vec4( 1.0 ) ), 1e-3 );
	vec4 rise = max( vColumnNeighbourHeights - vColumnY, 0.0 );
	vec4 hidden = rise * inversesqrt( rise * rise + columnGap * columnGap );
	float upright = clamp( 1.0 - cn.y, 0.0, 1.0 );
	float front = dot( facing, hidden ) / sides, around = 0.25 * dot( hidden, vec4( 1.0 ) );
	float open = mix( 1.0 - 0.25 * around, ( 1.0 - front ) * ( 1.0 - 0.5 * around ) * ( 1.0 - 0.5 * exp( -3.0 * vColumnY ) ), upright );
	float occlusion = clamp( columnAo * ( 1.0 - open ), 0.0, 0.95 );
	vec3 bounce = facing.x * hidden.x * columnUnpack( vColumnNeighbourColors.x ) + facing.y * hidden.y * columnUnpack( vColumnNeighbourColors.y )
		+ facing.z * hidden.z * columnUnpack( vColumnNeighbourColors.z ) + facing.w * hidden.w * columnUnpack( vColumnNeighbourColors.w );
	reflectedLight.indirectDiffuse *= 1.0 - occlusion + columnBleed * bounce / sides;
	reflectedLight.indirectSpecular *= 1.0 - occlusion;
	reflectedLight.directDiffuse *= 1.0 - 0.4 * occlusion;
}
`;

function columnMaterial(column: { width: number; roughness: number; ao: number; bleed: number }, environment: THREE.Texture | null, reflect: number, ballShadow: BallShadowUniforms) {
  const material = new THREE.MeshStandardMaterial({ roughness: column.roughness, metalness: 0, envMap: environment, envMapIntensity: reflect });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { columnAo: { value: column.ao }, columnBleed: { value: column.bleed }, columnGap: { value: 1 - column.width } });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${COLUMN_VERTEX_HEAD}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${COLUMN_RAISE}\n${COLUMN_VERTEX_PASS}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${COLUMN_FRAGMENT_HEAD}`).replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${COLUMN_OCCLUSION}`);
    patchBallShadow(shader, ballShadow);
  };
  material.customProgramCacheKey = () => 'column-field-column';
  return material;
}

function floorMaterial(color: string, environment: THREE.Texture | null, reflect: number, ballShadow: BallShadowUniforms) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.92, envMap: environment, envMapIntensity: reflect });
  material.onBeforeCompile = (shader) => patchBallShadow(shader, ballShadow);
  material.customProgramCacheKey = () => 'column-field-floor';
  return material;
}

/** The ball (world centre, radius; 0 for none) and the pool's lamp (world centre, radius), set every exposure. */
type BallShadowUniforms = { columnBall: { value: THREE.Vector4 }; columnLamp: { value: THREE.Vector4 } };

const WORLD_VERTEX_HEAD = /* glsl */ `
varying vec3 vColumnWorld;
varying vec3 vColumnWorldNormal;
`;

const WORLD_VERTEX_PASS = /* glsl */ `
vec4 columnWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
columnWorld = instanceMatrix * columnWorld;
#endif
vColumnWorld = ( modelMatrix * columnWorld ).xyz;
vColumnWorldNormal = mat3( modelMatrix ) * objectNormal;
`;

// Angles as seen from the shaded point: the lamp and the ball are discs on its sky, and the ball hides their overlap.
// The occlusion is a sphere's cosine-weighted share of the sky (Quilez's analytic sphere occlusion).
const BALL_FRAGMENT_HEAD = /* glsl */ `
uniform vec4 columnBall;
uniform vec4 columnLamp;
varying vec3 vColumnWorld;
varying vec3 vColumnWorldNormal;
float columnDiscOverlap( float r1, float r2, float d ) {
	if ( d >= r1 + r2 ) return 0.0;
	float r = min( r1, r2 );
	if ( d <= abs( r1 - r2 ) ) return PI * r * r;
	float a = r1 * r1 * acos( clamp( ( d * d + r1 * r1 - r2 * r2 ) / ( 2.0 * d * r1 ), -1.0, 1.0 ) );
	float b = r2 * r2 * acos( clamp( ( d * d + r2 * r2 - r1 * r1 ) / ( 2.0 * d * r2 ), -1.0, 1.0 ) );
	return a + b - 0.5 * sqrt( max( ( r1 + r2 - d ) * ( d + r1 - r2 ) * ( d - r1 + r2 ) * ( d + r1 + r2 ), 0.0 ) );
}
float columnBallShadow( vec3 p ) {
	if ( columnBall.w <= 0.0 ) return 1.0;
	vec3 toBall = columnBall.xyz - p, toLamp = columnLamp.xyz - p;
	float db = length( toBall ), dl = length( toLamp );
	if ( db <= columnBall.w ) return 0.0;
	float ball = asin( columnBall.w / db ), lamp = asin( min( columnLamp.w / dl, 1.0 ) );
	float apart = acos( clamp( dot( toBall, toLamp ) / ( db * dl ), -1.0, 1.0 ) );
	return 1.0 - columnDiscOverlap( lamp, ball, apart ) / ( PI * lamp * lamp );
}
float columnBallOcclusion( vec3 p, vec3 n ) {
	if ( columnBall.w <= 0.0 ) return 1.0;
	vec3 toBall = columnBall.xyz - p;
	float d = length( toBall );
	return 1.0 - max( dot( n, toBall / d ), 0.0 ) * min( columnBall.w * columnBall.w / ( d * d ), 1.0 );
}
`;

const BALL_OCCLUSION = /* glsl */ `
{
	float ballOcclusion = columnBallOcclusion( vColumnWorld, normalize( vColumnWorldNormal ) );
	reflectedLight.indirectDiffuse *= ballOcclusion;
	reflectedLight.indirectSpecular *= ballOcclusion;
}
`;

// The pool is the scene's one spot light; the ball's shadow darkens only its light.
const SPOT_LIGHT_ANCHOR = 'getSpotLightInfo( spotLight, geometryPosition, directLight );';
const LIGHTS_WITH_BALL_SHADOW = THREE.ShaderChunk.lights_fragment_begin.replace(SPOT_LIGHT_ANCHOR, `${SPOT_LIGHT_ANCHOR}\n\t\tdirectLight.color *= columnBallShadow( vColumnWorld );`);

function patchBallShadow(shader: THREE.WebGLProgramParametersWithUniforms, uniforms: BallShadowUniforms) {
  if (!THREE.ShaderChunk.lights_fragment_begin.includes(SPOT_LIGHT_ANCHOR)) throw new Error('column field: three\'s spot-light loop changed, so the ball\'s shadow has nowhere to go');
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WORLD_VERTEX_HEAD}`).replace('#include <project_vertex>', `${WORLD_VERTEX_PASS}\n#include <project_vertex>`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${BALL_FRAGMENT_HEAD}`)
    .replace('#include <lights_fragment_begin>', LIGHTS_WITH_BALL_SHADOW)
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${BALL_OCCLUSION}`);
}

/** The shadow pass's material, raising the tops as the columns' own does: three draws a custom depth material as is. */
function columnDepthMaterial() {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float columnHeight;').replace('#include <begin_vertex>', `#include <begin_vertex>\n${COLUMN_RAISE}`);
  };
  material.customProgramCacheKey = () => 'column-field-depth';
  return material;
}

function ballMaterial(kind: NonNullable<ColumnBall['material']>, environment: THREE.Texture | null): THREE.Material {
  if (typeof kind === 'function') return kind(environment);
  if (kind === 'chrome') return new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 1, roughness: 0.05, envMap: environment });
  if (kind === 'titanium') return titaniumMaterial(environment);
  return new THREE.MeshPhysicalMaterial({ color: '#e8461f', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMap: environment });
}

/**
 * Anodized titanium: grey metal under a 75–105 nm oxide film, whose interference colours it blue, violet where the
 * film thins and toward the rim, where light crosses it slanting. Satin, so the overhead softbox spreads over its crown
 * rather than burning white; the clear coat keeps a hard glint. The film's slow bands show the ball's turn.
 */
function titaniumMaterial(environment: THREE.Texture | null) {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const k = 0.5 + 0.4 * Math.sin(2 * Math.PI * (v + 0.08 * Math.sin(2 * Math.PI * u)));
      data.set([0, Math.round(clamp(k) * 255), 0, 255], 4 * (y * size + x));
    }
  }
  const film = new THREE.DataTexture(data, size, size);
  film.wrapS = film.wrapT = THREE.RepeatWrapping;
  Object.assign(film, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, needsUpdate: true });
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.62, 0.58, 0.55, THREE.LinearSRGBColorSpace), metalness: 1, roughness: 0.35,
    iridescence: 1, iridescenceIOR: 2.2, iridescenceThicknessRange: [75, 105], iridescenceThicknessMap: film,
    clearcoat: 0.5, clearcoatRoughness: 0.05, envMap: environment, envMapIntensity: 2.2,
  });
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
