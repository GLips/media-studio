// shot-slices.ts: slices, a built-in effect (shot-effect.ts): plane px cut into rows or square cells, a seeded share
// of them each moved by whole px, and each cell showing one of the effect's inputs, so two looks of one subject tile
// together. The cells are the plane's, not the subject's, and the seed alone decides them: a frame renders the same
// whatever was drawn before it. Its studio half is shot-slices-gpu.ts, which draws each cell as shotSlicesCell says.

import { defineShotEffect, type ShotEffectProblem } from './shot-effect.ts';

/**
 * Slices' parameters: `cells`, rows across the plane or square cells; `size`, a row's height or a cell's side,
 * plane px; `shift`, the most whole px a moved cell moves (a row only across); `share`, how many cells move, 0..1;
 * `seed`, which cells, how far and showing which input.
 */
export type ShotSlicesParams = { readonly cells: 'rows' | 'rects'; readonly size: number; readonly shift: number; readonly share: number; readonly seed: number };

const DEFAULTS: ShotSlicesParams = { cells: 'rows', size: 12, shift: 24, share: 0.5, seed: 1 };

/** Below this, a seed is a whole number a float uniform carries exactly. */
const SEED_MOST = 2 ** 24;

/**
 * `source` cut and moved, or several inputs tiled and moved, each cell showing one:
 * `shotPlace(slices({ source: watercolour, second: crayon }, { cells: 'rects', size: 24, shift: 16, share: 0.3 }), { id, depth })`.
 */
export const slices = defineShotEffect({
  name: 'slices',
  inputs: ['source', 'second', 'third', 'fourth'],
  optional: ['second', 'third', 'fourth'],
  defaults: DEFAULTS,
  problems: ({ cells, size, shift, share, seed }) => {
    const problems: ShotEffectProblem[] = [];
    if (cells !== 'rows' && cells !== 'rects') problems.push({ field: 'cells', message: `${String(cells)} isn't rows or rects` });
    if (!(Number.isInteger(size) && size >= 1)) problems.push({ field: 'size', message: `${size} isn't a whole number of px from 1` });
    if (!(Number.isInteger(shift) && shift >= 0)) problems.push({ field: 'shift', message: `${shift} isn't a whole number of px from 0` });
    if (!(share >= 0 && share <= 1)) problems.push({ field: 'share', message: `${share} isn't within 0..1` });
    if (!(Number.isInteger(seed) && seed >= 0 && seed < SEED_MOST)) problems.push({ field: 'seed', message: `${seed} isn't a whole number from 0 below ${SEED_MOST}` });
    return problems;
  },
  // Each input given, once, unmoved: the studio half moves each cell's read.
  reads: (_, given) => given.map((input) => ({ input })),
  grow: ({ shift }) => shift,
});

// ---- the cells, as the studio half draws them ------------------------------------------------------------------------

/** PCG's output hash over u32 (Jarzynski and Olano, 2020), as the studio half's WGSL computes it, bit for bit. */
export const SHOT_SLICES_HASH_WGSL = /* wgsl */ `
fn shotSlicesHash(v: u32) -> u32 {
  let h = v * 747796405u + 2891336453u;
  let w = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return (w >> 22u) ^ w;
}`;

function hash(v: number) {
  const h = (Math.imul(v, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((h >>> ((h >>> 28) + 4)) ^ h) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/** Slices' share as the studio half compares it: a cell moves when its draw's top 16 bits fall below this. */
export const shotSlicesShareCut = (share: number) => Math.round(share * 65536);

/** The cell plane px `x`, `y` lie in: a row's index alone, or a square's column and row. */
export const shotSlicesCellAt = ({ cells, size }: ShotSlicesParams, x: number, y: number): readonly [number, number] =>
  [cells === 'rows' ? 0 : Math.floor(x / size), Math.floor(y / size)];

/**
 * What cell `cell` shows: the index of the input it reads, of `inputs` given, and how far it moves it, whole plane
 * px. The studio half's `shotSlicesCell` is this, in WGSL.
 */
export function shotSlicesCell({ cells, shift, share, seed }: ShotSlicesParams, inputs: number, [cx, cy]: readonly [number, number]) {
  const base = hash((seed ^ hash((cx >>> 0) ^ hash(cy >>> 0))) >>> 0);
  const draw = (k: number) => hash((base + k) >>> 0), span = 2 * shift + 1;
  const moved = draw(0) >>> 16 < shotSlicesShareCut(share);
  const shifted: readonly [number, number] = moved ? [(draw(1) % span) - shift, cells === 'rows' ? 0 : (draw(2) % span) - shift] : [0, 0];
  return { input: draw(3) % inputs, shift: shifted };
}
