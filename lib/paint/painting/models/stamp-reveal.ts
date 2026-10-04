// stamp-reveal.ts: finished paint shown over time, as a document's reveal cuts it (docs/painting-authoring.md, Time).
// A reveal gives each texel an arrival time: strokes advance along their paths by arclength at constant speed, each
// from its `from` to its `to`, the earliest arrival winning where they cross; a field reads it off fields, base plus
// delay. A texel shows its covered share once the time passes its arrival, ramped over `softS` seconds and one texel
// of the front's travel; a texel no stroke covers never shows. Here are the checks, the plan the GPU pass reads
// (stamp-reveal-pass.ts) and the arithmetic's CPU twin, which the GPU gate holds the pass to.

import { STAMP_PAINT_FIELD_SHARE, stampPaintFieldAt, stampPaintFieldEnds, stampPaintFieldProblem, type StampSeededPaintField } from './stamp-paint-field.ts';
import type { StampPoint } from './stamp-region.ts';
import { stampSimilarityPoint, type StampSimilarityWords } from './stamp-rest-map.ts';
import { stampCanonicalJson } from './stamp-sheet-state-key.ts';
import type { StampWrapPeriods } from './stamp-stage.ts';

/** A reveal stroke's ends: `round` reaches half its width past each end; `flat` stops square at them. */
export type StampRevealCap = 'round' | 'flat';

/**
 * One stroke of a reveal: a band `widthPx` wide round `points` (two at least, document px, joints round), its front
 * advancing along them at constant speed from the first point at scene second `from` to the last at `to`. `cap`:
 * round when left out.
 */
export type StampRevealStroke = {
  readonly points: readonly StampPoint[];
  readonly widthPx: number;
  readonly from: number;
  readonly to: number;
  readonly cap?: StampRevealCap;
};

/**
 * Where and when finished paint shows: `strokes`, each texel arriving when the earliest stroke covering it reaches it;
 * `field`, arriving at `base` plus `delay` (0 when left out) scene seconds, everywhere covered. `softS` (0): seconds a
 * texel takes to show in full once reached.
 */
export type StampReveal =
  | { readonly kind: 'strokes'; readonly strokes: readonly StampRevealStroke[]; readonly softS?: number }
  | { readonly kind: 'field'; readonly base: StampSeededPaintField<number>; readonly delay?: StampSeededPaintField<number>; readonly softS?: number };

/** One thing wrong with a reveal: the field it's at (`strokes[2].to`), and why. */
export type StampRevealProblem = { readonly field: string; readonly message: string };

/** A path's length, px: its segments' summed. */
export const stampRevealPathLength = (points: readonly StampPoint[]) =>
  points.reduce((length, point, i) => (i === 0 ? 0 : length + Math.hypot(point.x - points[i - 1].x, point.y - points[i - 1].y)), 0);

/**
 * One stroke's problems: two finite points at least and a length, a positive width, finite times with `from` before
 * `to`. Its shape is the type's to hold; these are what a type can't say.
 */
function strokeProblems({ points, widthPx, from, to }: StampRevealStroke, at: string): StampRevealProblem[] {
  const problems: StampRevealProblem[] = [], problem = (field: string, message: string) => problems.push({ field: `${at}.${field}`, message });
  if (points.length < 2) problem('points', 'a stroke needs two points at least');
  else if (!points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))) problem('points', "aren't all finite");
  else if (!(stampRevealPathLength(points) > 0)) problem('points', 'lie on one spot: a stroke needs a length to advance along');
  if (!(Number.isFinite(widthPx) && widthPx > 0)) problem('widthPx', `${widthPx} isn't a finite width above 0`);
  if (!Number.isFinite(from)) problem('from', `${from} isn't a finite scene second`);
  if (!Number.isFinite(to)) problem('to', `${to} isn't a finite scene second`);
  if (Number.isFinite(from) && Number.isFinite(to) && !(from < to)) problem('to', `${to} s isn't after from, ${from} s: a stroke advances from its first point to its last`);
  return problems;
}

/** Why a field's value isn't an arrival: it must be a finite scene second. */
const secondProblem = (value: number) => (Number.isFinite(value) ? null : `its value ${value} isn't a finite scene second`);

