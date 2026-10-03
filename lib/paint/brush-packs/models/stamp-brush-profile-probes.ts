// stamp-brush-profile-probes.ts: how an import measures a brush's profile (StampBrushProfile), the pure part, painted
// by the GPU renderer (studio/stamp-brush-profile-page.ts).
//
// Edge: firm, untapered, unfading strokes painted dry on the style's own paper in its own paint
// (StampBrushProbeMedium), at 8 headings, each in its own cell: one seed, or 4 where one is too noisy. A side's
// visible offset is where the paint's contrast with the paper (ΔE), averaged along the stroke and made monotone
// outward, falls to half its centreline's: where the eye sees the stroke end on that paper.
// Diameters 2 to 512 px, subdivided where interpolation misses.

import {
  stampFirmStroke, type StampBrush, type StampBrushAsset, type StampBrushEdgeSample, type StampBrushProfileSample, type StampBrushSupportSample,
} from '#lib/paint/brush/models/stamp-brush.ts';
import {
  STAMP_BRUSH_PROFILE_HEADINGS, STAMP_BRUSH_PROFILE_PRECISION, STAMP_BRUSH_PROFILE_TOLERANCE, stampBrushEvenEdge, stampBrushProfileHash, stampBrushProfileHeading,
} from '#lib/paint/brush/models/stamp-brush-profile.ts';
import type { PaintMaterial } from '#lib/paint/materials/models/paint-material.ts';
import { paintMediumCan } from '#lib/paint/materials/models/paint-medium.ts';
import { paintHexToLinear, paintLinearToLab, srgbToLinear } from '#lib/paint/materials/models/paint-spectrum.ts';
import type { StampPixelBox } from '#lib/paint/painting/models/stamp-blur-region.ts';
import { stampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe.ts';
import type { StampPaintPaper, StampPaintRecipe } from '#lib/paint/painting/models/stamp-paint-recipe-types.ts';
import type { StampPaintMixing } from '#lib/paint/painting/models/stamp-pigment-paint.ts';
import { STAMP_PACK_TIP_MAX, STAMP_PAINT_ASSETS_VERSION } from './stamp-paint-pack.ts';

/**
 * The fixed seeds each heading is probed with, in turn: each probe's deposit ID, which seeds it, ends in one. The
 * first alone serves a diameter where its noise says the rest would agree with it (stampEdgeProbeSeedsSettle).
 */
export const STAMP_BRUSH_PROFILE_SEEDS = ['a', 'b', 'c', 'd'] as const;

/** Diameters every profile is measured at, px, from the least a ridge narrows to up to the most. */
const SAMPLED_DIAMETERS = [2, 4, 8, 16, 32, 64, 128, 256] as const;
/** The most a profile is measured to, px: the largest a pack's tip image is kept. */
const MOST_DIAMETER = STAMP_PACK_TIP_MAX;
/** A probe stroke's length, in diameters, and the share of it measured, past its ends' build. */
const PROBE_LENGTH = 12, PROBE_MEASURED = 2 / 3;
/** The shortest a probe stroke is, in diameters, when a large one is shortened to fit its canvas. */
const PROBE_LEAST_LENGTH = 6;
/**
 * The least contrast with the paper, ΔE76 as stampProbeContrast reads it, a stroke's centre must show to be measured:
 * a just-noticeable difference (2.3, about 1 ΔE00). An edge of paint the eye can't see has no visible offset.
 */
const STAMP_PROBE_VISIBLE_CONTRAST = 2.3;
/** Past this share of a diameter, interpolating between samples misses where a midpoint measures. */
const REFINE_SHARE = 0.01;
/** Standard errors a midpoint's miss must pass to be a bend in the profile rather than the brush's randomness. */
const REFINE_NOISE = 3;
/** The most of the miss above it a midpoint's miss keeps and still reads as a bend: a bend's falls by half or more. */
const REFINE_SHRINK = 0.75;
/**
 * A probe's stations: in windows spread evenly along its measured stretch, each window's stations a pixel apart (less
 * in a stretch too short), so a read takes the pixels round them rather than the whole stretch's box.
 */
const STATION_WINDOWS = 8, WINDOW_STATIONS = 16;
/**
 * The step, px, a station is read at across the stroke: a quarter pixel, or a 256th of a diameter where that's coarser,
 * well inside a large diameter's tolerance (REFINE_SHARE), as crossings are interpolated between steps.
 */
const ACROSS_STEP = 0.25, ACROSS_STEPS_PER_DIAMETER = 256;
/**
 * Pixels across a crop reads at most: a window's sections are cut into runs this long, each its own crop, as one box
 * round a whole diagonal section would read the square it spans.
 */
const ACROSS_RUN = 32;
/** The widest probe canvas, px: the surface's targets at this size hold a few hundred megabytes. */
export const STAMP_PROBE_CANVAS_MOST = 6144;
/**
 * What a style's probes paint in: its paper, how its paint mixes, and the paint they lay (stampBrushProbePaint).
 * Pigment strength changes where paint reads as ended (a stronger one darkens sooner, so further out); one paint
 * stands for every one a style lays, its strongest.
 */
export type StampBrushProbeMedium = { paper: StampPaintPaper; mixing: StampPaintMixing; paint: PaintMaterial };

/** What a style with no style.ts yet paints in: black on white in flat colour, as Photoshop paints. */
export const STAMP_BRUSH_PROBE_BARE_MEDIUM: StampBrushProbeMedium = { paper: { color: '#ffffff' }, mixing: { kind: 'flat' }, paint: { kind: 'color', color: '#000000' } };

/**
 * The paint a style's probes lay: the darkest pigment its medium mixes (by its full strength over white), at full
 * load; or, with no pigment, the bare medium's black. It's the strongest stroke a project lays, and its half-darkness
 * edge the outermost any paler mix reaches, so a fill planned by it never overpaints.
 */
export function stampBrushProbePaint(mixing: StampPaintMixing): PaintMaterial {
  const pigments = mixing.kind === 'pigment' ? Object.values(mixing.pigments) : [];
  const darkest = pigments.map((pigment) => ({ pigment, lightness: paintLinearToLab(paintHexToLinear(pigment.overWhite))[0] })).toSorted((a, b) => a.lightness - b.lightness)[0];
  return darkest ? { kind: 'mixture', parts: [{ pigment: darkest.pigment, amount: 1 }], strength: 1 } : STAMP_BRUSH_PROBE_BARE_MEDIUM.paint;
}

/**
 * `medium`'s key, as a profile holds it and a style's boundary checks it (stampPackBrushProfile): its paper's images
 * keyed by what fixes their bytes, their pack's archive (`sources`, sha256 by pack folder) and the asset version. A
 * paper whose pack isn't imported keys as none, matching no measured profile.
 */
export function stampBrushProbeMediumKey({ paper, mixing, paint }: StampBrushProbeMedium, sources: Readonly<Record<string, string>>): string {
  const image = ({ pack, file }: StampBrushAsset) => ({ archive: sources[pack] ?? null, file });
  const keyed = {
    assets: STAMP_PAINT_ASSETS_VERSION,
    paper: { color: paper.color, image: paper.image ? image(paper.image) : null, grain: paper.grain ? { ...paper.grain, image: image(paper.grain.image) } : null },
    mixing, paint,
  };
  return stampBrushProfileHash(JSON.stringify(keyed));
}

/** A brush measured: its samples, rising; or refused, saying what in the brush stopped it. */
export type StampBrushProfileMeasured = { samples: StampBrushProfileSample[] } | { refused: string };

/** A probe refused for what the brush does (it never reaches half its centre, or reaches past its crop), not a fault. */
export class StampBrushProbeRefusal extends Error {}
/** A probe stroke laying more than the renderer binds at once: its diameter is past what the brush is measured to. */
export class StampBrushProbeTooLarge extends StampBrushProbeRefusal {}

/**
 * What one probe painting may hold, under WebGPU's 128 MiB storage binding: stamps (12 floats each), and an ordered
 * layer's bin entries (one per stamp per 32-px tile it may reach).
 */
const PAINTING_STAMPS = 2_000_000, PAINTING_BIN_ENTRIES = 24_000_000;

/**
 * A brush as its probes paint it, a firm stroke (stampFirmStroke), and its tips' support at a diameter as the
 * renderer draws them (stampTipSupportOf), its dual's with it: how far its stamps can lay paint.
 */
export type StampBrushProbe = { brush: StampBrush; supportAt: (diameter: number) => StampBrushSupportSample };

export const stampBrushProbe = (brush: StampBrush, supportAt: StampBrushProbe['supportAt']): StampBrushProbe => ({ brush: stampFirmStroke(brush), supportAt });

/**
 * How far from its centreline a probe's paint can possibly reach at `diameter`, px: its main tip's support at any
 * turn and level (a firm stroke's stamps are never wider than its diameter, or the tip's own pixels), and its
 * scatter. Its dual paints only where it does. A crop this wide either side holds the edge.
 */
export function stampBrushProbeReach({ brush: { tip, scatter }, supportAt }: StampBrushProbe, diameter: number): number {
  const stamp = ('bristles' in tip ? undefined : tip.pixels) ?? diameter;
  return Math.ceil(Math.max(...supportAt(diameter).main.reach) * stamp + 2 * (scatter.radius + scatter.lateral) * Math.max(diameter, stamp)) + 4;
}

/**
 * An edge probe's stroke length at `diameter` and the side of the cell holding it at any heading with its reach round
 * it, px: PROBE_LENGTH diameters, shortened to fit two cells across a canvas (four a page, where one a page makes
 * the readback dominate a large brush's measuring), or one; null where even PROBE_LEAST_LENGTH wouldn't fit one.
 */
function edgeCell(probe: StampBrushProbe, diameter: number): { length: number; cell: number } | null {
  const reach = stampBrushProbeReach(probe, diameter), fits = (across: number) => STAMP_PROBE_CANVAS_MOST / across - 2 * reach - 8;
  const length = Math.min(PROBE_LENGTH * diameter, fits(2) >= PROBE_LEAST_LENGTH * diameter ? fits(2) : fits(1));
  return length < PROBE_LEAST_LENGTH * diameter ? null : { length, cell: Math.ceil(length + 2 * reach) + 8 };
}

/**
 * The diameters a profile starts from, px: from what a ridge narrows to up to STAMP_PACK_TIP_MAX or, for a brush
 * that reaches so far its probes outgrow a canvas, the widest that fits.
 */
export function stampBrushProfileDiameters(probe: StampBrushProbe): number[] {
  const fitting = [...SAMPLED_DIAMETERS, MOST_DIAMETER].filter((d) => edgeCell(probe, d));
  if (fitting.length < 2) throw new StampBrushProbeRefusal(`its scatter reaches too far for a probe canvas at ${SAMPLED_DIAMETERS[1]} px`);
  return fitting;
}

type Point = { x: number; y: number };

/** One stroke probe: its deposit's ID, heading index, seed, page, centre, unit direction and the normal to its left (y down). */
export type StampEdgeProbe = { id: string; heading: number; seed: string; page: number; center: Point; along: Point; left: Point };

/**
 * One piece of a probe's measured stretch: a window of its stations (along the stroke, px), a run of their steps
 * across it (`from` to `to`, its sheet's `across` apart, from the left reach), and the crop holding them.
 */
export type StampEdgeProbePiece = { probe: number; window: number; stations: readonly number[]; from: number; to: number; crop: StampPixelBox };

/** A canvas edge probes are painted on: its side, px, and its probes' IDs, each in its own cell. */
export type StampEdgeProbePage = { size: number; ids: string[] };

/** A diameter's probes: their pages, the probes and the painting of them, and the pieces their reads take. */
export type StampEdgeProbeSheet = {
  diameter: number; reach: number; across: number; probes: StampEdgeProbe[]; pieces: StampEdgeProbePiece[]; pages: StampEdgeProbePage[];
  /** The painting of the probes `ids` names: one page's, or part of one; of none, the bare paper they're read against. */
  recipe: (ids: ReadonlySet<string>) => StampPaintRecipe;
};

/** The box a stretch of a probe from `a` to `b` px along it covers, from `s0` to `s1` px left of it, a pixel more for bilinear reads. */
function stretchBox({ center, along, left }: StampEdgeProbe, a: number, b: number, s0: number, s1: number, size: number): StampPixelBox {
  const xs: number[] = [], ys: number[] = [];
  for (const t of [a, b]) {
    for (const s of [s0, s1]) {
      xs.push(center.x + along.x * t + left.x * s);
      ys.push(center.y + along.y * t + left.y * s);
    }
  }
  const x = Math.max(0, Math.floor(Math.min(...xs)) - 1), y = Math.max(0, Math.floor(Math.min(...ys)) - 1);
  return { x, y, w: Math.min(size, Math.ceil(Math.max(...xs)) + 2) - x, h: Math.min(size, Math.ceil(Math.max(...ys)) + 2) - y };
}

/**
 * A brush's edge probes at `diameter` in `paint`: every heading and seed its own deposit in its own cell, as many
 * cells a page as a canvas holds, and the windows of stations along their measured stretches, a crop each.
 */
export function stampEdgeProbeSheet(probe: StampBrushProbe, diameter: number, { paper, mixing, paint }: StampBrushProbeMedium): StampEdgeProbeSheet {
  const fits = edgeCell(probe, diameter);
  if (!fits) throw new StampBrushProbeTooLarge(`its probe stroke at ${diameter} px outgrows a ${STAMP_PROBE_CANVAS_MOST} px canvas`);
  const { brush } = probe, { length, cell } = fits, reach = stampBrushProbeReach(probe, diameter), half = (PROBE_MEASURED * length) / 2;
  const count = STAMP_BRUSH_PROFILE_HEADINGS * STAMP_BRUSH_PROFILE_SEEDS.length, cellsAcross = Math.floor(STAMP_PROBE_CANVAS_MOST / cell);
  const perPage = Math.min(count, cellsAcross * cellsAcross), columns = Math.ceil(Math.sqrt(perPage)), size = columns * cell;
  const probes: StampEdgeProbe[] = [];
  // Seed by seed, so a first seed's probes, often all a diameter needs, share as few pages as they can.
  for (const seed of STAMP_BRUSH_PROFILE_SEEDS) {
    for (let heading = 0; heading < STAMP_BRUSH_PROFILE_HEADINGS; heading++) {
      const angle = stampBrushProfileHeading(heading), along = { x: Math.cos(angle), y: Math.sin(angle) };
      const index = probes.length, slot = index % perPage;
      const center = { x: ((slot % columns) + 0.5) * cell, y: (Math.floor(slot / columns) + 0.5) * cell };
      probes.push({ id: `h${heading}${seed}`, heading, seed, page: Math.floor(index / perPage), center, along, left: { x: along.y, y: -along.x } });
    }
  }
  const pages = Array.from({ length: Math.ceil(count / perPage) }, (_, page): StampEdgeProbePage => ({ size, ids: probes.filter((p) => p.page === page).map(({ id }) => id) }));
  const spacing = Math.min(1, (2 * half) / (STATION_WINDOWS * WINDOW_STATIONS)), across = Math.max(ACROSS_STEP, diameter / ACROSS_STEPS_PER_DIAMETER);
  const steps = 2 * Math.round(reach / across), run = Math.max(1, Math.floor(ACROSS_RUN / across)), leftOf = (i: number) => (steps / 2 - i) * across;
  const pieces = probes.flatMap((line, index) => Array.from({ length: STATION_WINDOWS }, (_, k): StampEdgeProbePiece[] => {
    const middle = -half + ((k + 0.5) * 2 * half) / STATION_WINDOWS;
    const stations = Array.from({ length: WINDOW_STATIONS }, (__, j) => middle + (j - (WINDOW_STATIONS - 1) / 2) * spacing);
    return Array.from({ length: Math.ceil((steps + 1) / run) }, (__, r) => {
      const from = r * run, to = Math.min(steps, from + run - 1);
      return { probe: index, window: k, stations, from, to, crop: stretchBox(line, stations[0], stations.at(-1)!, leftOf(to), leftOf(from), size) };
    });
  }).flat());
  const recipe = (ids: ReadonlySet<string>) => stampPaintRecipe({ paper, mixing }, (painting) => {
    const chosen = probes.filter((line) => ids.has(line.id));
    // Painted dry: a medium with wet history gives it up, which one without refuses as already given.
    const dry = mixing.kind === 'pigment' && paintMediumCan(mixing.medium, 'wet-history') ? { wetHistory: false } as const : {};
    if (!chosen.length) return;
    painting.group('probe', { composite: 'glaze', opacity: 1 }, (group) => group.passage('edge', dry, (pass) => {
      for (const { id, center, along } of chosen) {
        pass.stroke(id, {
          brush, well: { paint }, size: diameter,
          path: [{ x: center.x - along.x * length / 2, y: center.y - along.y * length / 2, pressure: 1 }, { x: center.x + along.x * length / 2, y: center.y + along.y * length / 2, pressure: 1 }],
        });
      }
    }));
  });
  return { diameter, reach, across, probes, pieces, pages, recipe };
}

const BYTE_TO_LINEAR = Float64Array.from({ length: 256 }, (_, v) => srgbToLinear(v / 255));
/** CIELAB by packed sRGB bytes, shared by every read: a probe's paper and paint hold few colours, each converted once. */
const LAB_BY_BYTES = new Map<number, [number, number, number]>();

function labOfPixel(bytes: Uint8ClampedArray, pixel: number): [number, number, number] {
  const r = bytes[pixel * 4], g = bytes[pixel * 4 + 1], b = bytes[pixel * 4 + 2], key = (r << 16) | (g << 8) | b;
  let lab = LAB_BY_BYTES.get(key);
  if (!lab) LAB_BY_BYTES.set(key, (lab = paintLinearToLab([BYTE_TO_LINEAR[r], BYTE_TO_LINEAR[g], BYTE_TO_LINEAR[b]])));
  return lab;
}

/** A crop's contrast with bare paper, ΔE in CIELAB, pixel by pixel, row by row. */
export type StampProbeContrast = Float32Array;

/** The contrast of painted pixels (RGBA bytes, sRGB) with the same pixels of bare paper. */
export function stampProbeContrast(paper: Uint8ClampedArray, painted: Uint8ClampedArray): StampProbeContrast {
  const contrast = new Float32Array(paper.length / 4);
  for (let pixel = 0, i = 0; pixel < contrast.length; pixel++, i += 4) {
    // Most of a crop is paper the paint never reached: the same bytes, no contrast, no conversion.
    if (paper[i] === painted[i] && paper[i + 1] === painted[i + 1] && paper[i + 2] === painted[i + 2]) continue;
    const [p, q] = [labOfPixel(paper, pixel), labOfPixel(painted, pixel)];
    contrast[pixel] = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  }
  return contrast;
}

/** What a probe deposit asks of the renderer: its stamps, and the bin entries they'd take laid in order. */
export type StampProbeDepositLoad = { stamps: number; bins: number };

/** Deposits by ID grouped into paintings the renderer can hold; refuses one that alone can't be. */
export function stampProbePaintings(loads: ReadonlyMap<string, StampProbeDepositLoad>): string[][] {
  const paintings: { ids: string[]; stamps: number; bins: number }[] = [];
  for (const [id, { stamps, bins }] of loads) {
    if (stamps > PAINTING_STAMPS || bins > PAINTING_BIN_ENTRIES) throw new StampBrushProbeTooLarge(`a probe stroke lays ${stamps} stamps over ${bins} tile bins, more than the renderer holds at once`);
    const painting = paintings.find((p) => p.stamps + stamps <= PAINTING_STAMPS && p.bins + bins <= PAINTING_BIN_ENTRIES);
    if (painting) {
      painting.ids.push(id);
      painting.stamps += stamps;
      painting.bins += bins;
    } else paintings.push({ ids: [id], stamps, bins });
  }
  return paintings.map((p) => p.ids);
}

/** A crop's contrast read bilinearly at painting point (x, y), pixel centres at half pixels; 0 outside it. */
function bilinear(contrast: StampProbeContrast, crop: StampPixelBox, x: number, y: number): number {
  const fx = x - crop.x - 0.5, fy = y - crop.y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), kx = fx - x0, ky = fy - y0;
  // Inside, as nearly every read is, the four taps are read straight; at the crop's rim, each is checked.
  if (x0 >= 0 && y0 >= 0 && x0 + 1 < crop.w && y0 + 1 < crop.h) {
    const i = y0 * crop.w + x0;
    return (contrast[i] * (1 - kx) + contrast[i + 1] * kx) * (1 - ky) + (contrast[i + crop.w] * (1 - kx) + contrast[i + crop.w + 1] * kx) * ky;
  }
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < crop.w && j < crop.h ? contrast[j * crop.w + i] : 0);
  return (at(x0, y0) * (1 - kx) + at(x0 + 1, y0) * kx) * (1 - ky) + (at(x0, y0 + 1) * (1 - kx) + at(x0 + 1, y0 + 1) * kx) * ky;
}

