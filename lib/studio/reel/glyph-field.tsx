// glyph-field.tsx: the reference reel's generative grid (its section 03, and the implosion that closes section 07): a
// lattice of glyphs morphing between dot, plus, X, diamond and square as waves cross it. Every glyph is one drawing,
// two perpendicular rounded bars (length L, width w, corner r, turned θ, one fill), so the reference's in-betweens
// (squircle, quatrefoil, notched octagon) come from lerping four numbers. Waves carry keyframe clips out from a point,
// along a straight front or on delays of your own; a filter shrinks cells away and packs the survivors; the field
// punches on beats and can implode into a point. One canvas draws it, so hundreds of cells cost one DOM node.

import { useId, useLayoutEffect, useRef } from 'react';
import { FPS, H, W } from '#models/frame/frame.ts';
import { backOutEase, clamp, lerp, motionCurves, type EaseFn } from '#models/motion/motion.ts';
import { pieceMotionAttrs, unmeasuredAttrs } from '../motion-tag.ts';
import { hashRandom } from '#models/motion/random.ts';

/** One frame of the reference reel (60 fps): the unit its timings were measured in. */
const REF_F = 1 / 60;
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

// ---------- colour ----------

/** A colour as the canvas mixes it: gamma-encoded sRGB channels 0–255 and alpha 0–1. */
type Rgba = readonly [number, number, number, number];

const colorCache = new Map<string, Rgba>();

/**
 * Reads a CSS colour (hex, `rgb()`, `hsl()` or `oklch()`) into sRGB, so fills can be tweened: in gamma space, as the
 * reference's cream-to-blue tweens pass through its lavender. `oklch()` outside sRGB is clipped per channel, as the
 * browser draws it.
 */
export function parseGlyphColor(css: string): Rgba {
  const hit = colorCache.get(css);
  if (hit) return hit;
  const parsed = parseColorUncached(css.trim().toLowerCase());
  if (!parsed) throw new Error(`GlyphField: can't read the colour "${css}" (use hex, rgb(), hsl() or oklch())`);
  colorCache.set(css, parsed);
  return parsed;
}

function parseColorUncached(css: string): Rgba | null {
  if (css === 'transparent') return [0, 0, 0, 0];
  if (css === 'white') return [255, 255, 255, 1];
  if (css === 'black') return [0, 0, 0, 1];
  if (css.startsWith('#')) {
    const hex = css.slice(1);
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(full)) return null;
    const n = (k: number) => parseInt(full.slice(k, k + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
  }
  const m = /^(rgba?|hsla?|oklch)\((.*)\)$/.exec(css);
  if (!m) return null;
  const args = m[2].split(/[\s,/]+/).filter(Boolean);
  const num = (s: string | undefined, percentOf = 1, fallback = NaN) =>
    s === undefined ? fallback : s.endsWith('%') ? (parseFloat(s) / 100) * percentOf : parseFloat(s);
  const alpha = num(args[3], 1, 1);
  if (m[1].startsWith('rgb')) return [num(args[0], 255), num(args[1], 255), num(args[2], 255), alpha];
  const hue = parseFloat(m[1] === 'oklch' ? args[2] : args[0]);
  if (m[1].startsWith('hsl')) {
    const h = ((hue % 360) + 360) % 360, s = num(args[1], 1), l = num(args[2], 1);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    };
    return [f(0), f(8), f(4), alpha];
  }
  return oklchToRgba(num(args[0], 1), num(args[1], 0.4), hue, alpha);
}

function oklchToRgba(L: number, C: number, hue: number, alpha: number): Rgba {
  const a = C * Math.cos(hue * RAD), b = C * Math.sin(hue * RAD);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (x: number) => {
    const c = clamp(x);
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  };
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha,
  ];
}

const mixRgba = (a: Rgba, b: Rgba, k: number): Rgba => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)];
const WHITE: Rgba = [255, 255, 255, 1];
const cssOf = (c: Rgba) => `rgba(${Math.round(clamp(c[0], 0, 255))},${Math.round(clamp(c[1], 0, 255))},${Math.round(clamp(c[2], 0, 255))},${clamp(c[3]).toFixed(3)})`;

