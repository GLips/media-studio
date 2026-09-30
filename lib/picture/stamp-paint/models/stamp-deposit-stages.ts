// stamp-deposit-stages.ts: how a deposit's coverage is built and resolved, as tables both renderers read: the GPU
// renderer (stamp-paint-renderer.ts) and the CPU reference (stamp-reference-deposit.ts). What each accumulation does
// as a stamp lands and how it resolves; which stages run, in which order (a plan both renderers walk, the GPU's code
// generated from it); which of a brush's layers' stages are active; and how far a stamp's blur reaches up its tip's
// mips; and how the GPU lays a layer's stamps, by fixed blend or in order. An accumulation's lay and resolve are CPU
// and WGSL pairs written side by side, held together by the formulas command (docs/brush-engine.md).

import { stampDualBeforeGrain, stampWgslSwitch } from './coverage-formulas.ts';
import type { StampAccumulation, StampBrush, StampBrushBurntEdge, StampBrushGrain, StampBrushLayer, StampBrushWetEdges, StampDualBlend } from './stamp-brush.ts';

/** Mip levels a stamp's full blur (1) reads above its own: four is a sixteenth of its size. */
export const STAMP_BLUR_LEVELS = 4;

/** A stamp lays `laid` × its `opacity` over what's `built`, toward full paint: the same whatever order stamps land in. */
const layTowardFull = {
  cpu: (built: number, laid: number, opacity: number) => built + laid * opacity * (1 - built),
  wgsl: 'built + laid * opacity * (1.0 - built)',
};

/** What a stroke's build holds after its last stamp, per pixel: the build, and a glaze's densest stamp and cap. */
export type StampAccumulationKept = { built: number; densest: number; cap: number };

/**
 * What each accumulation does (StampAccumulation says why). `lay` is the build after one stamp: `built` so far, the
 * stamp's paint `laid` and its `opacity`. `towardFull`: it lays paint × opacity toward full; else its paint toward
 * its own opacity. `keepsCap`: the densest stamp and the cap are kept beside the build. `resolve` is the stroke from
 * what the build kept, `build` a glaze's own. `lay` and `resolve` are each a CPU function and a WGSL expression over
 * the same names.
 */
export const STAMP_ACCUMULATIONS = {
  glaze: {
    towardFull: true, keepsCap: true, lay: layTowardFull,
    // Its densest stamp built toward the build held under its cap, as far as its `build` says.
    resolve: { cpu: ({ built, densest, cap }: StampAccumulationKept, build: number) => densest + (Math.min(built, cap) - densest) * build, wgsl: 'mix(densest, min(built, cap), build)' },
  },
  build: { towardFull: true, keepsCap: false, lay: layTowardFull, resolve: { cpu: ({ built }: StampAccumulationKept) => built, wgsl: 'built' } },
  buildToOpacity: {
    towardFull: false, keepsCap: false,
    // Never lowers: in Photoshop's probes (fade opacity 40, fade opacity 130 minimum 20 flow 50) a fainter stamp
    // leaves the paint a stronger one built where it lands.
    lay: { cpu: (built: number, laid: number, opacity: number) => (opacity > built ? built + laid * (opacity - built) : built), wgsl: 'select(built, built + laid * (opacity - built), opacity > built)' },
    resolve: { cpu: ({ built }: StampAccumulationKept) => built, wgsl: 'built' },
  },
} satisfies Record<StampAccumulation['kind'], {
  towardFull: boolean; keepsCap: boolean;
  lay: { cpu: (built: number, laid: number, opacity: number) => number; wgsl: string };
  resolve: { cpu: (kept: StampAccumulationKept, build: number) => number; wgsl: string };
}>;

/** Every accumulation, in the table's order. */
// SAFETY: the table `satisfies` a record over exactly StampAccumulation['kind'], so its keys are those kinds.
export const STAMP_ACCUMULATION_KINDS = Object.keys(STAMP_ACCUMULATIONS) as StampAccumulation['kind'][];
/** An accumulation's case in `accumulationLay` and `accumulationResolve`, the WGSL switches over the table. */
export const stampAccumulationIndex = (kind: StampAccumulation['kind']) => STAMP_ACCUMULATION_KINDS.indexOf(kind);
/** A glaze's `build`, which its resolve reads; 0 for the others, which read none. */
export const stampAccumulationBuild = (accumulation: StampAccumulation) => (accumulation.kind === 'glaze' ? accumulation.build : 0);
/** The table's lays in WGSL, by the accumulation's index. */
export const STAMP_ACCUMULATION_LAY_WGSL = stampWgslSwitch(
  'accumulationLay', 'built: f32, laid: f32, opacity: f32, kind: i32', 'f32', 'kind',
  Object.values(STAMP_ACCUMULATIONS).map(({ lay }) => `return ${lay.wgsl};`),
);

/**
 * How the GPU lays a layer's stamps. `fixedBlend`: by the blend B ← lerp(B, toward, t), stamp after stamp, which is
 * the accumulation's `lay` wherever their order can't matter: toward full paint, or toward an opacity no stamp brings
 * less of than one before it, so B never stands above the opacity arriving. `ordered`: each pixel walks its stamps in
 * order and lays each by `lay`, for an opacity that falls, where the blend would lower the paint.
 */
export type StampAccumulationPlan = { kind: 'fixedBlend'; toward: 'full' | 'opacity' } | { kind: 'ordered' };