/** A window of a probe's stations: each one's contrast with the paper across it, from the left reach to the right in its sheet's `across` steps. */
export type StampProbeSections = { probe: number; sections: Float32Array[] };

/**
 * Each window's sections, assembled from its `pieces`' runs, each read bilinearly from its own crop's `contrast`
 * (stampProbeContrast).
 */
export function stampProbeSections(sheet: StampEdgeProbeSheet, pieces: readonly { piece: StampEdgeProbePiece; contrast: StampProbeContrast }[]): StampProbeSections[] {
  const steps = 2 * Math.round(sheet.reach / sheet.across), windows = new Map<string, StampProbeSections>();
  for (const { piece, contrast } of pieces) {
    const key = `${piece.probe}/${piece.window}`;
    let read = windows.get(key);
    if (!read) windows.set(key, (read = { probe: piece.probe, sections: piece.stations.map(() => new Float32Array(steps + 1)) }));
    const { center, along, left } = sheet.probes[piece.probe];
    piece.stations.forEach((t, j) => {
      const section = read.sections[j];
      for (let i = piece.from; i <= piece.to; i++) {
        const s = (steps / 2 - i) * sheet.across;
        section[i] = bilinear(contrast, piece.crop, center.x + along.x * t + left.x * s, center.y + along.y * t + left.y * s);
      }
    });
  }
  return [...windows.values()];
}

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b), mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * How wide a box a section is smoothed by before it's read, px, or a quarter of a smaller diameter, whose whole stroke
 * it would flatten: a hairline streak past a gap then falls under half the centre's contrast at every heading.
 */
