// stroke-measure.ts: how a stroke's coverage is measured and two strokes compared, so a brush painted by the studio
// is set beside its target (a Procreate preview, a Photoshop reference) by number as well as by eye: one profile of
// each, their gaps weighed into one score, and the score graded.
//
// A change to how anything here measures or weighs bumps BRUSH_FIDELITY_SCORER_VERSION (brush-fidelity-report.ts), so
// sheets drawn before it aren't read as measured alike.

/** Coverage at or above this (of 255) counts as the stroke when measuring its extent and thickness. */
const STROKE_COVERAGE = 64;
/** Columns sampled along a stroke's length for its thickness profile. */
export const STROKE_PROFILE_SAMPLES = 40;
/** How deep into the stroke, in pixels, its edge profile reaches. */
const EDGE_DEPTH = 40;
/** The horizontal lags, in pixels, its texture is measured at. */
export const STROKE_TEXTURE_LAGS = [1, 2, 4, 8, 16, 32, 64] as const;
/**
 * A coverage map's cell, in pixels: coarse enough that two strokes' grains average out, so the map compares where paint
 * lies and how much, fine enough to keep a rim's band apart from the body inside it.
 */
export const STROKE_MAP_CELL = 8;
/** Mottle splits a stroke's body at a box this many pixels across: finer is grain, coarser is mottle. */
const MOTTLE_BOX = 13;

/** A stroke's shape, measured from its coverage. */
export type StrokeCoverageProfile = {
  /** Its columns from first to last covered. */
  span: { x0: number; x1: number };
  peakThickness: number;
  /** Its height at even steps across `span`. */
  thickness: readonly number[];
  /** Its mean coverage where it counts as stroke, 0..1. */
  density: number;
  /**
   * Mean coverage at each depth in from its top and bottom edges, over the middle half of its span: a wet rim shows as
   * a rise at the start.
   */
  edge: readonly number[];
  /**
   * How much its coverage changes across each of STROKE_TEXTURE_LAGS, within the stroke: a coarser texture keeps
   * rising to longer lags.
   */
  texture: readonly number[];
  /**
   * Pixels its coverage takes to climb from a fifth to four fifths of its density, going in from its top and bottom
   * edges (the median crossing): a crisp edge is a pixel or two.
   */
  edgeWidth: number;
  /** Coverage's spread in its body (away from its edges), `fine` within MOTTLE_BOX and `coarse` between boxes, 0..1. */
  mottle: { fine: number; coarse: number };
  /** Mean coverage of a column's middle third over its whole: 1 is even, below 1 hollow, above 1 dense in the middle. */
  fill: number;
  /** The whole image's mean coverage in cells of STROKE_MAP_CELL, row by row. */
  map: { columns: number; rows: number; cells: readonly number[] };
};

/** `coverage` is one byte per pixel, row by row, 255 fully covered. Null when nothing counts as stroke. */
export function measureStrokeCoverage(coverage: Uint8Array, width: number, height: number): StrokeCoverageProfile | null {
  const columns = new Float64Array(width), tops = new Int32Array(width).fill(-1), bottoms = new Int32Array(width).fill(-1);
  let x0 = width, x1 = -1, covered = 0, sum = 0;
  for (let x = 0; x < width; x++) {
    let top = -1, bottom = -1;
    for (let y = 0; y < height; y++) {
      const value = coverage[y * width + x];
      if (value < STROKE_COVERAGE) continue;
      if (top < 0) top = y;
      bottom = y;
      covered++;
      sum += value;
    }
    if (top < 0) continue;
    columns[x] = bottom - top + 1;
    tops[x] = top;
    bottoms[x] = bottom;
    x0 = Math.min(x0, x);
    x1 = x;
  }
  if (x1 < 0) return null;
  // Each sample is the widest column within its step, so a sparse, broken stroke still reads its extent.
  const step = (x1 - x0 + 1) / STROKE_PROFILE_SAMPLES;
  const thickness = Array.from({ length: STROKE_PROFILE_SAMPLES }, (_, i) => {
    let widest = 0;
    for (let x = Math.floor(x0 + i * step); x < Math.min(x1 + 1, Math.floor(x0 + (i + 1) * step) + 1); x++) widest = Math.max(widest, columns[x]);
    return widest;
  });
  const density = sum / covered / 255;
  const body = { coverage, width, height, tops, bottoms, from: x0 + Math.floor((x1 - x0) / 4), to: x1 - Math.floor((x1 - x0) / 4) };
  return {
    span: { x0, x1 }, peakThickness: Math.max(...thickness), thickness, density,
    edge: edgeProfile(body), texture: textureProfile(coverage, width, height),
    edgeWidth: edgeWidth(body, density), mottle: mottle(body), fill: fill(body), map: coverageMap(coverage, width, height),
  };
}

