// recap.tsx: a showreel's finale devices, after the reference reel's last bars (study 07-13.00-16.40). RecapGrid lays
// earlier shots out in a grid and pops them in on the beat, each still playing; GlitchFlash slices and colour-splits
// whatever it wraps on the hits it's given; Shake jolts what it wraps on an impact; FadeToBlack takes the picture
// down over the music's last sixteenth. Each is a pure function of `t`, seconds on the author's clock, with the times
// things happen given on that same clock.

import { useId, type CSSProperties, type ReactNode } from 'react';
import type { Rect } from '../camera.ts';
import { FPS, H, W } from '../frame.ts';
import { clamp, lerp, type EaseFn } from '../motion.ts';
import { motionEchoAttrs, pieceMotionAttrs } from '../motion-tag.ts';
import { hashRandom, seededRandom } from '../random.ts';

const fill: CSSProperties = { position: 'absolute', left: 0, top: 0, width: W, height: H };
// A frame's time minus a start on the frame grid can land a hair under it (17/30 − 0.5 < 2/30), which would put every
// start a frame late. A microsecond of slack is far below a frame.
const EPS = 1e-6;

/**
 * Penner's back-out with its overshoot given as a share of the travel: 0.126 (Penner's s = 1.95) is the reference's
 * 2×2 pop, peaking 56% of the way in and landing on exactly 1 at the end; its 3×3's is 0.154. 0 is a cubic ease-out.
 */
export function backOutEase(overshoot: number): EaseFn {
  const s = backOutStrength(overshoot);
  return (k) => {
    const u = clamp(k) - 1;
    return 1 + (s + 1) * u * u * u + s * u * u;
  };
}

// Back-out's peak overshoot is 4s³ / 27(s + 1)², which only rises with s, so bisection finds the s for a peak.
function backOutStrength(overshoot: number) {
  let lo = 0, hi = 20;
  for (let i = 0; i < 48; i++) {
    const s = (lo + hi) / 2;
    if ((4 * s ** 3) / (27 * (s + 1) ** 2) < overshoot) lo = s;
    else hi = s;
  }
  return lo;
}

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

/** What a tile tells its shot. */
export type RecapTileView = {
  /**
   * The scale the tile draws its 1920×1080 shot at (0.49 in a 2×2, 0.33 in a 3×3). A canvas in the shot can render
   * at W × scale and be scaled back up, rather than render a whole frame to be shown a third of the size.
   */
  scale: number;
};

export type RecapTile = {
  /**
   * Draws the whole 1920×1080 shot, ground included, at the shot's own time `t`: an earlier bar's component at its own
   * clock, so the replay plays live. It's drawn as an echo (motionEchoAttrs): its tags, framing marks and sound cues
   * counted where the shot first played, so the replay doesn't count them twice.
   */
  shot: (t: number, view: RecapTileView) => ReactNode;
  /** The shot's time at the grid's `at`, the moment the tile opens on; it plays on from there. Default 0. */
  from?: number;
  /** How this tile leaves at the grid's `exit`, instead of the exit's style. */
  exit?: RecapExit;
};

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

type TileLook = { sx: number; sy: number; white: number; dot: boolean; pop: number; exit: number };

/**
 * Earlier shots, still playing, popping into a grid from `at` (on `t`'s clock): the reference's 2×2, then 3×3. Each
 * tile scales about its centre, overshooting, smeared by its speed; the grid's size picks the reference's spacing and
 * pop. It draws `ground`, a whole shot: stop drawing it to cut away.
 *
 *   <RecapGrid t={s.t} at={beats.at(25)} tiles={shots} />
 */