const SECTION_SMOOTHING = 2;

/** `section` averaged over a box 2·`radius` + 1 samples wide, keeping its darkness; a clean edge's half crossing stays. */
function smoothedSection(section: Float64Array, radius: number): Float64Array {
  if (radius < 1) return section;
  return section.map((_, i) => {
    let sum = 0;
    for (let j = i - radius; j <= i + radius; j++) sum += section[Math.min(section.length - 1, Math.max(0, j))];
    return sum / (2 * radius + 1);
  });
}

/**
 * Where `section` first reaches `level` walking in from `from` toward `toward` (its middle), px out from the middle;
 * 0 where it never does, its paint ending at the centreline.
 */
function outerCrossing(section: Float64Array, from: number, toward: number, level: number, across: number): number {
  const direction = Math.sign(toward - from);
  for (let i = from + direction; i !== toward + direction; i += direction) {
    if (section[i] < level) continue;
    const outside = section[i - direction], k = (section[i] - level) / (section[i] - outside);
    return (Math.abs(toward - i) + k) * across;
  }
  return 0;
}

/** Each heading's value per side, px: left and right of the stroke, 0 to STAMP_BRUSH_PROFILE_HEADINGS - 1. */
export type StampProbeSides = { left: number[]; right: number[] };

/** Visible offsets by heading, and how far each could stray from a fresh measurement of it (its standard error), px. */
export type StampProbeEdge = StampProbeSides & { noise: StampProbeSides };

