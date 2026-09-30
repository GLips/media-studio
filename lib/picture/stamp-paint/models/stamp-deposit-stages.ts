// stamp-deposit-stages.ts: how a deposit's coverage is built and resolved, defined once for the GPU renderer
// (stamp-paint-renderer.ts) and the CPU reference (stamp-reference-deposit.ts): what each accumulation does as a stamp
// lands, the order the stages after the build run in, and how far a stamp's blur reaches up its tip's mips.

import { stampDualBeforeGrain } from './coverage-formulas.ts';
import type { StampAccumulation, StampDualBlend } from './stamp-brush.ts';

/** Mip levels a stamp's full blur (1) reads above its own: four is a sixteenth of its size. */
export const STAMP_BLUR_LEVELS = 4;

/**
 * What each accumulation does as a stamp lands (StampAccumulation says why). `towardFull`: a stamp lays its paint ×
 * opacity toward full, else its paint toward its own opacity, never lowering what's there. `keepsCap`: the densest
 * stamp and the cap are kept beside the build, for a glaze's build to read. `lay` is the build after one stamp, as the
 * GPU's blend states work it: `built` so far, the stamp's paint `laid` and its `opacity`.
 */
export const STAMP_ACCUMULATIONS = {
  glaze: { towardFull: true, keepsCap: true, lay: (built: number, laid: number, opacity: number) => built + laid * opacity * (1 - built) },
  build: { towardFull: true, keepsCap: false, lay: (built: number, laid: number, opacity: number) => built + laid * opacity * (1 - built) },
  buildToOpacity: { towardFull: false, keepsCap: false, lay: (built: number, laid: number, opacity: number) => (opacity > built ? built + laid * (opacity - built) : built) },
} satisfies Record<StampAccumulation['kind'], { towardFull: boolean; keepsCap: boolean; lay: (built: number, laid: number, opacity: number) => number }>;

/** A glaze's stroke: its densest stamp built toward the build held under its cap, as far as its `build` says. */
export const stampGlazed = (densest: number, built: number, cap: number, build: number) => densest + (Math.min(built, cap) - densest) * build;

/** The stages after the stamps have built, each on the coverage the one before it left. */
export type StampResolveStage = 'grain' | 'dual' | 'pooling';

/**
 * The order a brush's stages run in: the canvas grain cuts the built stroke, then the dual combines, then the whole
 * pools, as Photoshop's captures show; a dual that shapes where the stamps' paint lies (stampDualBeforeGrain) first.
 */
export const stampResolveOrder = (dual?: { blend: StampDualBlend }): readonly StampResolveStage[] =>
  (dual && stampDualBeforeGrain(dual.blend) ? ['dual', 'grain', 'pooling'] : ['grain', 'dual', 'pooling']);