/** Everything wrong with `reveal`, each at its field: none for one a pass can show. */
export function stampRevealProblems(reveal: StampReveal): StampRevealProblem[] {
  const problems: StampRevealProblem[] = [], { softS } = reveal;
  if (softS !== undefined && !(Number.isFinite(softS) && softS >= 0)) problems.push({ field: 'softS', message: `${softS} isn't a finite number of seconds from 0` });
  if (reveal.kind === 'strokes') {
    if (reveal.strokes.length === 0) return [...problems, { field: 'strokes', message: 'a strokes reveal needs a stroke at least' }];
    reveal.strokes.forEach((stroke, i) => problems.push(...strokeProblems(stroke, `strokes[${i}]`)));
    return problems;
  }
  for (const at of ['base', 'delay'] as const) {
    const field = reveal[at];
    const problem = field && stampPaintFieldProblem(field, secondProblem);
    if (problem) problems.push({ field: at, message: problem });
  }
  return problems;
}

// ---- the arithmetic ------------------------------------------------------------------------------------------------

/** An arrival no stroke reaches: later than any time a sample takes (stampRevealSampleAt keeps them finite). */
export const STAMP_REVEAL_NEVER = 3e38;

/**
 * How far a texel shows, 0..1, at time `t`: arrived at `arrival`, its front taking `perPx` seconds to cross a texel,
 * ramping over `softS` more. The front's half texel either side is its antialiasing.
 */
export function stampRevealRamp(t: number, arrival: number, perPx: number, softS: number): number {
  return Math.min(1, Math.max(0, (t - arrival + perPx / 2) / Math.max(softS + perPx, 1e-6)));
}

/** The ramp's WGSL twin, and the arrival a field gives. Both passes and the gate read these. */
export const STAMP_REVEAL_WGSL = /* wgsl */ `
${STAMP_PAINT_FIELD_SHARE.wgsl}
const REVEAL_NEVER = ${STAMP_REVEAL_NEVER.toExponential()};
fn revealRamp(t: f32, arrival: f32, perPx: f32, softS: f32) -> f32 {
  return clamp((t - arrival + perPx / 2.0) / max(softS + perPx, 1e-6), 0.0, 1.0);
}
fn revealFieldValue(p: vec2f, kind: i32, ends: vec2f, g: vec4f) -> f32 { return mix(ends.x, ends.y, paintFieldShare(p, kind, g)); }`;

/** Floats a segment takes in a pass's list: its ends (film px), half its width, its arrival at its start, seconds a px along it, its caps. */
export const STAMP_REVEAL_SEGMENT_FLOATS = 8;

/** A segment's cap flags: its start square (a stroke's first, flat), its end square (a stroke's last, flat). */
const FLAT_START = 1, FLAT_END = 2;

/**
 * `strokes` as segments in film px (STAMP_REVEAL_SEGMENT_FLOATS each): each stroke's points taken through `toFilm`,
 * a reveal's rest px to the film's, its width and speed scaled with them; a zero-length segment dropped. A document
 * wrapping by `periods` runs its paint across each seam, so a copy shifted a period each way comes too.
 */
export function stampRevealSegments(strokes: readonly StampRevealStroke[], toFilm: StampSimilarityWords, periods: StampWrapPeriods): Float32Array {
  const scale = Math.hypot(toFilm[0], toFilm[1]), out: number[] = [];
  const shifts = [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => ({ dx: i * periods.x, dy: j * periods.y })))
    .filter(({ dx, dy }, k, all) => all.findIndex((each) => each.dx === dx && each.dy === dy) === k);
  for (const { points, widthPx, from, to, cap } of strokes) {
    const film = points.map(({ x, y }) => stampSimilarityPoint(toFilm, x, y)), length = stampRevealPathLength(film), perPx = (to - from) / length;
    const flat = cap === 'flat', last = film.length - 1;
    let along = 0;
    for (let i = 1; i <= last; i++) {
      const a = film[i - 1], b = film[i], span = Math.hypot(b.x - a.x, b.y - a.y);
      if (span > 0) {
        const flags = (flat && i === 1 ? FLAT_START : 0) | (flat && i === last ? FLAT_END : 0);
        for (const { dx, dy } of shifts) out.push(a.x + dx, a.y + dy, b.x + dx, b.y + dy, (widthPx * scale) / 2, from + along * perPx, perPx, flags);
      }
      along += span;
    }
  }
  return Float32Array.from(out);
}