export function RecapGrid({ t, at = 0, tiles, cols, rows, margin, gutter, radius, ground = '#0c0c0e', order = 'z', spread = 0.1, pop, exit, blur = 0.3, motion }: {
  t: number;
  at?: number;
  tiles: readonly RecapTile[];
  /** Default: the smallest square that holds the tiles. */
  cols?: number;
  rows?: number;
  margin?: number;
  gutter?: number;
  radius?: number;
  ground?: string;
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
  /**
   * A moving tile's smear, as a share of its edges' travel in a frame; 0 turns it off. 0.3 gives the reference's edge
   * softness frame for frame (16 px on a 2×2's first frame); 0.5, a 180° shutter at 30 fps, mushes the tile's middle,
   * which a true zoom blur would leave sharp.
   */
  blur?: number;
  /** The grid's name in the motion tracks, `recap` by default; its tiles are `tile 0`… inside it. `false` tracks neither. */
  motion?: string | false;
}) {
  const u = t - at;
  if (u < -EPS) return null;
  const c = cols ?? Math.ceil(Math.sqrt(tiles.length));
  const r = rows ?? Math.ceil(tiles.length / c);
  if (tiles.length > c * r) throw new RangeError(`RecapGrid: ${tiles.length} tiles don't fit a ${c}×${r} grid`);
  const look = c <= 2 ? RECAP_TWO_UP : RECAP_THREE_UP;
  const rects = recapGridRects(c, r, margin ?? look.margin, gutter ?? look.gutter);
  const starts = recapPopStarts(tiles.length, c, r, order, spread);
  const startRank = starts.map((s, i) => starts.filter((o, j) => o < s || (o === s && j < i)).length);
  const popIn = backOutEase(pop?.overshoot ?? look.overshoot);
  const popOut = backOutEase(RECAP_EXIT_SWELL);
  const from = pop?.from ?? look.from, popDuration = pop?.duration ?? look.duration;

  const tileLook = (i: number, v: number): TileLook | null => {
    if (v < starts[i] - EPS) return null;
    const k = clamp((v - starts[i]) / popDuration);
    const s = lerp(from, 1, popIn(k));
    const style = tiles[i].exit ?? exit?.style ?? 'pop';
    const exitDuration = exit?.duration ?? (style === 'crt' ? RECAP_EXIT_DURATION.crt : RECAP_EXIT_DURATION.pop);
    const sinceExit = exit && style !== 'hold' ? v - (exit.at - at) - starts[i] : -1;
    if (sinceExit < -EPS) return { sx: s, sy: s, white: 0, dot: false, pop: k, exit: 0 };
    if (style === 'cut' || sinceExit > exitDuration - EPS) return null;
    const q = clamp(sinceExit / exitDuration);
    // A pop-out is a pop-in's curve run backwards, to nothing: it swells, then shrinks away fast.
    if (style === 'pop') {
      const out = s * popOut(1 - q);
      return { sx: out, sy: out, white: 0, dot: false, pop: k, exit: q };
    }
    return { ...crtLook(q, s, rects[i]), pop: k, exit: q };
  };

  return (
    <div {...pieceMotionAttrs(motion, 'recap', { kind: 'recap-grid' })} style={{ ...fill, background: ground, overflow: 'hidden' }}>
      {tiles.map((tile, i) => {
        const here = tileLook(i, u);
        if (!here) return null;
        // The smear follows the scale's speed now, the slower of just before and just after: a frame on the kink where
        // a move stops (the CRT's line reaching its dot) is drawn still, not streaked by the move that just ended.
        const h = 0.002, before = tileLook(i, u - h), after = tileLook(i, u + h);
        const speed = (axis: 'sx' | 'sy') => {
          const back = before ? (here[axis] - before[axis]) / h : undefined;
          const ahead = after ? (after[axis] - here[axis]) / h : undefined;
          if (back === undefined || ahead === undefined) return back ?? ahead ?? 0;
          return Math.abs(back) < Math.abs(ahead) ? back : ahead;
        };
        const vx = speed('sx'), vy = speed('sy');
        // A box smear L px long spreads like a Gaussian of σ = L / √12; an edge moves half the size change.
        const sigma = (v: number, size: number) => (Math.abs(v) * blur * size) / (2 * FPS * Math.sqrt(12));
        const rect = rects[i];
        const scale = Math.max(rect.w / W, rect.h / H);
        const tag = motion === false ? {} : pieceMotionAttrs(undefined, `tile ${i}`, {
          kind: 'recap-tile', values: { pop: here.pop, exit: here.exit }, stagger: { group: 'tiles', index: startRank[i], count: tiles.length },
        });
        return (
          <RecapTileFrame key={i} rect={rect} look={here} smear={[sigma(vx, rect.w), sigma(vy, rect.h)]} radius={radius ?? look.radius} tag={tag}>
            <div {...motionEchoAttrs} style={{ ...fill, left: (rect.w - W * scale) / 2, top: (rect.h - H * scale) / 2, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
              {tile.shot((tile.from ?? 0) + u, { scale })}
            </div>
          </RecapTileFrame>
        );
      })}
    </div>
  );
}

// A tube switching off, `q` 0..1 through the exit: squashed to a 4 px line as it burns white, held, pulled in to a
// 12 × 6 dot, gone. The reference's CODE tile, a frame at 60 fps each: 0.83, 0.69 and 0.21 of its height, the line
// twice, 0.54 of its width, the dot, nothing.
function crtLook(q: number, s: number, rect: Rect): Pick<TileLook, 'sx' | 'sy' | 'white' | 'dot'> {
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

/**
 * One tile: scaled about its centre and clipped to its rounded rect, with a white wash for the CRT exit. The smear is
 * an SVG blur on an unscaled wrapper, in frame pixels, so a tile squashed to a line still smears by what it travelled.
 */
function RecapTileFrame({ rect, look, smear: [bx, by], radius, tag, children }: {
  rect: Rect;
  look: TileLook;
  smear: readonly [number, number];
  radius: number;
  tag: Record<string, string>;
  children: ReactNode;
}) {
  const id = useId();
  const smeared = Math.max(bx, by) >= 0.4;
  const pad = 0.1 * Math.max(rect.w, rect.h) + 3 * Math.max(bx, by);
  return (
    <>
      {smeared && (
        <svg width={0} height={0} style={{ position: 'absolute' }}>
          <filter id={id} filterUnits="userSpaceOnUse" x={-pad} y={-pad} width={rect.w + 2 * pad} height={rect.h + 2 * pad} colorInterpolationFilters="sRGB">
            <feGaussianBlur stdDeviation={`${bx} ${by}`} />
          </filter>
        </svg>
      )}
      <div style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, filter: smeared ? `url("#${id}")` : undefined }}>
        <div {...tag} style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: look.dot ? '50%' : radius, transform: `scale(${look.sx}, ${look.sy})` }}>
          {children}
          {look.white > 0 && <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: look.white }} />}
        </div>
      </div>
    </>
  );
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

