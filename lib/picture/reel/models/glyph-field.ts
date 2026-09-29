// glyph-field.ts: the glyph grid's shapes, lattice, wave fronts, regroup matching, beat punch and implosion settings.
// Every glyph is two perpendicular rounded bars (length L, width w, corner r, turned θ), so the reference's
// in-betweens come from lerping four numbers. glyph-field-frame.ts turns these into a frame's draws.

import type { FrameSize } from '#lib/picture/frame/models/frame.ts';
import type { Point } from '#lib/picture/camera/models/camera.ts';
import type { EaseFn } from '#lib/picture/motion/models/motion.ts';
import { hashRandom } from '#lib/picture/motion/models/random.ts';

const RAD = Math.PI / 180;

// ---------- glyphs ----------

/**
 * One glyph: two perpendicular bars `L` long and `w` wide with corners of radius `r` (clamped to half the thinner
 * side), turned `theta` degrees clockwise. L, w and r are shares of the pitch, so a glyph scales with its lattice.
 */
export type GlyphShape = { L: number; w: number; r: number; theta: number };

/**
 * The reference's resting glyphs, as shares of its 100 px pitch: DOT 44.5 px; PLUS 64 × 19.5 with capsule ends; X is
 * PLUS at 45°; DIAMOND 53.6 px, r 6.8, at 45° (70 px tip to tip); SQUARE 64 px, r 11. Fitted on its full-res frames.
 */
export const GLYPH_SHAPES = {
  dot: { L: 0.445, w: 0.445, r: 0.2225, theta: 0 },
  plus: { L: 0.64, w: 0.195, r: 0.0975, theta: 0 },
  x: { L: 0.64, w: 0.195, r: 0.0975, theta: 45 },
  diamond: { L: 0.536, w: 0.536, r: 0.068, theta: 45 },
  square: { L: 0.64, w: 0.64, r: 0.11, theta: 0 },
} as const satisfies Record<string, GlyphShape>;

/** The reference's colours: its ground, cream glyphs, the blue of the ring wave and the red-orange of newborns and accents. */
export const GLYPH_FIELD_COLORS = { ground: '#101013', cream: '#eae7de', blue: '#3238eb', red: '#e64c23' } as const;

// ---------- layout ----------

export type GlyphLayout = {
  /** Cells per row. Default 19, the reference's. */
  columns?: number;
  /** Rows, when there are no `items` to count. Default 11. */
  rows?: number;
  /** Centre-to-centre spacing in frame px. Default 100 (9.3 % of frame height). */
  pitch?: number;
  /** The lattice's centre in frame px. Default the frame's centre. */
  center?: Point;
  /** Where a short last row sits: centred under the rows above, or from their first column. Default `center`. */
  lastRow?: 'center' | 'start';
};

/** A place in the lattice: `i`, `j` count pitches from its centre, the reference's cell (i, j); x, y are frame px. */
export type GlyphFieldSlot = { index: number; col: number; row: number; i: number; j: number; x: number; y: number };

/** A cell: its place, and the item it shows (null when the field has no `items`). */
export type GlyphCell<D> = GlyphFieldSlot & { item: D };

/**
 * Where `count` cells sit, row by row, on a frame `size` big. Exported so a piece that cuts out of the field (the
 * reference's cube field, which match-cuts from these squares) can take the same places.
 */
export function glyphFieldLayout(count: number, size: FrameSize, layout: GlyphLayout = {}): GlyphFieldSlot[] {
  const { columns = 19, pitch = 100, center = { x: size.width / 2, y: size.height / 2 }, lastRow = 'center' } = layout;
  const rows = Math.ceil(count / columns);
  const slots: GlyphFieldSlot[] = [];
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / columns), col = index % columns;
    const inRow = row === rows - 1 ? count - row * columns : columns;
    const i = col - (lastRow === 'center' ? (inRow - 1) / 2 : (columns - 1) / 2), j = row - (rows - 1) / 2;
    slots.push({ index, col, row, i, j, x: center.x + i * pitch, y: center.y + j * pitch });
  }
  return slots;
}

// ---------- waves ----------

/** Where a front starts and which way it runs. */
export type GlyphFront<D> =
  /** A circle from `from` (frame px; default the lattice's centre), or closing in on it from the farthest cell. */
  | { from?: Point; inward?: boolean }
  /** A straight front travelling toward `angle` degrees (0 right, 90 down), from the first cell it meets. */
  | { angle: number }
  /** Your own: seconds after the wave's start that it reaches each cell. */
  | { delay: (cell: GlyphCell<D>) => number };