/** What a texel's candidates come to: the earliest arrival and its cover, the earliest at full cover, and the first's seconds per px. */
export type StampRevealArrival = { readonly first: number; readonly cover: number; readonly full: number; readonly perPx: number };

/** No stroke covers it. */
const UNREACHED: StampRevealArrival = { first: STAMP_REVEAL_NEVER, cover: 0, full: STAMP_REVEAL_NEVER, perPx: 1 };

/**
 * The arrival at film point (x, y) over segments `indices` of `segments`: each segment's cover there (its band's edge
 * antialiased over a px, a flat end's square too) and its arrival where the point projects onto it. The earliest
 * arrival wins, the fuller cover breaking a tie; the earliest at full cover is kept beside it.
 */
export function stampRevealArrivalAt(segments: Float32Array, indices: Iterable<number>, x: number, y: number): StampRevealArrival {
  let { first, cover, full, perPx } = UNREACHED;
  for (const k of indices) {
    const s = k * STAMP_REVEAL_SEGMENT_FLOATS;
    const ax = segments[s], ay = segments[s + 1], dx = segments[s + 2] - ax, dy = segments[s + 3] - ay, half = segments[s + 4], flags = segments[s + 7];
    const span = Math.hypot(dx, dy), ux = dx / span, uy = dy / span, px = x - ax, py = y - ay, u = px * ux + py * uy;
    const along = Math.min(span, Math.max(0, u)), across = Math.abs(px * uy - py * ux);
    let distance = Math.hypot(px - ux * along, py - uy * along), axial = 1;
    if ((flags & FLAT_START) !== 0 && u < 0) {
      distance = across;
      axial = Math.min(1, Math.max(0, 0.5 + u));
    }
    if ((flags & FLAT_END) !== 0 && u > span) {
      distance = across;
      axial = Math.min(1, Math.max(0, 0.5 + span - u));
    }
    const c = Math.min(1, Math.max(0, half - distance + 0.5)) * axial;
    if (c <= 0) continue;
    const arrival = segments[s + 5] + segments[s + 6] * along;
    if (arrival < first || (arrival === first && c > cover)) {
      first = arrival;
      cover = c;
      perPx = segments[s + 6];
    }
    if (c >= 1 && arrival < full) full = arrival;
  }
  return { first, cover, full, perPx };
}

/** The arrival's WGSL twin over the segments a pass's tile lists: `revealArrivalAt(p, first, count)` → (first, cover, full, perPx). */
export const STAMP_REVEAL_ARRIVAL_WGSL = /* wgsl */ `
fn revealArrivalAt(p: vec2f, start: u32, count: u32) -> vec4f {
  var first = REVEAL_NEVER;
  var cover = 0.0;
  var full = REVEAL_NEVER;
  var perPx = 1.0;
  for (var n = 0u; n < count; n++) {
    let k = listed[start + n];
    let ends = segments[2u * k];
    let rest = segments[2u * k + 1u];
    let a = ends.xy;
    let d = ends.zw - a;
    let span = length(d);
    let dir = d / span;
    let q = p - a;
    let u = dot(q, dir);
    let along = clamp(u, 0.0, span);
    let across = abs(q.x * dir.y - q.y * dir.x);
    var distance = length(q - dir * along);
    var axial = 1.0;
    let flags = u32(rest.w);
    if ((flags & ${FLAT_START}u) != 0u && u < 0.0) { distance = across; axial = clamp(0.5 + u, 0.0, 1.0); }
    if ((flags & ${FLAT_END}u) != 0u && u > span) { distance = across; axial = clamp(0.5 + span - u, 0.0, 1.0); }
    let c = clamp(rest.x - distance + 0.5, 0.0, 1.0) * axial;
    if (c <= 0.0) { continue; }
    let arrival = rest.y + rest.z * along;
    if (arrival < first || (arrival == first && c > cover)) { first = arrival; cover = c; perPx = rest.z; }
    if (c >= 1.0 && arrival < full) { full = arrival; }
  }
  return vec4f(first, cover, full, perPx);
}`;

/** How far a texel with `arrival` shows at `t`, `softS` its reveal's: its first cover once reached, all of it once fully covered. */
export const stampRevealArrivalShown = ({ first, cover, full, perPx }: StampRevealArrival, t: number, softS: number) =>
  Math.max(cover * stampRevealRamp(t, first, perPx, softS), stampRevealRamp(t, full, perPx, softS));

