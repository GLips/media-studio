// recap.ts: the finale devices' numbers, without drawing them. A RecapGrid's layout, pop and exit poses and the tile
// under a point; a GlitchFlash hit's look and each frame's slice cuts; a Shake's rattle. Each is a pure function of
// `t`, seconds on the author's clock.

import type { Point, Rect } from '#models/camera/camera.ts';
import { FPS, H, W } from '#models/frame/frame.ts';
import { backOutEase, clamp, lerp } from '#models/motion/motion.ts';
import { seededRandom } from '#models/motion/random.ts';

// A frame's time minus a start on the frame grid can land a hair under it (17/30 − 0.5 < 2/30), which would put every
// start a frame late. A microsecond of slack is far below a frame.
export const RECAP_EPS = 1e-6;

// ---------- RecapGrid ----------

/**
 * Which tiles pop first: row by row (`z`, the reference's 2×2), by anti-diagonal from the top left (its 3×3), or from
 * the middle out (`centre`); or a rank per tile, where equal ranks pop together.
 */
export type RecapOrder = 'z' | 'antidiagonal' | 'centre' | readonly number[];

/**
 * How a tile leaves: `pop` shrinks it away through a small swell, `crt` powers it off like a tube (squashed to a white
 * line, then a dot, the reference's CODE tile), `cut` just goes. `hold` stays for as long as the grid is drawn, for a
 * shot that plays its own exit.
 */
export type RecapExit = 'pop' | 'crt' | 'cut' | 'hold';

/** Where the tiles sit: a `cols` × `rows` grid over the frame, `margin` in from its edges and `gutter` apart, row by row. */
export function recapGridRects(cols: number, rows: number, margin: number, gutter: number): Rect[] {
  const w = (W - 2 * margin - (cols - 1) * gutter) / cols;
  const h = (H - 2 * margin - (rows - 1) * gutter) / rows;
  return Array.from({ length: cols * rows }, (_, i) => ({ x: margin + (i % cols) * (w + gutter), y: margin + Math.floor(i / cols) * (h + gutter), w, h }));
}

/**
 * Seconds after the grid's start that each of `n` tiles pops, row by row in a `cols` × `rows` grid: `spread` from the
 * first to the last, in even steps between ranks, on whole frames (so a 3×3's five diagonals over 0.1 s land on
 * frames 0, 1, 2, 2, 3). The same times stagger the exit.
 */
export function recapPopStarts(n: number, cols: number, rows: number, order: RecapOrder, spread: number): number[] {
  if (typeof order !== 'string' && order.length !== n) throw new RangeError(`RecapGrid: ${order.length} ranks for ${n} tiles`);
  const ranks = Array.from({ length: n }, (_, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    if (typeof order !== 'string') return order[i];
    if (order === 'z') return i;
    if (order === 'antidiagonal') return row + col;
    return Math.hypot(col - (cols - 1) / 2, row - (rows - 1) / 2);
  });
  // Distances from the centre aren't whole, so ranks are matched after rounding away float noise.
  const key = (r: number) => Math.round(r * 1e6);
  const steps = [...new Set(ranks.map(key))].sort((a, b) => a - b);
  const each = steps.length > 1 ? spread / (steps.length - 1) : 0;
  return ranks.map((r) => Math.round(steps.indexOf(key(r)) * each * FPS) / FPS);
}

// The reference's two grids. A 2×2 of 942×522 tiles, 12 px (1.1% H) in from the edges and apart, 12 px corners, pops
// each from 0.76 over 0.25 s, overshooting 12.6% of the way; a 3×3 of 624×344, 8 in, 16 (1.5% H) apart, 8 px corners,
// from 0.66 over 0.23 s, overshooting 15.4% (to 1.05; its middle and CODE tiles within 3 px every frame).
const RECAP_TWO_UP = { margin: 12, gutter: 12, radius: 12, from: 0.76, duration: 0.25, overshoot: 0.126 };
const RECAP_THREE_UP = { margin: 8, gutter: 16, radius: 8, from: 0.66, duration: 0.23, overshoot: 0.154 };
// The pop-out's swell before it shrinks: less than the pop-in's, as an exit is the quieter move.
const RECAP_EXIT_SWELL = 0.05;
// A CRT power-off lasts the reference CODE tile's 8 frames at 60 fps, squash to gone. A pop-out is a little quicker
// than a pop-in.
const RECAP_EXIT_DURATION = { crt: 0.133, pop: 0.2 };

/** A tile's pose at a moment: its scale on each axis, the CRT exit's white wash and dot, and how far through its pop and exit. */
export type RecapTileLook = { sx: number; sy: number; white: number; dot: boolean; pop: number; exit: number };