const GLITCH_LOOK: GlitchLook = { duration: 0.117, split: 13, shift: 100, slices: 8, flash: 0, invert: false };
const IDENTITY_MATRIX = '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0';
const INVERT_MATRIX = '-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0';

/**
 * Glitches what it wraps on each hit: slices shifted sideways (new each frame), red and blue split apart, and
 * optionally a flash and an inversion; clean between hits. `hits` are times on `t`'s clock, or `{ at, …look }`. Wrap
 * a whole opaque shot and what takes the hit with it (a HUD).
 *
 *   <GlitchFlash t={s.t} hits={sixteenths} duration={beats.spb / 4}>{shot}</GlitchFlash>
 */
export function GlitchFlash({ t, hits, seed = 'glitch', flashColor = '#a4a4a4', flashDuration = 0.133, children, motion, ...look }: {
  t: number;
  hits: readonly (number | GlitchHit)[];
  /** Seeds the slices and the split's jitter, so the same hits cut the same slices on every render. */
  seed?: number | string;
  /** The flash's colour at the centre; the corners are 10% darker. The reference's grey is #a4a4a4. */
  flashColor?: string;
  /** Seconds a flash takes to die away: 0.133 (8 f at 60 fps) in the reference. */
  flashDuration?: number;
  children: ReactNode;
  /** Its name in the motion tracks, `glitch` by default; it reports the hit (1-based, 0 when clean), split and flash. */
  motion?: string | false;
} & Partial<GlitchLook>) {
  const id = useId();
  const all = hits.map((h, index) => ({ ...GLITCH_LOOK, ...look, ...(typeof h === 'number' ? { at: h } : h), index }));
  const live = all.findLast((h) => t > h.at - EPS && t < h.at + h.duration - EPS);
  const lit = all.findLast((h) => h.flash > 0 && t > h.at - EPS && t < h.at + flashDuration - EPS);
  const flash = lit ? lit.flash * (1 - clamp((t - lit.at) / flashDuration)) ** 2 : 0;
  const frame = live ? Math.round((t - live.at) * FPS) : 0;
  const cuts = live ? glitchCuts(seed, live.index, frame, live) : [];
  const split = live ? Math.round(live.split * (0.85 + 0.3 * hashRandom(seed, live.index, frame, 'split'))) : 0;
  const filtered = !!live && (split > 0 || cuts.length > 0 || live.invert);
  return (
    <>
      {filtered && (
        <svg width={0} height={0} style={{ position: 'absolute' }}>
          <filter id={id} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x={0} y={0} width={W} height={H} colorInterpolationFilters="sRGB">
            <feColorMatrix in="SourceGraphic" type="matrix" values={live.invert ? INVERT_MATRIX : IDENTITY_MATRIX} result="src" />
            {cuts.map((cut, i) => <feOffset key={i} in="src" dx={cut.dx} dy={0} x={cut.x} y={cut.y} width={cut.w} height={cut.h} result={`cut${i}`} />)}
            <feMerge result="cut">
              <feMergeNode in="src" />
              {cuts.map((_, i) => <feMergeNode key={i} in={`cut${i}`} />)}
            </feMerge>
            {/* Each channel alone, shifted, then summed: opaque input sums back to its own colour where nothing moved. */}
            {split > 0 && (
              <>
                <feColorMatrix in="cut" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" />
                <feOffset dx={split} dy={0} result="red" />
                <feColorMatrix in="cut" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" />
                <feOffset dx={-split} dy={0} result="blue" />
                <feColorMatrix in="cut" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="green" />
                <feComposite in="red" in2="green" operator="arithmetic" k2={1} k3={1} result="yellow" />
                <feComposite in="yellow" in2="blue" operator="arithmetic" k2={1} k3={1} />
              </>
            )}
          </filter>
        </svg>
      )}
      <div style={{ ...fill, filter: filtered ? `url("#${id}")` : undefined }}>{children}</div>
      {flash > 0 && (
        <div style={{ ...fill, pointerEvents: 'none', opacity: flash, background: `radial-gradient(ellipse at 50% 50%, ${flashColor} 35%, color-mix(in srgb, ${flashColor} 90%, #000) 100%)` }} />
      )}
      <div {...pieceMotionAttrs(motion, 'glitch', { kind: 'glitch-flash', values: { hit: live ? live.index + 1 : 0, split, flash } })} style={{ ...fill, pointerEvents: 'none' }} />
    </>
  );
}