/** A field reveal's arrival at rest point (x, y): its base's value plus its delay's. */
export const stampRevealFieldArrival = (reveal: Extract<StampReveal, { kind: 'field' }>, x: number, y: number) =>
  stampPaintFieldAt(reveal.base, x, y) + (reveal.delay ? stampPaintFieldAt(reveal.delay, x, y) : 0);

/**
 * How far a field reveal shows at film point (x, y) at `t`, the film's points taken to the reveal's rest px by
 * `toRest`: its arrival there, and its front's seconds per film px read across a px each way.
 */
export function stampRevealFieldShown(reveal: Extract<StampReveal, { kind: 'field' }>, toRest: StampSimilarityWords, x: number, y: number, t: number): number {
  const at = (px: number, py: number) => {
    const rest = stampSimilarityPoint(toRest, px, py);
    return stampRevealFieldArrival(reveal, rest.x, rest.y);
  };
  const perPx = Math.hypot(at(x + 0.5, y) - at(x - 0.5, y), at(x, y + 0.5) - at(x, y - 0.5));
  return stampRevealRamp(t, at(x, y), perPx, reveal.softS ?? 0);
}

/**
 * How far `reveal` shows at document point `point` at scene second `t` (Infinity: fully revealed), on paint lying
 * where it was planned: the CPU twin of the pass, which reads a texel's centre at the time it samples. A strokes
 * reveal reads every segment.
 */
export function stampRevealShownAt(reveal: StampReveal, point: StampPoint, t: number): number {
  const identity: StampSimilarityWords = [1, 0, 0, 0], sampled = stampRevealSampleAt(reveal, 1, t);
  if (reveal.kind === 'field') return stampRevealFieldShown(reveal, identity, point.x, point.y, sampled);
  const segments = stampRevealSegments(reveal.strokes, identity, { x: 0, y: 0 });
  const all = Array.from({ length: segments.length / STAMP_REVEAL_SEGMENT_FLOATS }, (_, k) => k);
  return stampRevealArrivalShown(stampRevealArrivalAt(segments, all, point.x, point.y), sampled, reveal.softS ?? 0);
}

// ---- sampling ------------------------------------------------------------------------------------------------------

/** A field's least and most value. */
const fieldRange = (field: StampSeededPaintField<number> | undefined): [number, number] => {
  if (!field) return [0, 0];
  const { first, second } = stampPaintFieldEnds(field);
  return [Math.min(first, second), Math.max(first, second)];
};

/**
 * How far past its last arrival a reveal's window runs, seconds: a hard front over flat arrivals (a constant field,
 * no softS) steps from hidden to shown just after its arrival, never at it.
 */
const STAMP_REVEAL_STEP_S = 1e-3;

/**
 * The scene seconds over which `reveal` changes on a film whose px are `scale` of its rest px: nothing shows before
 * `lo`, all it shows from `hi`. A field's front crosses a px in at most √2 times its arrivals' range; a stroke's in
 * its seconds per film px.
 */
export function stampRevealWindow(reveal: StampReveal, scale: number): { readonly lo: number; readonly hi: number } {
  const softS = reveal.softS ?? 0;
  if (reveal.kind === 'field') {
    const [baseLo, baseHi] = fieldRange(reveal.base), [delayLo, delayHi] = fieldRange(reveal.delay), lo = baseLo + delayLo, hi = baseHi + delayHi;
    const half = (Math.SQRT2 * (hi - lo)) / 2;
    return { lo: lo - half, hi: hi + softS + half + STAMP_REVEAL_STEP_S };
  }
  let lo = Infinity, hi = -Infinity, half = 0;
  for (const { points, from, to } of reveal.strokes) {
    lo = Math.min(lo, from);
    hi = Math.max(hi, to);
    half = Math.max(half, ((to - from) * scale) / stampRevealPathLength(points) / 2);
  }
  return { lo: lo - half, hi: hi + softS + half + STAMP_REVEAL_STEP_S };
}

/**
 * The time a pass shows `reveal` at for scene second `t` (Infinity: fully revealed) on a film whose px are `scale` of
 * its rest px: `t` held within its window (stampRevealWindow), which shows the same, so a sample past either end keys
 * alike and a pass never reads an infinite time.
 */