// ---------- layout ----------

type Point = { x: number; y: number };

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
 * Where `count` cells sit, row by row. Exported so a piece that cuts out of the field (the reference's cube field,
 * which match-cuts from these squares) can take the same places.
 */
export function glyphFieldLayout(count: number, layout: GlyphLayout = {}): GlyphFieldSlot[] {
  const { columns = 19, pitch = 100, center = { x: W / 2, y: H / 2 }, lastRow = 'center' } = layout;
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
export function glyphWaveArrivals<D>(wave: GlyphWave<D>, cells: readonly GlyphCell<D>[], { pitch = 100, center = { x: W / 2, y: H / 2 }, seed = 'glyph-field', index = 0 }: { pitch?: number; center?: Point; seed?: number | string; index?: number } = {}): { at: number[]; distance: number[] } {
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

// A plan is O(n³) and the same on every frame of a step: keep it per step's inputs.
const planCache = new Map<string, { slot: number[]; delay: number[] }>();
function cachedRegroupPlan(from: readonly Point[], to: readonly Point[], spread: number) {
  const key = `${spread}|${from.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';')}|${to.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';')}`;
  let plan = planCache.get(key);
  if (!plan) planCache.set(key, (plan = glyphRegroupPlan(from, to, spread)));
  return plan;
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

// ---------- the field ----------

/** A cell's look before any wave reaches it. Default: a cream dot. */
export type GlyphRest = Partial<GlyphShape & { fill: string; scale: number; opacity: number; brighten: number }>;

export type GlyphFieldProps<D = null> = {
  /** Seconds since the piece starts. */
  t: number;
  /** One per cell, laid out row by row; key values read them as `cell.item`. Default: `columns × rows` cells, no items. */
  items?: readonly D[];
  layout?: GlyphLayout;
  rest?: GlyphRest | ((cell: GlyphCell<D>) => GlyphRest);
  /** Folded in order of `start`: a later wave's keys ease out of what the earlier ones left, and its last keys win. */
  waves?: readonly GlyphWave<D>[];
  filter?: readonly GlyphFilterStep<D>[];
  filterTiming?: GlyphFilterTiming;
  punch?: GlyphPunch;
  implode?: GlyphImplode;
  /**
   * Motion blur, as a share of a frame the shutter stays open (0.5, a 180° shutter): a glyph moving more than a few px
   * in it is drawn smeared along its path. 0 for none. At 30 fps a regroup or the implosion strobes without it.
   */
  shutter?: number;
  /** Seeds the scatter of filter drops and wave jitter. */
  seed?: number | string;
  motion?: string | false;
};

type CellState = { L: number; w: number; r: number; theta: number; fill: Rgba; scale: number; opacity: number; brighten: number };
type NumberChannel = 'L' | 'w' | 'r' | 'theta' | 'scale' | 'opacity' | 'brighten' | 'turn';
// `turn` goes last: it adds to the angle after any absolute `theta` keys have set it.
const NUMBER_CHANNELS: readonly NumberChannel[] = ['L', 'w', 'r', 'theta', 'scale', 'opacity', 'brighten', 'turn'];

type ValueFn<V, D> = (cell: GlyphCell<D>, hit: GlyphHit) => V | undefined;
type ClipPlan<D> = { numbers: [NumberChannel, GlyphKey<number, D>[]][]; fill: GlyphKey<string, D>[] | null };

function planClip<D>(clip: GlyphClip<D>): ClipPlan<D> {
  const channels = new Map<NumberChannel, GlyphKey<number, D>[]>();
  for (const ch of NUMBER_CHANNELS) if (clip[ch]) channels.set(ch, [...clip[ch]]);
  for (const key of clip.shape ?? []) {
    for (const ch of ['L', 'w', 'r'] as const) {
      const value = key.value[ch];
      if (value === undefined) continue;
      if (!channels.has(ch)) channels.set(ch, []);
      channels.get(ch)!.push({ at: key.at, value, ease: key.ease });
    }
  }
  const numbers = NUMBER_CHANNELS.filter((ch) => channels.has(ch)).map((ch): [NumberChannel, GlyphKey<number, D>[]] => [ch, channels.get(ch)!.sort((a, b) => a.at - b.at)]);
  return { numbers, fill: clip.fill ? [...clip.fill].sort((a, b) => a.at - b.at) : null };
}

const linear: EaseFn = (k) => k;

function keyframeAt<V, R, D>(keys: readonly GlyphKey<V, D>[], c: number, under: R, read: (v: V) => R, mix: (a: R, b: R, k: number) => R, cell: GlyphCell<D>, hit: GlyphHit): R {
  let prevAt = 0, prev = under;
  for (const key of keys) {
    const raw = typeof key.value === 'function' ? (key.value as ValueFn<V, D>)(cell, hit) : key.value;
    const value = raw === undefined ? under : read(raw);
    if (c < key.at) return mix(prev, value, (key.ease ?? linear)((c - prevAt) / (key.at - prevAt)));
    prevAt = key.at;
    prev = value;
  }
  return prev;
}

const same = <V,>(v: V) => v;

function playClip<D>(under: CellState, clip: ClipPlan<D>, cell: GlyphCell<D>, hit: GlyphHit): CellState {
  const next = { ...under };
  for (const [ch, keys] of clip.numbers) {
    if (ch === 'turn') next.theta += keyframeAt(keys, hit.since, 0, same, lerp, cell, hit);
    else next[ch] = keyframeAt(keys, hit.since, under[ch], same, lerp, cell, hit);
  }
  if (clip.fill) next.fill = keyframeAt(clip.fill, hit.since, under.fill, parseGlyphColor, mixRgba, cell, hit);
  return next;
}

type StepPlan = { at: number; keep: boolean[]; tx: number[]; ty: number[]; moveDelay: number[]; showDelay: number[]; moves: boolean };

type FieldModel<D> = {
  cells: GlyphCell<D>[];
  pitch: number;
  center: Point;
  rest: CellState[];
  waves: { clip: ClipPlan<D>; at: number[]; distance: number[]; index: number }[];
  steps: StepPlan[];
  timing: Required<GlyphFilterTiming>;
  punch: GlyphPunch | undefined;
  implode: (Required<Omit<GlyphImplode, 'marker'>> & { marker: { color: string; size: number } | false; reach: number }) | null;
  shutter: number;
};

function restState(rest: GlyphRest): CellState {
  const { fill = GLYPH_FIELD_COLORS.cream, scale = 1, opacity = 1, brighten = 0, ...shape } = rest;
  return { ...GLYPH_SHAPES.dot, ...shape, fill: parseGlyphColor(fill), scale, opacity, brighten };
}

function buildModel<D>(props: GlyphFieldProps<D>): FieldModel<D> {
  const { items, layout = {}, rest, waves = [], filter = [], filterTiming = {}, punch, implode, shutter = 0.5, seed = 'glyph-field' } = props;
  const pitch = layout.pitch ?? 100, center = layout.center ?? { x: W / 2, y: H / 2 };
  const count = items ? items.length : (layout.columns ?? 19) * (layout.rows ?? 11);
  const cells = glyphFieldLayout(count, layout).map((slot) => ({ ...slot, item: (items ? items[slot.index] : null) as D }));
  const restOf = typeof rest === 'function' ? rest : () => rest ?? {};
  const timing: Required<GlyphFilterTiming> = { exit: 0.26, enter: 0.3, spread: 0.2, move: 0.5, moveSpread: 0.12, moveEase: motionCurves.expo.entrance, ...filterTiming };

  const order = waves.map((_, k) => k).sort((a, b) => waves[a].start - waves[b].start || a - b);
  const planned = order.map((k) => ({ clip: planClip(waves[k].clip), ...glyphWaveArrivals(waves[k], cells, { pitch, center, seed, index: k }), index: k }));

  const steps: StepPlan[] = [];
  let prevX = cells.map((c) => c.x), prevY = cells.map((c) => c.y);
  [...filter].sort((a, b) => a.at - b.at).forEach((step, k) => {
    const keep = cells.map((cell) => step.keep?.(cell) ?? true);
    const tx = [...prevX], ty = [...prevY];
    const moveDelay = new Array<number>(cells.length).fill(0);
    const kept = cells.filter((_, n) => keep[n]).map((c) => c.index);
    if (step.regroup) {
      const block = step.regroup === true ? {} : step.regroup;
      const slots = glyphFieldLayout(kept.length, { pitch, center, columns: Math.max(1, Math.round(Math.sqrt(kept.length * 1.8))), ...block });
      const plan = cachedRegroupPlan(kept.map((n) => ({ x: prevX[n], y: prevY[n] })), slots, timing.moveSpread);
      kept.forEach((n, q) => { tx[n] = slots[plan.slot[q]].x; ty[n] = slots[plan.slot[q]].y; moveDelay[n] = plan.delay[q]; });
    } else {
      for (const n of kept) { tx[n] = cells[n].x; ty[n] = cells[n].y; }
      const byLength = kept.map((n) => [n, Math.hypot(tx[n] - prevX[n], ty[n] - prevY[n])] as const).filter(([, d]) => d > 0).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      byLength.forEach(([n], rank) => { moveDelay[n] = byLength.length > 1 ? (timing.moveSpread * rank) / (byLength.length - 1) : 0; });
    }
    const moves = kept.some((n) => tx[n] !== prevX[n] || ty[n] !== prevY[n]);
    const showDelay = cells.map((c) => timing.spread * hashRandom(seed, 'filter', k, c.index));
    steps.push({ at: step.at, keep, tx, ty, moveDelay, showDelay, moves });
    prevX = tx;
    prevY = ty;
  });

  let implodeModel: FieldModel<D>['implode'] = null;
  if (implode) {
    const to = implode.to ?? center;
    const reach = Math.max(1, ...cells.map((c) => Math.hypot(c.x - to.x, c.y - to.y)));
    const marker = implode.marker === false ? false : { color: GLYPH_FIELD_COLORS.red, size: 22, ...implode.marker };
    implodeModel = { start: implode.start, duration: implode.duration ?? 4 * REF_F, to, turn: implode.turn ?? -30, twist: implode.twist ?? -8, marker, reach };
  }

  return { cells, pitch, center, rest: cells.map((c) => restState(restOf(c))), waves: planned, steps, timing, punch, implode: implodeModel, shutter };
}

function waveStateAt<D>(model: FieldModel<D>, n: number, t: number): CellState {
  const cell = model.cells[n];
  let state = model.rest[n];
  for (const wave of model.waves) {
    const at = wave.at[n];
    if (!(t >= at)) continue;
    state = playClip(state, wave.clip, cell, { since: t - at, distance: wave.distance[n], wave: wave.index });
  }
  return state;
}

/**
 * How much brighter than an even share of its ink a long smear is drawn, at most: a streak up to 3 glyphs long keeps
 * the glyph's full colour, and longer ones fade. The reference's implosion streaks, 4–5 glyphs long, read at about 60 %
 * of the glyphs' colour, where a true shutter would leave 20–25 %.
 */
const SMEAR_GAIN = 3;

// A drop swells a little before it shrinks (back-in); a return pops past full size and settles (back-out).
const dropEase: EaseFn = (k) => { k = clamp(k); return k * k * (2.7 * k - 1.7); };
const popEase = backOutEase(0.12);

/** Where cell `n` is at `τ` after the filter's steps, and how much of it shows (0 dropped … 1). */
function filterPlaceAt<D>(model: FieldModel<D>, n: number, τ: number) {
  const cell = model.cells[n], { timing } = model;
  let x = cell.x, y = cell.y, show = 1, move = 0;
  for (const step of model.steps) {
    const u = τ - step.at;
    if (u < 0) break;
    const keep = step.keep[n];
    const p = clamp((u - step.showDelay[n]) / (keep ? timing.enter : timing.exit));
    show = keep ? lerp(show, 1, popEase(p)) : lerp(show, 0, dropEase(p));
    if (keep && step.moves) {
      move = clamp((u - step.moveDelay[n]) / timing.move);
      const e = timing.moveEase(move);
      x = lerp(x, step.tx[n], e);
      y = lerp(y, step.ty[n], e);
    }
  }
  return { x, y, show, move };
}

/** How far into the collapse `τ` is (0 before, 1 after) and what that does at a distance `rho` (0 point … 1 rim). */
function implodeAt(implode: NonNullable<FieldModel<unknown>['implode']>, τ: number) {
  const x = clamp((τ - implode.start) / implode.duration);
  return { x, keep: 1 - x * x, angle: (rho: number) => x ** 1.5 * (implode.turn + implode.twist * rho) };
}

/** One placement of a glyph: centre in frame px, px per pitch-unit of its shape, angle in degrees. */
export type GlyphSample = { x: number; y: number; unit: number; theta: number };

/**
 * A glyph as drawn: its shape (shares of the pitch) and fill, and one sample, or several along a smear, each drawn at
 * `alpha` (a smear's add up).
 */
export type GlyphDraw = { index: number; L: number; w: number; r: number; fill: string; alpha: number; samples: GlyphSample[] };

export type GlyphFieldFrame = {
  cells: GlyphDraw[];
  marker: GlyphDraw | null;
  /** The lattice's box under the punch and the collapse: what the motion tag measures. */
  box: { x: number; y: number; w: number; h: number };
  /** The tag's values: waves passed (1 per wave, fractions while a front crosses), share shown, move progress, collapse, punch. */
  values: { wave: number; kept: number; move: number; implode: number; punch: number };
};

/** Everything `GlyphField` draws at `props.t`, as data: a pure function of its props. */
export function glyphFieldFrame<D>(props: GlyphFieldProps<D>): GlyphFieldFrame {
  const model = buildModel(props);
  const { t } = props, { cells, pitch, implode, center } = model;
  const shutter = model.shutter / FPS;

  // The punch is read at t for every sample: it lands hard, as a cut would, and smearing its jump would double-expose
  // the grid (the reference's one such frame is a capture artefact).
  const punch = glyphPunchScale(t, model.punch);
  const placeAt = (n: number, τ: number, state: CellState): GlyphSample & { show: number; move: number } => {
    const f = filterPlaceAt(model, n, τ);
    let x = center.x + (f.x - center.x) * punch, y = center.y + (f.y - center.y) * punch;
    let unit = pitch * state.scale * punch, theta = state.theta;
    if (implode) {
      const im = implodeAt(implode, τ);
      if (im.x > 0) {
        const dx = x - implode.to.x, dy = y - implode.to.y;
        const a = im.angle(Math.hypot(dx, dy) / implode.reach) * RAD, cos = Math.cos(a), sin = Math.sin(a);
        x = implode.to.x + (dx * cos - dy * sin) * im.keep;
        y = implode.to.y + (dx * sin + dy * cos) * im.keep;
        unit *= im.keep;
        theta += a / RAD;
      }
    }
    return { x, y, unit: unit * f.show, theta, show: f.show, move: f.move };
  };

  const draws: GlyphDraw[] = [];
  const lastStep = model.steps.findLast((s) => t >= s.at);
  let shown = 0, moveSum = 0, moving = 0;
  for (let n = 0; n < cells.length; n++) {
    const state = waveStateAt(model, n, t);
    const fill = mixRgba(state.fill, WHITE, clamp(state.brighten));
    const now = placeAt(n, t, state);
    shown += clamp(now.show);
    if (lastStep?.moves && lastStep.keep[n]) { moveSum += now.move; moving++; }
    const reach = Math.max(state.L, state.w);
    let samples: GlyphSample[] = [now], share = 1;
    if (shutter > 0) {
      const then = placeAt(n, t - shutter, state);
      const travel = Math.hypot(now.x - then.x, now.y - then.y) + (Math.abs(now.unit - then.unit) * reach) / 2 + Math.abs(now.theta - then.theta) * RAD * (now.unit * reach) / 2;
      // 12 px in half a frame is 24 px a frame: below that a move reads at 30 fps, and the reference's scale pops and
      // turns stay sharp.
      if (travel > 12) {
        // A sample every 2.5 px of travel, so the steps between them don't show.
        const k = Math.min(160, Math.ceil(travel / 2.5) + 1);
        samples = Array.from({ length: k }, (_, q) => (q === k - 1 ? now : placeAt(n, t - shutter * (1 - q / (k - 1)), state)));
        let gap = Infinity;
        for (let q = 1; q < k; q++) gap = Math.min(gap, Math.hypot(samples[q].x - samples[q - 1].x, samples[q].y - samples[q - 1].y));
        // 1/k each is a true shutter. More, up to SMEAR_GAIN × that, as long as the samples bunched where the glyph
        // moves slowest still add to no more than its colour.
        share = clamp(gap / Math.max(1, reach * Math.max(now.unit, then.unit)), 1 / k, SMEAR_GAIN / k);
      }
    }
    const alpha = clamp(state.opacity) * fill[3] * share;
    samples = samples.filter((s) => s.unit > 0.01);
    if (samples.length && alpha > 0) draws.push({ index: n, L: state.L, w: state.w, r: state.r, fill: cssOf([fill[0], fill[1], fill[2], 1]), alpha, samples: samples.map(({ x, y, unit, theta }) => ({ x, y, unit, theta })) });
  }

  let marker: GlyphDraw | null = null;
  const im = implode ? implodeAt(implode, t) : null;
  if (implode?.marker && im && im.x > 0.35) {
    const size = implode.marker.size;
    marker = { index: -1, L: 1, w: 0.3, r: 0.15, fill: cssOf(parseGlyphColor(implode.marker.color)), alpha: clamp((im.x - 0.35) / 0.25), samples: [{ x: implode.to.x, y: implode.to.y, unit: size, theta: 0 }] };
  }

  const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
  const scaleAbout = (p: Point) => {
    let x = center.x + (p.x - center.x) * punch, y = center.y + (p.y - center.y) * punch;
    if (implode && im) { x = implode.to.x + (x - implode.to.x) * im.keep; y = implode.to.y + (y - implode.to.y) * im.keep; }
    return { x, y };
  };
  const a = scaleAbout({ x: Math.min(...xs) - pitch / 2, y: Math.min(...ys) - pitch / 2 });
  const b = scaleAbout({ x: Math.max(...xs) + pitch / 2, y: Math.max(...ys) + pitch / 2 });
  const wave = model.waves.reduce((sum, w) => {
    const reached = w.at.filter((at) => at !== Infinity);
    return sum + (reached.length ? reached.filter((at) => t >= at).length / reached.length : 0);
  }, 0);

  return {
    cells: draws,
    marker,
    box: { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y },
    values: { wave, kept: cells.length ? shown / cells.length : 0, move: moving ? moveSum / moving : 0, implode: im?.x ?? 0, punch },
  };
}

function traceGlyph(ctx: CanvasRenderingContext2D, g: GlyphDraw, s: GlyphSample) {
  const L = g.L * s.unit, w = g.w * s.unit;
  if (!(L > 0 && w > 0)) return;
  const r = clamp(g.r * s.unit, 0, Math.min(L, w) / 2);
  const a = s.theta * RAD, cos = Math.cos(a), sin = Math.sin(a);
  // The path takes the transform as each shape is added, so both bars share the glyph's turn.
  ctx.setTransform(cos, sin, -sin, cos, s.x, s.y);
  ctx.roundRect(-L / 2, -w / 2, L, w, r);
  ctx.roundRect(-w / 2, -L / 2, w, L, r);
}

function paintGlyphFrame(ctx: CanvasRenderingContext2D, frame: GlyphFieldFrame) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, W, H);
  for (const g of [...frame.cells, ...(frame.marker ? [frame.marker] : [])]) {
    ctx.fillStyle = g.fill;
    // A smear's samples add ('lighter'), each at its share of the glyph (see SMEAR_GAIN). Each is its own path, or
    // the overlaps would merge into one fill.
    ctx.globalCompositeOperation = g.samples.length > 1 ? 'lighter' : 'source-over';
    ctx.globalAlpha = g.alpha;
    for (const s of g.samples) {
      ctx.beginPath();
      traceGlyph(ctx, g, s);
      ctx.fill();
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

/**
 * The glyph grid: a lattice of dots, pluses, X's, diamonds and squares that waves morph, recolour and pulse, a filter
 * thins and packs, the beat punches and an implosion collapses. Defaults are the reference's: 19 × 11 cream dots at
 * 100 px pitch, centred, on a transparent canvas the size of the frame (put a ground under it).
 */
export function GlyphField<D = null>(props: GlyphFieldProps<D>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = glyphFieldFrame(props);
  useLayoutEffect(() => {
    paintGlyphFrame(canvas.current!.getContext('2d')!, frame);
  });
  const { box, values } = frame;
  return (
    <>
      <canvas ref={canvas} width={W} height={H} {...unmeasuredAttrs('glyph field cells')} style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }} />
      <div {...pieceMotionAttrs(props.motion, 'glyph-field', { kind: 'glyph-field', values })} style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, pointerEvents: 'none' }} />
    </>
  );
}