/** The standard error of readings' centre, from their spread; 0 for fewer than two. */
function standardError(readings: readonly number[]): number {
  const n = readings.length;
  if (n < 2) return 0;
  const mean = readings.reduce((sum, v) => sum + v, 0) / n;
  return Math.sqrt(readings.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1) / n);
}

/**
 * Each heading's visible offsets at a diameter, px: where its sections, averaged over every window and seed of it
 * and smoothed, first reach half their mean near the centreline, walking in. Pooled before it's read, a streak near
 * that level reads once, not by seed. Noise: the standard error of each window read alone.
 */
export function stampProbeEdgeOffsets(sheet: StampEdgeProbeSheet, read: readonly StampProbeSections[]): StampProbeEdge {
  const steps = 2 * Math.round(sheet.reach / sheet.across), middle = steps / 2, band = Math.max(1, Math.round(sheet.diameter / 8 / sheet.across));
  const smoothing = Math.round(Math.min(SECTION_SMOOTHING, sheet.diameter / 4) / 2 / sheet.across);
  const centreOf = (section: ArrayLike<number>) => {
    let sum = 0;
    for (let i = middle - band; i <= middle + band; i++) sum += section[i];
    return sum / (2 * band + 1);
  };
  // Each window's stations averaged into one section, by heading; a station's crop ends are kept to check its reach.
  const windows = Array.from({ length: STAMP_BRUSH_PROFILE_HEADINGS }, (): Float64Array[] => []);
  const ends = Array.from({ length: STAMP_BRUSH_PROFILE_HEADINGS }, () => 0);
  for (const { probe, sections } of read) {
    const mean = new Float64Array(steps + 1), heading = sheet.probes[probe].heading;
    for (const section of sections) {
      ends[heading] = Math.max(ends[heading], section[0], section[steps]);
      for (let i = 0; i <= steps; i++) mean[i] += section[i] / sections.length;
    }
    windows[heading].push(mean);
  }
  const all = windows.flat(), shown = all.reduce((sum, w) => sum + centreOf(w), 0) / all.length;
  if (!(shown >= STAMP_PROBE_VISIBLE_CONTRAST)) {
    throw new StampBrushProbeRefusal(`its stroke shows no visible paint along its centre at ${sheet.diameter} px (ΔE ${shown.toFixed(2)}, under ${STAMP_PROBE_VISIBLE_CONTRAST})`);
  }
  const headings = windows.map((own, heading) => {
    const pooled = new Float64Array(steps + 1);
    for (const w of own) for (let i = 0; i <= steps; i++) pooled[i] += w[i] / own.length;
    const level = 0.5 * centreOf(pooled);
    if (!(level > 0)) throw new StampBrushProbeRefusal(`its stroke lays nothing along its centre at ${sheet.diameter} px`);
    if (ends[heading] >= level) throw new StampBrushProbeRefusal(`its paint reaches past ${sheet.reach} px from the stroke, its probe's crop`);
    const sides = (section: Float64Array) => ({ left: outerCrossing(section, 0, middle, level, sheet.across), right: outerCrossing(section, steps, middle, level, sheet.across) });
    const reads = own.map((w) => sides(smoothedSection(w, smoothing))), { left, right } = sides(smoothedSection(pooled, smoothing));
    return { left, right, noise: { left: standardError(reads.map((r) => r.left)), right: standardError(reads.map((r) => r.right)) } };
  });
  return {
    left: headings.map((h) => h.left), right: headings.map((h) => h.right),
    noise: { left: headings.map((h) => h.noise.left), right: headings.map((h) => h.noise.right) },
  };
}

