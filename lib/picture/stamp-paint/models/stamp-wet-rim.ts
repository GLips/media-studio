// stamp-wet-rim.ts: the drying rim. As a wash dries, water evaporates fastest at its edge and capillary flow carries
// loose pigment out to replace it, so a dried wash keeps a thin, darker line along its edge and a paler band inside
// it. A wash rims at each drying (a wait('dry'), and its end), the paint wetted since the last as one domain
// (studio/stamp-wet-rim.ts): along its paint's edge, closed over the paper's grain, where that edge is abrupt. The
// law is WGSL; the band's size is worked out on the CPU too, to size the stage's kernels.
//
// Negative space: a wait for 'damp' or for seconds doesn't rim, though paper left long enough dries; a drying is
// what the author names.

import { STAMP_WET_CELL, stampWetGrid, type StampWetness } from './stamp-wetness.ts';
import type { CompiledStampDeposit, CompiledStampPass } from './stamp-paint-recipe-compile.ts';
import { stampGridLocalMax, type StampGrid } from './stamp-region.ts';

/** The widest band a rim draws pigment from, px: past it the kernels' taps grow and a real rim's band is no wider. */
export const STAMP_DRYING_RIM_MOST_BAND = 32;

/**
 * The most of its open pigment a pixel in the band gives up to the rim, where the wash was a standing puddle of paint
 * that spreads freely. Staining holds none back: a stain's fine particles travel to a rim as readily as any.
 */
export const STAMP_DRYING_RIM_MOST_TAKE = 0.22;

/**
 * The medium's `spread` (brush diameters paint runs on flooded paper) from which its paint is free enough for a rim
 * to take STAMP_DRYING_RIM_MOST_TAKE: watercolour (0.5) gives up nearly that, gouache (0.1) a sixth of it.
 */
export const STAMP_DRYING_RIM_FREE_SPREAD = 0.6;

/**
 * How wide a wash's rim band is, px: as far as its medium's paint spreads by itself (`spread`, in diameters of the
 * wash's brushes), as far above damp as the paper was wet (`wetShare`, 0..1), at most STAMP_DRYING_RIM_MOST_BAND.
 */
export function stampDryingRimBand(spread: number, diameter: number, wetShare: number): number {
  return Math.min(STAMP_DRYING_RIM_MOST_BAND, spread * diameter * Math.min(1, Math.max(0, wetShare)));
}

/** How far above damp paper wetted to `wettest` was, 0 (damp or drier) to 1 (a standing wash): what makes a rim. */
export const stampDryingRimWetShare = (wettest: number, damp: number) => Math.min(1, Math.max(0, (wettest - damp) / Math.max(1e-3, 1 - damp)));

/**
 * One drying of a wash: the deposits laid since its last wait('dry'), which dry, and rim, as one. `id` names it in
 * its wash, seeding its rim: the wash's own ID for its first. `rim`: how strongly it gathers pigment, 0..2, its
 * wait's, else its wash's, else 1.
 */
export type StampWashDrying = { pass: CompiledStampPass; id: string; deposits: readonly CompiledStampDeposit[]; rim: number };

const washDryings = new WeakMap<CompiledStampPass, readonly StampWashDrying[]>();

/**
 * `pass`'s dryings in painting order, the same objects every call: one per wait('dry') with deposits laid before it
 * and one at the wash's end with any after the last. None for a dry pass.
 */
export function stampWashDryings(pass: CompiledStampPass): readonly StampWashDrying[] {
  if (pass.kind !== 'wash') return [];
  const known = washDryings.get(pass);
  if (known) return known;
  const dryings: StampWashDrying[] = [];
  let deposits: CompiledStampDeposit[] = [];
  const washRim = pass.wash.rim ?? 1;
  const dry = (rim: number) => {
    if (deposits.length) dryings.push({ pass, id: dryings.length ? `${pass.id}|dry${dryings.length}` : pass.id, deposits, rim });
    deposits = [];
  };
  for (const step of pass.wash.schedule) {
    if (step.kind === 'deposit') deposits.push(step.deposit);
    else if (step.until === 'dry') dry(step.rim ?? washRim);
  }
  dry(washRim);
  washDryings.set(pass, dryings);
  return dryings;
}

/**
 * The wettest each point of the lattice got over `drying`, over the windows its deposits' landings cover, or null for
 * a drying that landed nothing. Each point reads the wettest within a cell and a half, as a footprint averaged onto
 * the lattice dilutes the points along a wash's edge, where its rim is.
 */