// ---------- flash and shock ring ----------

/**
 * A full-frame flash that peaks at `at` and decays with time constant `tau`, a touch dimmer at the corners (`falloff`).
 * The reference: neutral white at 57 % over black, 13 % dimmer in the corners, τ 2.3 frames at 60 fps, so at 30 fps its
 * frames read 1, 0.42, 0.18, 0.07. Put it over everything, HUD included.
 */
export function FieldFlash({ t, at = 0, peak = 0.57, tau = 2.3 * REF_F, falloff = 0.13, color = '#ffffff', motion }: {
  t: number;
  at?: number;
  peak?: number;
  tau?: number;
  falloff?: number;
  color?: string;
  motion?: string | false;
}) {
  const k = t < at ? 0 : peak * Math.exp(-(t - at) / tau);
  if (k < 0.003) return null;
  const [r, g, b] = parseGlyphColor(color);
  return (
    <div {...pieceMotionAttrs(motion, 'field-flash', { kind: 'field-flash', values: { k } })}
      style={{ position: 'absolute', inset: 0, opacity: k, pointerEvents: 'none', background: `radial-gradient(farthest-corner at 50% 50%, rgb(${r} ${g} ${b}) 0%, rgb(${r} ${g} ${b} / ${1 - falloff}) 100%)` }} />
  );
}