const rounded = (px: number) => Math.round(px / STAMP_BRUSH_PROFILE_PRECISION) * STAMP_BRUSH_PROFILE_PRECISION;

/** An edge's largest standard error over its headings and sides, px, to a hundredth: what its collapse is judged by. */
export const stampBrushEdgeNoise = (noise: StampProbeSides) => Math.round(100 * Math.max(...noise.left, ...noise.right)) / 100;

/**
 * Offsets as a profile keeps them, rounded: one, their median, at every heading and side where they spread no more
 * than the tolerance or twice their noisiest standard error (the seeds' randomness, not the tip's shape); else each.
 */
export function stampBrushEdgeSample({ left, right, noise }: StampProbeEdge): StampBrushEdgeSample {
  const all = [...left, ...right], alike = Math.max(STAMP_BRUSH_PROFILE_TOLERANCE, 2 * stampBrushEdgeNoise(noise));
  return Math.max(...all) - Math.min(...all) <= alike ? stampBrushEvenEdge(rounded(median(all))) : { left: left.map(rounded), right: right.map(rounded) };
}

/**
 * How far apart, px, two readings of an offset at `diameter` may lie and still read as one: the tolerance, or a
 * hundredth of a large diameter, past the precision its paper's grain leaves it.
 */
const probeTolerance = (diameter: number) => Math.max(STAMP_BRUSH_PROFILE_TOLERANCE, REFINE_SHARE * diameter);