// One frame's cuts: bands across the frame and shorter blocks, mostly thin, each shifted sideways by up to `shift`, a
// few far further (the fragments the reference throws hundreds of px). Whole pixels, so nothing resamples soft.
function glitchCuts(seed: number | string, hit: number, frame: number, { slices, shift }: GlitchLook) {
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
  if (dt < -EPS || strength === 0) return { x: 0, y: 0 };
  dt = Math.max(0, dt);
  const reach = strength * Math.exp(-dt / decay);
  if (reach < 0.25) return { x: 0, y: 0 };
  const rnd = seededRandom(seed);
  const wx = 2 * Math.PI * (10 + 2 * rnd()), wy = 2 * Math.PI * (13 + 3 * rnd());
  const dirX = rnd() < 0.5 ? -1 : 1, dirY = rnd() < 0.5 ? -1 : 1;
  return { x: dirX * reach * Math.cos(wx * dt), y: dirY * (2 / 3) * reach * Math.cos(wy * dt) };
}

/**
 * Jolts what it wraps on an impact at `at` (on `t`'s clock): knocked `strength` px on that frame (3, 0.3% H, in the
 * reference's end card), rattling back and settling in about 0.25 s. Still before `at` and after it settles. Wrap
 * what's hit (a card), not the frame's chrome: the reference's HUD holds still.
 */
export function Shake({ t, at, strength = 3, decay = 0.1, seed = 'jolt', children, motion }: {
  t: number;
  at: number;
  strength?: number;
  /** Seconds for the rattle to fall to 1/e of `strength`: 0.1, the reference's. It stops once under a quarter px. */
  decay?: number;
  /** Picks the directions and frequencies. The default, `jolt`, knocks right and up first, as the reference does. */
  seed?: number | string;
  children: ReactNode;
  /** Its name in the motion tracks, `shake` by default: its track is the offset, and what it wraps is measured inside it. */
  motion?: string | false;
}) {
  const { x, y } = shakeOffset(t - at, strength, decay, seed);
  return (
    <div {...pieceMotionAttrs(motion, 'shake', { kind: 'shake', values: { x, y } })} style={{ ...fill, transform: x || y ? `translate(${x}px, ${y}px)` : undefined }}>
      {children}
    </div>
  );
}

// ---------- FadeToBlack ----------

/**
 * The ending: black over the whole frame, HUD included, full at `end` (on `t`'s clock: the music's silence, the last
 * frame). Brightness falls as 1 − k² over `duration`, holding nearly full, then dropping away: the reference's last
 * sixteenth, 0.133 s, black on the downbeat. Draw it last.
 */
export function FadeToBlack({ t, end, duration = 0.133, motion }: {
  t: number;
  end: number;
  duration?: number;
  /** Its name in the motion tracks, `fade` by default; it reports `k`, 0..1 through the fade. */
  motion?: string | false;
}) {
  const k = clamp(1 - (end - t) / duration);
  if (k <= 0) return null;
  return <div {...pieceMotionAttrs(motion, 'fade', { kind: 'fade-to-black', values: { k } })} style={{ ...fill, background: '#000', opacity: k * k, pointerEvents: 'none' }} />;
}