/** A stroke's coverage and the extent of each column that counts as stroke, over the middle half of its span. */
type StrokeBody = { coverage: Uint8Array; width: number; height: number; tops: Int32Array; bottoms: Int32Array; from: number; to: number };

function edgeProfile({ coverage, width, tops, bottoms, from, to }: StrokeBody): number[] {
  const sums = new Float64Array(EDGE_DEPTH), counts = new Float64Array(EDGE_DEPTH);
  for (let x = from; x <= to; x++) {
    const top = tops[x], bottom = bottoms[x];
    if (top < 0) continue;
    // Only as deep as the column's middle, so a thin column's far edge isn't read as depth.
    const reach = Math.min(EDGE_DEPTH, Math.floor((bottom - top) / 2));
    for (let d = 0; d < reach; d++) {
      sums[d] += coverage[(top + d) * width + x] + coverage[(bottom - d) * width + x];
      counts[d] += 2;
    }
  }
  // Only the depths some column reaches: a thinner stroke's profile is shorter.
  return Array.from(sums, (sum, d) => sum / counts[d] / 255).filter((_, d) => counts[d] > 0);
}

function textureProfile(coverage: Uint8Array, width: number, height: number): number[] {
  return STROKE_TEXTURE_LAGS.map((lag) => {
    let sum = 0, pairs = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x + lag < width; x++) {
        const a = coverage[y * width + x], b = coverage[y * width + x + lag];
        if (a < STROKE_COVERAGE || b < STROKE_COVERAGE) continue;
        sum += Math.abs(a - b);
        pairs++;
      }
    }
    return pairs ? sum / pairs / 255 : 0;
  });
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function edgeWidth({ coverage, width, height, from, to }: StrokeBody, density: number): number {
  const low = 0.2 * density * 255, high = 0.8 * density * 255;
  // Three pixels tall, so a lone speck above the edge isn't read as where it starts.
  const at = (x: number, y: number) => (coverage[Math.max(0, y - 1) * width + x] + coverage[y * width + x] + coverage[Math.min(height - 1, y + 1) * width + x]) / 3;
  const widths: number[] = [];
  for (let x = from; x <= to; x++) {
    for (const [start, dir] of [[0, 1], [height - 1, -1]] as const) {
      let y = start;
      while (y >= 0 && y < height && at(x, y) < low) y += dir;
      const outer = y;
      while (y >= 0 && y < height && Math.abs(y - outer) < height / 2 && at(x, y) < high) y += dir;
      if (y >= 0 && y < height && at(x, y) >= high) widths.push(Math.abs(y - outer));
    }
  }
  return median(widths);
}

function mottle({ coverage, width, height, tops, bottoms, from, to }: StrokeBody): { fine: number; coarse: number } {
  // A summed-area table, for each pixel's box mean.
  const area = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += coverage[y * width + x];
      area[(y + 1) * (width + 1) + x + 1] = area[y * (width + 1) + x + 1] + row;
    }
  }
  const r = (MOTTLE_BOX - 1) / 2;
  const boxMean = (x: number, y: number) => {
    const ax = Math.max(0, x - r), ay = Math.max(0, y - r), bx = Math.min(width, x + r + 1), by = Math.min(height, y + r + 1);
    return (area[by * (width + 1) + bx] - area[ay * (width + 1) + bx] - area[by * (width + 1) + ax] + area[ay * (width + 1) + ax]) / ((bx - ax) * (by - ay));
  };
  let n = 0, fine = 0, boxSum = 0, boxSquares = 0;
  for (let x = from; x <= to; x++) {
    if (tops[x] < 0) continue;
    const inset = Math.max(6, Math.round((bottoms[x] - tops[x]) / 4));
    for (let y = tops[x] + inset; y <= bottoms[x] - inset; y++) {
      const b = boxMean(x, y);
      fine += (coverage[y * width + x] - b) ** 2;
      boxSum += b;
      boxSquares += b * b;
      n++;
    }
  }
  if (!n) return { fine: 0, coarse: 0 };
  return { fine: Math.sqrt(fine / n) / 255, coarse: Math.sqrt(Math.max(0, boxSquares / n - (boxSum / n) ** 2)) / 255 };
}