/** What a key's value function knows of the wave that brings it. */
export type GlyphHit = {
  /** Seconds since the front reached the cell. */
  since: number;
  /** Pitches the front travelled to reach it: from the origin, the rim (inward) or the first cell (straight). */
  distance: number;
  /** The wave's index in `waves`. */
  wave: number;
};

/**
 * A keyframe: the channel reaches `value` at `at` seconds after the front reaches the cell, eased by `ease` (default
 * linear) from the key before. Before the first key the channel eases out of whatever the cell showed under this
 * wave, so a clip starts from any state. A value can depend on the cell; returning undefined keeps what was under.
 */
export type GlyphKey<V, D> = {
  at: number;
  value: V | ((cell: GlyphCell<D>, hit: GlyphHit) => V | undefined);
  /**
   * The reference's morphs are `backOutEase`s overshooting 0.18 (a dot's birth), 0.095 (dot → plus), 0.11 (plus → X)
   * and 0.05 (diamond → square).
   */
  ease?: EaseFn;
};

/** A key for L, w and r at once: a `GLYPH_SHAPES` entry (its angle is ignored) or any of the three. */
export type GlyphShapeKey = { at: number; value: Partial<GlyphShape>; ease?: EaseFn };

/**
 * A wave's effect on each cell it reaches, as keyframes per channel. `shape` keys L, w and r together (a `GLYPH_SHAPES`
 * entry, minus its angle). `theta` is absolute degrees; `turn` adds degrees to what was under, so it works whatever
 * came before. `scale` multiplies the glyph (a pulse is 1 → 1.3 → 1), `brighten` mixes its fill toward white.
 */
export type GlyphClip<D> = {
  shape?: readonly GlyphShapeKey[];
  L?: readonly GlyphKey<number, D>[];
  w?: readonly GlyphKey<number, D>[];
  r?: readonly GlyphKey<number, D>[];
  theta?: readonly GlyphKey<number, D>[];
  turn?: readonly GlyphKey<number, D>[];
  fill?: readonly GlyphKey<string, D>[];
  scale?: readonly GlyphKey<number, D>[];
  opacity?: readonly GlyphKey<number, D>[];
  brighten?: readonly GlyphKey<number, D>[];
};

/**
 * A front crossing the lattice and the clip it plays on each cell it reaches. Arrivals are continuous (never rounded
 * to frames), so a ring stays round at 30 fps. The reference's fronts: 26.4 pitches/s for the reveal, 19.1 for the
 * blue ring, 24.2 along the diagonal, 51.7 closing in.
 */
export type GlyphWave<D> = {
  /** Seconds (the piece's clock) the front leaves its origin, or meets its first cell. */
  start: number;
  /** Default: a circle from the lattice's centre. */
  front?: GlyphFront<D>;
  /** Pitches per second the front travels. Default 20. */
  speed?: number;
  /** Seconds per pitch instead of `speed`, if you think in delays. */
  perCell?: number;
  /** Up to this many seconds more before it reaches each cell, seeded per cell: a ragged front. Default 0. */
  jitter?: number;
  /** Only these cells play the clip. */
  where?: (cell: GlyphCell<D>) => boolean;
  clip: GlyphClip<D>;
};

/**
 * When `wave`'s front reaches each cell (seconds, Infinity where `where` leaves it out) and how far it travelled
 * there, in pitches. Fronts run over the cells' home places, not where a regroup has moved them.
 */
export function glyphWaveArrivals<D>(wave: GlyphWave<D>, cells: readonly GlyphCell<D>[], { pitch = 100, center, seed = 'glyph-field', index = 0 }: { pitch?: number; center: Point; seed?: number | string; index?: number }): { at: number[]; distance: number[] } {
  const speed = wave.perCell ? 1 / wave.perCell : (wave.speed ?? 20);
  const front = wave.front ?? {};
  const inWave = cells.map((cell) => wave.where?.(cell) ?? true);
  let distance: number[];
  if ('delay' in front) distance = cells.map((cell) => front.delay(cell) * speed);
  else if ('angle' in front) {
    const dx = Math.cos(front.angle * RAD), dy = Math.sin(front.angle * RAD);
    const along = cells.map((cell) => (cell.x * dx + cell.y * dy) / pitch);
    const first = Math.min(...along.filter((_, k) => inWave[k]));
    distance = along.map((a) => a - first);
  } else {
    const from = front.from ?? center;
    const out = cells.map((cell) => Math.hypot(cell.x - from.x, cell.y - from.y) / pitch);
    const rim = Math.max(...out.filter((_, k) => inWave[k]));
    distance = front.inward ? out.map((d) => rim - d) : out;
  }
  const at = cells.map((cell, k) => {
    if (!inWave[k]) return Infinity;
    const jitter = wave.jitter ? wave.jitter * hashRandom(seed, 'jitter', index, cell.index) : 0;
    return wave.start + distance[k] / speed + jitter;
  });
  return { at, distance };
}