export function stampDryingWettest(drying: Pick<StampWashDrying, 'deposits'>, wetness: StampWetness): StampGrid | null {
  const landings = drying.deposits.flatMap((deposit) => wetness.landings.get(deposit) ?? []);
  if (!landings.length) return null;
  const grids = landings.flatMap(({ before, after }) => [stampWetGrid(before, 'wetness'), stampWetGrid(after, 'wetness')]);
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  for (const g of grids) {
    i0 = Math.min(i0, g.x0 / STAMP_WET_CELL);
    j0 = Math.min(j0, g.y0 / STAMP_WET_CELL);
    i1 = Math.max(i1, g.x0 / STAMP_WET_CELL + g.columns);
    j1 = Math.max(j1, g.y0 / STAMP_WET_CELL + g.rows);
  }
  const columns = i1 - i0, rows = j1 - j0, values = new Float32Array(columns * rows);
  for (const g of grids) {
    const di = g.x0 / STAMP_WET_CELL - i0, dj = g.y0 / STAMP_WET_CELL - j0;
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.columns; i++) {
        const k = (dj + j) * columns + di + i;
        values[k] = Math.max(values[k], g.values[j * g.columns + i]);
      }
    }
  }
  return stampGridLocalMax({ x0: i0 * STAMP_WET_CELL, y0: j0 * STAMP_WET_CELL, cell: STAMP_WET_CELL, columns, rows, values }, STAMP_WET_CELL * 1.5);
}

/**
 * The rim at a pixel `x` px in from where its line starts (where the paint at the edge is half there, plus a wavering
 * inset). WetShare and band twin the CPU helpers.
 */
export const STAMP_DRYING_RIM_WGSL = /* wgsl */ `
fn dryingRimWetShare(wettest: f32, damp: f32) -> f32 { return clamp((wettest - damp) / max(1e-3, 1.0 - damp), 0.0, 1.0); }
fn dryingRimBand(spread: f32, diameter: f32, wetShare: f32) -> f32 {
  return min(${STAMP_DRYING_RIM_MOST_BAND.toFixed(1)}, spread * diameter * clamp(wetShare, 0.0, 1.0));
}
// Its share of the gathered pigment: most on the line's outer edge, crisp outside it and fading in.
fn dryingRimLine(x: f32, width: f32) -> f32 {
  return select(exp(-x * x / 0.5), exp(-x / max(width, 0.5)), x >= 0.0);
}
// The share it gives up, about evenly over the band, so the inside pales without a pale stripe of its own: none on
// the line (\`near\`, how far inside the line's start, read finely by the edge) and fading out by the band's end
// (\`far\`, read by the nearest edge).
fn dryingRimDraw(near: f32, far: f32, band: f32, width: f32) -> f32 {
  let y = clamp(far / max(band, 1.0), 0.0, 1.0);
  return smoothstep(width, 3.0 * width, near) * (1.0 - y * y);
}
// Whether the line is there at all, from two noises along the edge, so it breaks into islands.
fn dryingRimPresence(broad: f32, fine: f32) -> f32 {
  return smoothstep(0.3, 0.55, 0.7 * broad + 0.3 * fine);
}
// How abruptly the paint ends: a feathered fringe doesn't rim.
fn dryingRimHardness(edge: f32, inner: f32) -> f32 {
  return smoothstep(0.3, 0.7, edge / max(inner, 1e-3));
}
// Whether a pixel stands where the paint has risen to its level (\`near\`, round it, against \`further\` round it).
fn dryingRimSteep(near: f32, further: f32) -> f32 {
  return smoothstep(0.6, 0.9, near / max(further, 1e-3));
}
// The share of its open pigment a band pixel can give up, by how freely its medium's paint runs (spread, in
// diameters, mapped linearly up to STAMP_DRYING_RIM_FREE_SPREAD), how wet the wash was and the line's strength here.
fn dryingRimMobility(spread: f32) -> f32 {
  return ${STAMP_DRYING_RIM_MOST_TAKE.toFixed(3)} * clamp(spread / ${STAMP_DRYING_RIM_FREE_SPREAD.toFixed(3)}, 0.0, 1.0);
}
fn dryingRimTake(spread: f32, wetShare: f32, strength: f32) -> f32 {
  return dryingRimMobility(spread) * clamp(wetShare, 0.0, 1.0) * clamp(strength, 0.0, 1.0);
}
// Every pixel gives up \`take\` of its amounts, spread over the line within reach as its kernel and the line weigh it
// (normalised per giver), so a pixel on the line gains \`line\` times the gathered \`pulled\`: pigment is conserved,
// and with take <= 1 none goes negative; the max only holds f16 rounding.
fn dryingRimExchange(was: vec4f, take: f32, line: f32, pulled: vec4f) -> vec4f {
  return max(was * (1.0 - clamp(take, 0.0, 1.0)) + line * pulled, vec4f(0.0));
}`;