function fill({ coverage, width, tops, bottoms, from, to }: StrokeBody): number {
  const shares: number[] = [];
  for (let x = from; x <= to; x++) {
    const top = tops[x], bottom = bottoms[x];
    if (top < 0 || bottom - top < 6) continue;
    let whole = 0, middle = 0, middleCount = 0;
    const a = top + (bottom - top) / 3, b = bottom - (bottom - top) / 3;
    for (let y = top; y <= bottom; y++) {
      const value = coverage[y * width + x];
      whole += value;
      if (y >= a && y <= b) { middle += value; middleCount++; }
    }
    if (whole > 0 && middleCount) shares.push(middle / middleCount / (whole / (bottom - top + 1)));
  }
  return shares.length ? shares.reduce((s, v) => s + v, 0) / shares.length : 1;
}

function coverageMap(coverage: Uint8Array, width: number, height: number): StrokeCoverageProfile['map'] {
  const columns = Math.ceil(width / STROKE_MAP_CELL), rows = Math.ceil(height / STROKE_MAP_CELL);
  const sums = new Float64Array(columns * rows), counts = new Float64Array(columns * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = Math.floor(y / STROKE_MAP_CELL) * columns + Math.floor(x / STROKE_MAP_CELL);
      sums[cell] += coverage[y * width + x];
      counts[cell]++;
    }
  }
  return { columns, rows, cells: Array.from(sums, (s, i) => Math.round((s / counts[i] / 255) * 1000) / 1000) };
}

/** How `ours` differs from `preview`. `length` and `peak` are ratios, ours over the preview's. */
export type StrokeProfileComparison = {
  length: number;
  peak: number;
  /** The mean gap between their thickness profiles, each laid over the preview's span, over the preview's peak. */
  profileError: number;
  /** How far in from each end the stroke first reaches 80% of its peak, as a share of its span: where a taper shows. */
  start: { preview: number; ours: number };
  end: { preview: number; ours: number };
  /** Ours less the preview's. */
  density: number;
  /** How much darker the first few pixels in from the edge are than the stroke's body, 0..1, each stroke's own. */
  rim: { preview: number; ours: number };
  /** The lag, in pixels, at which each stroke's texture reaches half its change at the longest lag: its grain's size. */
  grain: { preview: number; ours: number };
  edgeWidth: { preview: number; ours: number };
  mottle: { preview: { fine: number; coarse: number }; ours: { fine: number; coarse: number } };
  fill: { preview: number; ours: number };
  /** The mean gap between their coverage maps, each cell averaged with its neighbours, over the cells either paints. */
  mapError: number;
  /** Every gap weighed into one number (STROKE_SCORE_WEIGHTS), 0 for a perfect match; `terms` is each gap's share. */
  score: number;
  terms: Readonly<Record<keyof typeof STROKE_SCORE_WEIGHTS, number>>;
};

/**
 * Each gap's weight, set so a gap plain on the sheet adds about 0.1: maps 0.1 apart, profile 0.2 off, density or rim
 * 0.2, edge 2.7× as wide (log ratio, a pixel added so a one-pixel edge isn't infinitely crisper than none), mottle
 * 0.05, fill a third. Grain size is noisiest, so counts least.
 */
export const STROKE_SCORE_WEIGHTS = {
  map: 1, profile: 0.5, density: 0.5, rim: 0.5, edge: 0.1, fineMottle: 2, coarseMottle: 2, fill: 0.3, grain: 0.03, length: 0.3,
} as const;

/** A brush's grade by its score: `close` reads as its preview does, `rough` plainly differs, `off` isn't the brush. */
export const STROKE_SCORE_GRADES = { close: 0.2, rough: 0.45 } as const;
export type StrokeFidelityGrade = 'close' | 'rough' | 'off';
export const strokeFidelityGrade = (score: number): StrokeFidelityGrade => (score <= STROKE_SCORE_GRADES.close ? 'close' : score <= STROKE_SCORE_GRADES.rough ? 'rough' : 'off');

/**
 * How much darker a stroke's edge (its first 4 pixels in) is than its body (12 to 32 pixels in, or the deeper half of
 * a thinner stroke's profile).
 */
export const strokeRim = (edge: readonly number[]) => {
  const mean = (from: number, to: number) => edge.slice(from, to).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(to, edge.length) - from);
  return mean(0, 4) - mean(Math.min(12, Math.floor(edge.length / 2)), 32);
};