/**
 * Whether `edge`, read from the first seed alone, is as good as all of them: its noise so small that the rest would
 * move no offset past the tolerance at REFINE_NOISE standard errors. A smooth tip settles at once; a ragged one needs every seed.
 */
export const stampEdgeProbeSeedsSettle = (edge: StampMeasuredEdge) =>
  Math.max(...edge.noise.left, ...edge.noise.right) * REFINE_NOISE <= probeTolerance(edge.diameter);

/** Offsets by heading, measured at a diameter, with their noise. */
export type StampMeasuredEdge = StampProbeEdge & { diameter: number };

/**
 * A brush's supported range: the widest unbroken run of `planned` (rising) diameters it paints a line at, each
 * measured by `measure`, with a midpoint wherever interpolating its neighbours misses it past probeTolerance and the
 * noise, down to 2 px apart. A refusal, a midpoint's too, bounds a run, never a hole inside one: consumers interpolate
 * anywhere within the range.
 */
export async function refineStampBrushEdges<M extends StampMeasuredEdge>(planned: readonly number[], measure: (diameter: number) => Promise<M>): Promise<M[]> {
  const measured = (diameter: number) => measure(diameter).catch((cause: unknown) => {
    if (!(cause instanceof StampBrushProbeRefusal)) throw cause;
    return cause;
  });
  type Reading = M | StampBrushProbeRefusal;
  // Rising: past a diameter too large to probe, every larger one is too.
  const measureFrom = async (i: number, done: Reading[]): Promise<Reading[]> => {
    if (i === planned.length) return done;
    const next = await measured(planned[i]);
    return next instanceof StampBrushProbeTooLarge ? [...done, next] : measureFrom(i + 1, [...done, next]);
  };
  // `above` is the miss that asked for this midpoint: a bend's shrinks at least by half each halving (a quarter where
  // it's smooth, a half at a kink), so a miss that doesn't is the brush's randomness, and no denser sampling helps.
  const between = async (a: M, b: M, above = Infinity): Promise<Reading[]> => {
    if (b.diameter - a.diameter <= 2) return [];
    const mid = await measured((a.diameter + b.diameter) / 2), k = 0.5;
    if (mid instanceof StampBrushProbeRefusal) return [mid];
    const tolerance = probeTolerance(mid.diameter);
    const misses = (['left', 'right'] as const).flatMap((side) => mid[side].map((v, i) => {
      const noise = Math.hypot(mid.noise[side][i], (1 - k) * a.noise[side][i], k * b.noise[side][i]);
      const miss = Math.abs(v - (a[side][i] + (b[side][i] - a[side][i]) * k));
      return miss > Math.max(tolerance, REFINE_NOISE * noise) ? miss : 0;
    }));
    const miss = Math.max(...misses);
    if (!miss) return [];
    if (miss > REFINE_SHRINK * above) return [mid];
    return [...await between(a, mid, miss), mid, ...await between(mid, b, miss)];
  };
  const readings = await measureFrom(0, []);
  // Only the widest planned run is refined; a midpoint refused within it splits it, and the widest part is kept.
  const widest = widestStampMeasuredRun(readings);
  const refined = await widest.reduce<Promise<Reading[]>>(async (done, edge, i) => [...await done, ...(i ? await between(widest[i - 1], edge) : []), edge], Promise.resolve([]));
  const range = widestStampMeasuredRun(refined);
  if (range.length) return range;
  const refusals = readings.filter((reading) => reading instanceof StampBrushProbeRefusal);
  const why = refusals.findLast((refusal) => !(refusal instanceof StampBrushProbeTooLarge)) ?? refusals[0];
  const painted = readings.flatMap((reading) => (reading instanceof StampBrushProbeRefusal ? [] : [reading.diameter]));
  throw new StampBrushProbeRefusal(`it paints a line at ${painted.length ? `only ${painted.join(', ')} px` : 'no diameter'} of ${planned.join(', ')}${why ? `: ${why.message}` : ''}`);
}

/**
 * The widest run of `readings` (rising) unbroken by a refusal, by its top diameter over its bottom, the larger on a
 * tie; none where no run holds two.
 */
function widestStampMeasuredRun<M extends StampMeasuredEdge>(readings: readonly (M | StampBrushProbeRefusal)[]): M[] {
  const runs: M[][] = [[]];
  for (const reading of readings) {
    if (reading instanceof StampBrushProbeRefusal) runs.push([]);
    else runs.at(-1)!.push(reading);
  }
  return runs.filter((run) => run.length >= 2).reduce<M[]>((best, run) => (!best.length || measuredRunSpan(run) >= measuredRunSpan(best) ? run : best), []);
}

/** A run's top diameter over its bottom. */
const measuredRunSpan = (run: readonly StampMeasuredEdge[]) => run.at(-1)!.diameter / run[0].diameter;