// ---------- filter and regroup ----------

/**
 * A packed block for the cells a filter keeps: `columns` (default about 1.8:1 for the count), `pitch` (default the
 * field's), centred on `center` (default the field's), a short last row placed as `lastRow` says.
 */
export type GlyphRegroup = GlyphLayout;

/**
 * From `at` on, only cells passing `keep` show (leave it out to bring every cell back); the rest shrink away. With
 * `regroup`, the kept cells fly into a packed block; without it they go home.
 */
export type GlyphFilterStep<D> = { at: number; keep?: (cell: GlyphCell<D>) => boolean; regroup?: GlyphRegroup | boolean };

export type GlyphFilterTiming = {
  /** Seconds a dropped cell takes to shrink away, after a small swell. Default 0.26. */
  exit?: number;
  /** Seconds a returning cell takes to pop back. Default 0.3. */
  enter?: number;
  /** Seconds over which drops and returns scatter, in a seeded order. Default 0.2. */
  spread?: number;
  /** Seconds a cell takes to reach a new place, on `moveEase` (default expo entrance). Default 0.5. */
  move?: number;
  /** Seconds from the first mover (the shortest path) to the last. Default 0.12. */
  moveSpread?: number;
  moveEase?: EaseFn;
};

/**
 * Which slot each of `from` takes (`slot[k]` indexes `to`) and when it leaves (`delay`, 0 to `spread` seconds,
 * shortest paths first). The assignment minimises total path length, and a shortest matching never crosses two
 * paths: swapping a crossed pair's ends would shorten their sum.
 */
export function glyphRegroupPlan(from: readonly Point[], to: readonly Point[], spread: number): { slot: number[]; delay: number[] } {
  const cost = from.map((a) => to.map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
  const slot = minCostAssignment(cost);
  const length = from.map((_, k) => cost[k][slot[k]]);
  const byLength = from.map((_, k) => k).sort((a, b) => length[a] - length[b] || a - b);
  const delay = new Array<number>(from.length).fill(0);
  byLength.forEach((k, rank) => { delay[k] = from.length > 1 ? (spread * rank) / (from.length - 1) : 0; });
  return { slot, delay };
}

/** The Hungarian algorithm (Kuhn–Munkres with potentials), O(n³): row k's column in a least-cost assignment. */
function minCostAssignment(cost: readonly (readonly number[])[]): number[] {
  const n = cost.length;
  const u = new Float64Array(n + 1), v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1), way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const assign = new Array<number>(n);
  for (let j = 1; j <= n; j++) assign[p[j] - 1] = j - 1;
  return assign;
}

// ---------- punch and implosion ----------

/** The field's hit on the beat: it scales about its centre by 1 + amount, decaying with time constant `tau`. */
export type GlyphPunch = {
  /** Seconds (the piece's clock) of each hit. Put them on frames, or the peak never renders. */
  beats: readonly number[];
  /** Default 0.031, the reference's 3.1 %. */
  amount?: number;
  /** Seconds. Default 0.11 (6.6 frames at 60 fps). */
  tau?: number;
};

/** The punch's scale at `t`: 1 + Σ amount·e^(−(t − beat)/tau) over the beats already hit. For layers that punch with the field. */
export function glyphPunchScale(t: number, punch: GlyphPunch | undefined): number {
  if (!punch) return 1;
  const { amount = 0.031, tau = 0.11 } = punch;
  let k = 1;
  for (const b of punch.beats) if (t >= b) k += amount * Math.exp(-(t - b) / tau);
  return k;
}

/**
 * The field collapsing into a point along a spiral, as the reference's section 07 ends: each glyph's scale and distance
 * 1 − x², turning with the field. The reference: 4 frames at 60 fps, −30° (−38° at the rim). Its red plus is the
 * centre cell gone red; `marker` leaves one after the field has gone.
 */
export type GlyphImplode = {
  /** Seconds (the piece's clock) the collapse starts. Put start + duration on the beat to land it there. */
  start: number;
  /** Seconds. Default 4/60. */
  duration?: number;
  /** The point, frame px. Default the lattice's centre. */
  to?: Point;
  /** Degrees the whole field turns by the end (negative is counter-clockwise). Default −30. */
  turn?: number;
  /** Degrees more at the rim than at the point, which bends the collapse into a spiral. Default −8. */
  twist?: number;
  /** The plus left at the point, fading in from a third of the way. Default red, 22 px (2 % of frame height); `false` for none. */
  marker?: { color?: string; size?: number } | false;
};