export function stampRevealSampleAt(reveal: StampReveal, scale: number, t: number): number {
  const { lo, hi } = stampRevealWindow(reveal, scale);
  return Math.min(hi, Math.max(lo, t));
}

/**
 * One reveal as a pass cuts a film by it: the similarities taking a film point to the reveal's rest px and back, and
 * the time it's shown at (stampRevealSampleAt's). A film cut by several multiplies them.
 */
export type StampRevealLink = { readonly reveal: StampReveal; readonly toRest: StampSimilarityWords; readonly toFilm: StampSimilarityWords; readonly at: number };

const revealKeys = new WeakMap<StampReveal, string>();

/** `reveal` as JSON, made once a reveal: what an arrival map is kept under, with where it lies. */
export function stampRevealKey(reveal: StampReveal): string {
  let key = revealKeys.get(reveal);
  if (key === undefined) revealKeys.set(reveal, (key = stampCanonicalJson(reveal)));
  return key;
}

/** What `links` cut a film by, as a key: each reveal, where it lies and the time it's shown at. */
export const stampRevealLinksKey = (links: readonly StampRevealLink[]) =>
  links.map(({ reveal, toRest, at }) => `${stampRevealKey(reveal)}@${toRest.join(',')}@${at}`).join('*');

// ---- tiles ---------------------------------------------------------------------------------------------------------

/** Film px a side of a tile a pass lists segments by. */
export const STAMP_REVEAL_TILE = 16;

/** Segments listed by tile over a box: each tile's first index into `listed` and its count (`spans`, two words a tile, row by row). */
export type StampRevealTiles = { readonly columns: number; readonly rows: number; readonly spans: Uint32Array; readonly listed: Uint32Array };

/**
 * `segments` listed by the STAMP_REVEAL_TILE tiles of a `w` × `h` box whose first texel's corner is film point
 * (`x`, `y`): each in every tile its band reaches, a px past it for its antialiasing.
 */
export function stampRevealTiles(segments: Float32Array, { x, y, w, h }: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): StampRevealTiles {
  const columns = Math.max(1, Math.ceil(w / STAMP_REVEAL_TILE)), rows = Math.max(1, Math.ceil(h / STAMP_REVEAL_TILE)), count = segments.length / STAMP_REVEAL_SEGMENT_FLOATS;
  const reach = (k: number) => {
    const s = k * STAMP_REVEAL_SEGMENT_FLOATS, pad = segments[s + 4] + 1;
    const tile = (value: number, origin: number, most: number) => Math.min(most - 1, Math.max(0, Math.floor((value - origin) / STAMP_REVEAL_TILE)));
    const x0 = Math.min(segments[s], segments[s + 2]) - pad, x1 = Math.max(segments[s], segments[s + 2]) + pad;
    const y0 = Math.min(segments[s + 1], segments[s + 3]) - pad, y1 = Math.max(segments[s + 1], segments[s + 3]) + pad;
    if (x1 < x || y1 < y || x0 > x + w || y0 > y + h) return null;
    return { c0: tile(x0, x, columns), c1: tile(x1, x, columns), r0: tile(y0, y, rows), r1: tile(y1, y, rows) };
  };
  const counts = new Uint32Array(columns * rows), reaches = Array.from({ length: count }, (_, k) => reach(k));
  for (const r of reaches) {
    if (!r) continue;
    for (let row = r.r0; row <= r.r1; row++) for (let column = r.c0; column <= r.c1; column++) counts[row * columns + column]++;
  }
  const spans = new Uint32Array(columns * rows * 2);
  let total = 0;
  counts.forEach((n, tile) => {
    spans[2 * tile] = total;
    total += n;
  });
  const listed = new Uint32Array(total), filled = new Uint32Array(columns * rows);
  reaches.forEach((r, k) => {
    if (!r) return;
    for (let row = r.r0; row <= r.r1; row++) {
      for (let column = r.c0; column <= r.c1; column++) {
        const tile = row * columns + column;
        listed[spans[2 * tile] + filled[tile]++] = k;
      }
    }
  });
  filled.forEach((n, tile) => {
    spans[2 * tile + 1] = n;
  });
  return { columns, rows, spans, listed };
}