/**
 * A ring flung out from `origin` at `at`, `speed` px/s, its `stroke` px band fading from `opacity` by e every `tau` s.
 * The reference's: 2575 px/s, 22 px (2 % of frame height), 0.45, 0.068 s. At 30 fps it jumps 86 px a frame, so a trail
 * fades back over a `shutter` of travel; the band stays crisp.
 */
export function ShockRing({ t, at = 0, origin = { x: W / 2, y: H / 2 }, speed = 2575, stroke = 22, opacity = 0.45, tau = 0.0675, color = GLYPH_FIELD_COLORS.cream, shutter = 0.5, motion }: {
  t: number;
  at?: number;
  origin?: Point;
  speed?: number;
  stroke?: number;
  opacity?: number;
  tau?: number;
  color?: string;
  shutter?: number;
  motion?: string | false;
}) {
  const id = `shock-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const u = t - at;
  const alpha = u < 0 ? 0 : opacity * Math.exp(-u / tau);
  if (alpha < 0.004) return null;
  const head = speed * u, outer = head + stroke / 2, band = Math.max(0, head - stroke / 2);
  const inner = Math.max(0, band - Math.min(head, (speed * shutter) / FPS));
  const [r, g, b] = parseGlyphColor(color);
  const stop = (radius: number, a: number) => <stop offset={clamp(radius / outer)} stopColor={`rgb(${r} ${g} ${b})`} stopOpacity={a} />;
  const trail = band - inner > 0.5;
  return (
    <svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {trail && (
        <defs>
          <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={origin.x} cy={origin.y} r={outer}>
            {stop(inner, 0)}
            {stop(band, alpha * 0.4)}
            {stop(band, alpha)}
            {stop(outer, alpha)}
          </radialGradient>
        </defs>
      )}
      <circle {...pieceMotionAttrs(motion, 'shock-ring', { kind: 'shock-ring', values: { radius: head, alpha } })}
        cx={origin.x} cy={origin.y} r={(inner + outer) / 2} fill="none" strokeWidth={outer - inner}
        stroke={trail ? `url(#${id})` : `rgb(${r} ${g} ${b} / ${alpha})`} />
    </svg>
  );
}