/** How the GPU lays `stamps` under `accumulation`: ordered only where the blend can't lay what `lay` does. */
export function stampAccumulationPlan(accumulation: StampAccumulation, stamps: readonly { opacity: number }[]): StampAccumulationPlan {
  if (STAMP_ACCUMULATIONS[accumulation.kind].towardFull) return { kind: 'fixedBlend', toward: 'full' };
  const falls = stamps.some((stamp, i) => i > 0 && stamp.opacity < stamps[i - 1].opacity);
  return falls ? { kind: 'ordered' } : { kind: 'fixedBlend', toward: 'opacity' };
}
/** The table's resolves in WGSL, by the accumulation's index. */
export const STAMP_ACCUMULATION_RESOLVE_WGSL = stampWgslSwitch(
  'accumulationResolve', 'built: f32, densest: f32, cap: f32, build: f32, kind: i32', 'f32', 'kind',
  Object.values(STAMP_ACCUMULATIONS).map(({ resolve }) => `return ${resolve.wgsl};`),
);

/** The stages after the stamps have built, each on the coverage the one before it left. */
export type StampResolveStage = 'grain' | 'dual' | 'pooling';

/**
 * The orders a brush's stages run in: the canvas grain cuts the built stroke, then the dual combines, then the whole
 * pools, as Photoshop's captures show; a dual that shapes where the stamps' paint lies (stampDualBeforeGrain) first.
 */
export const STAMP_RESOLVE_PLANS = {
  grainFirst: ['grain', 'dual', 'pooling'],
  dualFirst: ['dual', 'grain', 'pooling'],
} as const satisfies Record<string, readonly StampResolveStage[]>;
export type StampResolvePlan = keyof typeof STAMP_RESOLVE_PLANS;

export const stampResolvePlan = (dual?: { blend: StampDualBlend }): StampResolvePlan => (dual && stampDualBeforeGrain(dual.blend) ? 'dualFirst' : 'grainFirst');
const RESOLVE_PLANS = Object.keys(STAMP_RESOLVE_PLANS);
/** A plan's case in the WGSL generated by stampResolvePlansWgsl. */
export const stampResolvePlanIndex = (plan: StampResolvePlan) => RESOLVE_PLANS.indexOf(plan);

/**
 * WGSL function `name(coverage, …params, plan: i32) -> f32` running each plan's stages in its order, from `stages`, a
 * statement each that moves `m`: so the GPU runs the orders this table lists, and a plan added here is a case there.
 */
export function stampResolvePlansWgsl(name: string, params: string, stages: Record<StampResolveStage, string>): string {
  return stampWgslSwitch(name, `coverage: f32, ${params}, plan: i32`, 'f32', 'plan', Object.values(STAMP_RESOLVE_PLANS).map((order) =>
    ['var m = coverage;', ...order.map((stage) => stages[stage]), 'return m;'].join(' ')));
}

type CanvasGrain<Image> = Extract<StampBrushGrain<Image>, { kind: 'canvas' }>;
type RollingGrain<Image> = Extract<StampBrushGrain<Image>, { kind: 'rolling' }>;

/**
 * A layer's stages that do something, each left out when it does nothing: a grain at depth 0, a rim of 0, a burnt
 * edge of strength 0. `diameter` is its stamps' at the deposit's diameter, which its canvas grain tiles by.
 */
export type StampActiveLayer<Image> = {
  diameter: number;
  canvasGrain?: CanvasGrain<Image>;
  rollingGrain?: RollingGrain<Image>;
  rim?: Extract<StampBrushWetEdges, { kind: 'rim' }>;
  pooling?: Extract<StampBrushWetEdges, { kind: 'pooling' }>;
  burntEdge?: StampBrushBurntEdge;
};

function activeLayer<Image>(layer: StampBrushLayer<Image>, diameter: number): StampActiveLayer<Image> {
  const { grain, wetEdges, burntEdge } = layer;
  const cuts = grain && grain.depth > 0 ? grain : undefined;
  return {
    diameter,
    ...(cuts?.kind === 'canvas' && { canvasGrain: cuts }),
    ...(cuts?.kind === 'rolling' && { rollingGrain: cuts }),
    ...(wetEdges?.kind === 'rim' && wetEdges.rim > 0 && { rim: wetEdges }),
    ...(wetEdges?.kind === 'pooling' && { pooling: wetEdges }),
    ...(burntEdge && burntEdge.strength > 0 && { burntEdge }),
  };
}

/**
 * Which stages of `brush`'s main layer and its dual's are active at the deposit's `diameter`, decided once for both
 * renderers. `edgeSigma` is the blur a layer's rim or burnt edge stands above (the widest active edge, a share of the
 * stamp's radius), 0 when neither layer has one; the CPU reference paints no rims, so only the GPU reads it.
 */
export function stampActiveLayers<Image>(brush: StampBrush<Image>, diameter: number) {
  const main = activeLayer(brush, diameter), dual = brush.dual && activeLayer(brush.dual, diameter * brush.dual.scale);
  const widths = [main, dual].flatMap((layer) => [layer?.rim?.width ?? 0, layer?.burntEdge?.width ?? 0]);
  const edged = [main, dual].some((layer) => layer?.rim || layer?.burntEdge);
  return { main, dual, edgeSigma: edged ? Math.max(1, Math.max(...widths) * diameter / 2) : 0 };
}
