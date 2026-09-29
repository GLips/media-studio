// column-field.ts: the cube field's spec and its columns' heights: the reference's churn as value noise, the rise
// from tiles, a disc of cells, and the point on a column's top that the ball lands on and HUD marks aim at.

import type { Material, Matrix4, Texture, Vector3 } from 'three';
import { clamp, lerp, motionCurves, type EaseFn } from '#lib/picture/motion/models/motion.ts';
import { hashRandom } from '#lib/picture/motion/models/random.ts';
import type { Vec3 } from '#lib/picture/camera/models/vec3.ts';

/** A column: its place on the grid (i across, j down the overhead frame, a pitch apart) and its colour. */
export type ColumnCell = { i: number; j: number; color: string };

/**
 * An orbit camera, in pitches and degrees: `elevation` above the ground (90 looks straight down), `azimuth` round the
 * target (0 looks from +z, the bottom of the overhead frame; negative circles clockwise seen from above), vertical `fov`.
 */
export type ColumnCameraPose = { target: Vec3; distance: number; elevation: number; azimuth: number; fov: number };

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
  position: Vector3; forward: Vector3; right: Vector3; up: Vector3;
  fov: number; target: Vector3; crane: number; whip: number;
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
  enter?: { from: Vec3; duration: number };
  launch?: Vec3;
  /** Seconds it stays on a top while it squashes: the reference's squash peaks 25 ms in and is gone by 70. */
  contact?: number;
  /** How far it stretches along its path at 50 pitch/s (0.12). */
  stretch?: number;
  /** 'gloss' is the reference's orange-red plastic; 'titanium' is anodized, blue going violet at the rim. */
  material?: 'gloss' | 'chrome' | 'titanium' | ((environment: Texture | null) => Material);
  /** Also cast the key's shadow, long under a raking key. Off, its only shadow is the pool's, straight down. */
  keyShadow?: boolean;
};

/** Where the ball is: its centre, the matrix that places, squashes, stretches and rolls it, and how squashed it is. */
export type ColumnBallState = { position: Vector3; velocity: Vector3; matrix: Matrix4; squash: number; radius: number };

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
  offset?: Vec3;
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
export function cellIndex(cells: readonly ColumnCell[]) {
  let index = cellIndexes.get(cells);
  if (!index) cellIndexes.set(cells, (index = new Map(cells.map((c, k) => [`${c.i},${c.j}`, k]))));
  return index;
}
function cellAt<C extends ColumnCell>(cells: readonly C[], i: number, j: number): C | undefined {
  const k = cellIndex(cells).get(`${i},${j}`);
  return k === undefined ? undefined : cells[k];
}

/** The centre of a column's top at t, `lift` pitches above it: the point to hand columnFieldProject for a mark. */
export function columnFieldPoint<C extends ColumnCell>(spec: Pick<ColumnFieldSpec<C>, 'cells' | 'height' | 'rise' | 'seed'>, t: number, cell: readonly [number, number], lift = 0): Vec3 {
  const found = cellAt(spec.cells, cell[0], cell[1]);
  return [cell[0], (found ? columnFieldHeight(spec, found, t) : 0) + lift, cell[1]];
}