/** The lag at which `texture` reaches half its value at the longest lag, read between the lags measured (log-linear). */
export const strokeGrainSize = (texture: readonly number[]) => {
  const half = texture.at(-1)! / 2;
  const i = texture.findIndex((t) => t >= half);
  if (i <= 0) return STROKE_TEXTURE_LAGS[Math.max(0, i)];
  const k = (half - texture[i - 1]) / Math.max(1e-6, texture[i] - texture[i - 1]);
  return STROKE_TEXTURE_LAGS[i - 1] * (STROKE_TEXTURE_LAGS[i] / STROKE_TEXTURE_LAGS[i - 1]) ** k;
};

const rampShare = (thickness: readonly number[], fromEnd: boolean) => {
  const peak = Math.max(...thickness), ordered = fromEnd ? thickness.toReversed() : thickness;
  return ordered.findIndex((t) => t >= 0.8 * peak) / thickness.length;
};

/** A map's cells each averaged with their neighbours: a shift of a few pixels at a thin stroke's edge isn't a gap. */
function smoothedMap({ columns, rows, cells }: StrokeCoverageProfile['map']): number[] {
  return cells.map((_, i) => {
    const cx = i % columns, cy = Math.floor(i / columns);
    let sum = 0, n = 0;
    for (let y = Math.max(0, cy - 1); y <= Math.min(rows - 1, cy + 1); y++) {
      for (let x = Math.max(0, cx - 1); x <= Math.min(columns - 1, cx + 1); x++) { sum += cells[y * columns + x]; n++; }
    }
    return sum / n;
  });
}

function mapError(previewMap: StrokeCoverageProfile['map'], oursMap: StrokeCoverageProfile['map']): number {
  const preview = smoothedMap(previewMap), ours = smoothedMap(oursMap);
  let gap = 0, cells = 0;
  preview.forEach((p, i) => {
    const o = ours[i] ?? 0;
    if (Math.max(p, o) < 0.04) return;
    gap += Math.abs(p - o);
    cells++;
  });
  return cells ? gap / cells : 0;
}

export function compareStrokeProfiles(preview: StrokeCoverageProfile, ours: StrokeCoverageProfile): StrokeProfileComparison {
  const spanOf = (p: StrokeCoverageProfile) => p.span.x1 - p.span.x0 + 1;
  // Ours resampled over the preview's span, so a stroke that falls short shows its missing ends as error.
  const oursAt = (x: number) => {
    const i = Math.floor(((x - ours.span.x0) / spanOf(ours)) * STROKE_PROFILE_SAMPLES);
    return i >= 0 && i < STROKE_PROFILE_SAMPLES ? ours.thickness[i] : 0;
  };
  const gaps = preview.thickness.map((t, i) => Math.abs(t - oursAt(preview.span.x0 + ((i + 0.5) / STROKE_PROFILE_SAMPLES) * spanOf(preview))));
  const c = {
    length: spanOf(ours) / spanOf(preview),
    peak: ours.peakThickness / preview.peakThickness,
    profileError: gaps.reduce((a, b) => a + b, 0) / gaps.length / preview.peakThickness,
    start: { preview: rampShare(preview.thickness, false), ours: rampShare(ours.thickness, false) },
    end: { preview: rampShare(preview.thickness, true), ours: rampShare(ours.thickness, true) },
    density: ours.density - preview.density,
    rim: { preview: strokeRim(preview.edge), ours: strokeRim(ours.edge) },
    grain: { preview: strokeGrainSize(preview.texture), ours: strokeGrainSize(ours.texture) },
    edgeWidth: { preview: preview.edgeWidth, ours: ours.edgeWidth },
    mottle: { preview: preview.mottle, ours: ours.mottle },
    fill: { preview: preview.fill, ours: ours.fill },
    mapError: mapError(preview.map, ours.map),
  };
  const w = STROKE_SCORE_WEIGHTS;
  const terms = {
    map: w.map * c.mapError,
    profile: w.profile * c.profileError,
    density: w.density * Math.abs(c.density),
    rim: w.rim * Math.abs(c.rim.ours - c.rim.preview),
    edge: w.edge * Math.abs(Math.log((c.edgeWidth.ours + 1) / (c.edgeWidth.preview + 1))),
    fineMottle: w.fineMottle * Math.abs(c.mottle.ours.fine - c.mottle.preview.fine),
    coarseMottle: w.coarseMottle * Math.abs(c.mottle.ours.coarse - c.mottle.preview.coarse),
    fill: w.fill * Math.abs(c.fill.ours - c.fill.preview),
    grain: w.grain * Math.abs(Math.log(c.grain.ours / c.grain.preview)),
    length: w.length * Math.abs(Math.log(c.length)),
  };
  return { ...c, score: Object.values(terms).reduce((a, b) => a + b, 0), terms };
}