/** Where a RecapGrid's tiles sit and how they pop in and leave: everything about it but what the tiles show. */
export type RecapLayout = {
  at?: number;
  /** The tiles, for how many there are and how each leaves; or just how many, when none leaves its own way. */
  tiles: number | readonly { exit?: RecapExit }[];
  /** Default: the smallest square that holds the tiles. */
  cols?: number;
  rows?: number;
  margin?: number;
  gutter?: number;
  order?: RecapOrder;
  /** Seconds from the first tile's pop to the last's: 0.1 in both the reference's grids (2 f at 60 fps a tile in Z order, 1.5 f a diagonal). */
  spread?: number;
  /** The pop: scale `from`, seconds to land, and overshoot as a share of the travel. */
  pop?: { from?: number; duration?: number; overshoot?: number };
  /**
   * When the tiles leave, on `t`'s clock, staggered in the order they came. A tile's own `exit` overrides `style`
   * (`pop` by default). Each takes `duration`: by default 0.133 s for `crt` (the reference's CODE tile) and 0.2 s
   * for `pop`.
   */
  exit?: { at: number; style?: RecapExit; duration?: number };
};

// The layout worked out: each tile's rect and when it pops, and its look `v` s after the grid's start (null undrawn).
export function recapPlan({ at = 0, tiles, cols, rows, margin, gutter, order = 'z', spread = 0.1, pop, exit }: RecapLayout) {
  const exits = typeof tiles === 'number' ? Array.from({ length: tiles }, () => undefined) : tiles.map((tile) => tile.exit);
  const n = exits.length;
  const c = cols ?? Math.ceil(Math.sqrt(n));
  const r = rows ?? Math.ceil(n / c);
  if (n > c * r) throw new RangeError(`RecapGrid: ${n} tiles don't fit a ${c}×${r} grid`);
  const look = c <= 2 ? RECAP_TWO_UP : RECAP_THREE_UP;
  const rects = recapGridRects(c, r, margin ?? look.margin, gutter ?? look.gutter);
  const starts = recapPopStarts(n, c, r, order, spread);
  const popIn = backOutEase(pop?.overshoot ?? look.overshoot);
  const popOut = backOutEase(RECAP_EXIT_SWELL);
  const from = pop?.from ?? look.from, popDuration = pop?.duration ?? look.duration;

  const tileLook = (i: number, v: number): RecapTileLook | null => {
    if (v < starts[i] - RECAP_EPS) return null;
    const k = clamp((v - starts[i]) / popDuration);
    const s = lerp(from, 1, popIn(k));
    const style = exits[i] ?? exit?.style ?? 'pop';
    const exitDuration = exit?.duration ?? (style === 'crt' ? RECAP_EXIT_DURATION.crt : RECAP_EXIT_DURATION.pop);
    const sinceExit = exit && style !== 'hold' ? v - (exit.at - at) - starts[i] : -1;
    if (sinceExit < -RECAP_EPS) return { sx: s, sy: s, white: 0, dot: false, pop: k, exit: 0 };
    if (style === 'cut' || sinceExit > exitDuration - RECAP_EPS) return null;
    const q = clamp(sinceExit / exitDuration);
    // A pop-out is a pop-in's curve run backwards, to nothing: it swells, then shrinks away fast.
    if (style === 'pop') {
      const out = s * popOut(1 - q);
      return { sx: out, sy: out, white: 0, dot: false, pop: k, exit: q };
    }
    return { ...crtLook(q, s, rects[i]), pop: k, exit: q };
  };
  return { look, rects, starts, count: n, tileLook };
}

// The scale a tile draws its whole-frame shot at, about the shot's centre, before the tile's own pop.
export const recapShotScale = (rect: Rect) => Math.max(rect.w / W, rect.h / H);

/**
 * The tile of a RecapGrid laid out as `layout` drawn over frame point `p` at `t`, and the point of its shot it shows
 * there: to ask a replayed shot what's under a HUD part over the grid. Null over the ground between tiles.
 */
export function recapTileUnder(p: Point, t: number, layout: RecapLayout): { index: number; inShot: Point } | null {
  const u = t - (layout.at ?? 0);
  if (u < -RECAP_EPS) return null;
  const { rects, count, tileLook } = recapPlan(layout);
  // Last first: a later tile draws over an earlier one where an overshoot crosses the gutter.
  for (let i = count - 1; i >= 0; i--) {
    const look = tileLook(i, u), rect = rects[i];
    if (!look) continue;
    const dx = p.x - (rect.x + rect.w / 2), dy = p.y - (rect.y + rect.h / 2);
    if (Math.abs(dx) > (look.sx * rect.w) / 2 || Math.abs(dy) > (look.sy * rect.h) / 2) continue;
    const k = recapShotScale(rect);
    return { index: i, inShot: { x: W / 2 + dx / (k * look.sx), y: H / 2 + dy / (k * look.sy) } };
  }
  return null;
}

