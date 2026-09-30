// glyph-field-frame.ts: everything GlyphField draws at a time, as data: colours read and mixed, wave clips played on
// each cell, the filter's drops and moves, the punch, the collapse and the motion smear. A pure function of its props.

import type { FrameSize, VideoFormat } from '#lib/picture/frame/models/frame.ts';
import type { Point } from '#lib/picture/frame/models/geometry.ts';
import { backOutEase, clamp, lerp, motionCurves, type EaseFn } from '#lib/picture/motion/models/motion.ts';
import { hashRandom } from '#lib/picture/motion/models/random.ts';
import { GLYPH_FIELD_COLORS, GLYPH_SHAPES, glyphFieldLayout, glyphPunchScale, glyphRegroupPlan, glyphWaveArrivals, type GlyphCell, type GlyphClip, type GlyphFilterStep, type GlyphFilterTiming, type GlyphHit, type GlyphImplode, type GlyphKey, type GlyphLayout, type GlyphPunch, type GlyphShape, type GlyphWave } from './glyph-field.ts';

/** One frame of the reference reel (60 fps): the unit its timings were measured in. */
const REF_F = 1 / 60;
const RAD = Math.PI / 180;

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

// A plan is O(n³) and the same on every frame of a step: keep it per step's inputs.
const planCache = new Map<string, { slot: number[]; delay: number[] }>();
function cachedRegroupPlan(from: readonly Point[], to: readonly Point[], spread: number) {
  const key = `${spread}|${from.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';')}|${to.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';')}`;
  let plan = planCache.get(key);
  if (!plan) planCache.set(key, (plan = glyphRegroupPlan(from, to, spread)));
  return plan;
}

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
  const numbers = NUMBER_CHANNELS.filter((ch) => channels.has(ch)).map((ch): [NumberChannel, GlyphKey<number, D>[]] => [ch, channels.get(ch)!.toSorted((a, b) => a.at - b.at)]);
  return { numbers, fill: clip.fill ? clip.fill.toSorted((a, b) => a.at - b.at) : null };
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

function buildModel<D>(props: GlyphFieldProps<D>, size: FrameSize): FieldModel<D> {
  const { items, layout = {}, rest, waves = [], filter = [], filterTiming = {}, punch, implode, shutter = 0.5, seed = 'glyph-field' } = props;
  const pitch = layout.pitch ?? 100, center = layout.center ?? { x: size.width / 2, y: size.height / 2 };
  const count = items ? items.length : (layout.columns ?? 19) * (layout.rows ?? 11);
  const cells = glyphFieldLayout(count, size, layout).map((slot) => ({ ...slot, item: (items ? items[slot.index] : null) as D }));
  const restOf = typeof rest === 'function' ? rest : () => rest ?? {};
  const timing: Required<GlyphFilterTiming> = { exit: 0.26, enter: 0.3, spread: 0.2, move: 0.5, moveSpread: 0.12, moveEase: motionCurves.expo.entrance, ...filterTiming };

  const order = waves.map((_, k) => k).toSorted((a, b) => waves[a].start - waves[b].start || a - b);
  const planned = order.map((k) => ({ clip: planClip(waves[k].clip), ...glyphWaveArrivals(waves[k], cells, { pitch, center, seed, index: k }), index: k }));

  const steps: StepPlan[] = [];
  let prevX = cells.map((c) => c.x), prevY = cells.map((c) => c.y);
  filter.toSorted((a, b) => a.at - b.at).forEach((step, k) => {
    const keep = cells.map((cell) => step.keep?.(cell) ?? true);
    const tx = [...prevX], ty = [...prevY];
    const moveDelay = new Array<number>(cells.length).fill(0);
    const kept = cells.filter((_, n) => keep[n]).map((c) => c.index);
    if (step.regroup) {
      const block = step.regroup === true ? {} : step.regroup;
      const slots = glyphFieldLayout(kept.length, size, { pitch, center, columns: Math.max(1, Math.round(Math.sqrt(kept.length * 1.8))), ...block });
      const plan = cachedRegroupPlan(kept.map((n) => ({ x: prevX[n], y: prevY[n] })), slots, timing.moveSpread);
      kept.forEach((n, q) => { tx[n] = slots[plan.slot[q]].x; ty[n] = slots[plan.slot[q]].y; moveDelay[n] = plan.delay[q]; });
    } else {
      for (const n of kept) { tx[n] = cells[n].x; ty[n] = cells[n].y; }
      const byLength = kept.map((n) => [n, Math.hypot(tx[n] - prevX[n], ty[n] - prevY[n])] as const).filter(([, d]) => d > 0).toSorted((a, b) => a[1] - b[1] || a[0] - b[0]);
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

// A front timed to reach a cell on a frame reaches it on that frame, however the sum of its start, distance and speed
// rounds: the same field drawn later in a video has other rounding.
const ARRIVAL_SLACK = 1e-9;
const hasArrived = (t: number, at: number) => t >= at - ARRIVAL_SLACK;

function waveStateAt<D>(model: FieldModel<D>, n: number, t: number): CellState {
  const cell = model.cells[n];
  let state = model.rest[n];
  for (const wave of model.waves) {
    const at = wave.at[n];
    if (!hasArrived(t, at)) continue;
    state = playClip(state, wave.clip, cell, { since: Math.max(0, t - at), distance: wave.distance[n], wave: wave.index });
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

/** Everything `GlyphField` draws at `props.t` in a video of `format`, as data: a pure function of the two. */
export function glyphFieldFrame<D>(props: GlyphFieldProps<D>, format: VideoFormat): GlyphFieldFrame {
  const model = buildModel(props, format);
  const { t } = props, { cells, pitch, implode, center } = model;
  const shutter = model.shutter / format.fps;

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
    return sum + (reached.length ? reached.filter((at) => hasArrived(t, at)).length / reached.length : 0);
  }, 0);

  return {
    cells: draws,
    marker,
    box: { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y },
    values: { wave, kept: cells.length ? shown / cells.length : 0, move: moving ? moveSum / moving : 0, implode: im?.x ?? 0, punch },
  };
}