// A tube switching off, `q` 0..1 through the exit: squashed to a 4 px line as it burns white, held, pulled in to a
// 12 × 6 dot, gone. The reference's CODE tile, a frame at 60 fps each: 0.83, 0.69 and 0.21 of its height, the line
// twice, 0.54 of its width, the dot, nothing.
function crtLook(q: number, s: number, rect: Rect): Pick<RecapTileLook, 'sx' | 'sy' | 'white' | 'dot'> {
  const line = 4 / rect.h, dotW = 12 / rect.w, dotH = 6 / rect.h;
  if (q < 0.5) {
    const k = q / 0.5;
    return { sx: s, sy: s * lerp(1, line, k), white: k, dot: false };
  }
  if (q < 0.625) return { sx: s, sy: s * line, white: 1, dot: false };
  if (q < 0.875) {
    const k = (q - 0.625) / 0.25;
    return { sx: s * lerp(1, dotW, k), sy: s * lerp(line, dotH, k), white: 1, dot: false };
  }
  return { sx: s * dotW, sy: s * dotH, white: 1, dot: true };
}

// ---------- GlitchFlash ----------

/** How one hit looks. Every field can be set per hit or, for all of them, on the GlitchFlash. */
export type GlitchLook = {
  /**
   * Seconds a hit lasts, re-cut every frame: 0.117 (a sixteenth at 128 BPM, as the reference's flashes) by default;
   * its grid arrivals are 0.05.
   */
  duration: number;
  /** Red shifted right and blue left of green by this many px: 13 (1.2% H), the flashes' R↔B 24–30; the arrivals' is 10. */
  split: number;
  /** The widest sideways shift of a slice, px: 100 (9% H). A few thin ones go two to four times as far. */
  shift: number;
  /** Bands and blocks cut and shifted each frame. */
  slices: number;
  /**
   * Opacity of a flash of `flashColor` over the frame as the hit starts, dying as (1 − k)² over `flashDuration`: 1
   * with no split or slices is the reference's grey flash into its end card. Its sixteenths don't flash (0).
   */
  flash: number;
  /** The hit colour-inverted, as the reference's cube-field sixteenth. */
  invert: boolean;
};

export type GlitchHit = { at: number } & Partial<GlitchLook>;

export const GLITCH_LOOK: GlitchLook = { duration: 0.117, split: 13, shift: 100, slices: 8, flash: 0, invert: false };

// One frame's cuts: bands across the frame and shorter blocks, mostly thin, each shifted sideways by up to `shift`, a
// few far further (the fragments the reference throws hundreds of px). Whole pixels, so nothing resamples soft.
export function glitchCuts(seed: number | string, hit: number, frame: number, { slices, shift }: GlitchLook) {
  if (slices <= 0 || shift <= 0) return [];
  const rnd = seededRandom(`${seed}|${hit}|${frame}`);
  return Array.from({ length: slices }, () => {
    const h = Math.round(4 + 76 * rnd() ** 2);
    const y = Math.round(rnd() * (H - h));
    const block = rnd() < 0.3;
    const w = block ? Math.round(160 + 480 * rnd()) : W;
    const x = block ? Math.round(rnd() * (W - w)) : 0;
    const reach = rnd() < 0.15 ? 2 + 2 * rnd() : 0.1 + 0.9 * rnd();
    return { x, y, w, h, dx: Math.round((rnd() < 0.5 ? -1 : 1) * shift * reach) };
  });
}

// ---------- Shake ----------

/**
 * An impact's rattle `dt` seconds after it, in px: knocked `strength` across and two thirds of that vertically on the
 * impact's frame, then swinging back (about 11 and 14 Hz) and dying away over `decay`; directions and frequencies
 * seeded. The reference's card: 3 px right and 2 up, 2 back a frame later, a pixel at 0.13 s.
 */
export function shakeOffset(dt: number, strength: number, decay: number, seed: number | string): { x: number; y: number } {
  if (dt < -RECAP_EPS || strength === 0) return { x: 0, y: 0 };
  dt = Math.max(0, dt);
  const reach = strength * Math.exp(-dt / decay);
  if (reach < 0.25) return { x: 0, y: 0 };
  const rnd = seededRandom(seed);
  const wx = 2 * Math.PI * (10 + 2 * rnd()), wy = 2 * Math.PI * (13 + 3 * rnd());
  const dirX = rnd() < 0.5 ? -1 : 1, dirY = rnd() < 0.5 ? -1 : 1;
  return { x: dirX * reach * Math.cos(wx * dt), y: dirY * (2 / 3) * reach * Math.cos(wy * dt) };
}
