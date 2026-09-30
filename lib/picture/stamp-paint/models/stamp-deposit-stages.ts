// stamp-deposit-stages.ts: how a deposit's coverage is built and resolved, as tables the GPU renderer
// (stamp-paint-renderer.ts) generates its code from. What each accumulation does as a stamp lands and how it resolves;
// which stages run, in which order; which of a brush's layers' stages are active; how far a stamp's blur reaches up
// its tip's mips; and how the GPU lays a layer's stamps, by fixed blend or in order. An accumulation's lay and resolve
// are WGSL, held to their accepted output by the GPU gate (docs/brush-engine.md).

import { stampDualBeforeGrain, stampWgslSwitch } from './coverage-formulas.ts';
import type { StampAccumulation, StampBrush, StampBrushBurntEdge, StampBrushGrain, StampBrushLayer, StampBrushWetEdges, StampDualBlend } from './stamp-brush.ts';

/** Mip levels a stamp's full blur (1) reads above its own: four is a sixteenth of its size. */
export const STAMP_BLUR_LEVELS = 4;

/** A stamp lays `laid` × its `opacity` over what's `built`, toward full paint: the same whatever order stamps land in. */
const layTowardFull = 'built + laid * opacity * (1.0 - built)';

/**
 * What each accumulation does (StampAccumulation says why). `lay`: the build after one stamp. `towardFull`: paint ×
 * opacity toward full; else toward its own opacity. `keepsCap`: the densest stamp and cap are kept beside the build.
 * `resolve`: the stroke from what was kept. Each is a WGSL expression over those names.
 */
export const STAMP_ACCUMULATIONS = {
  glaze: {
    towardFull: true, keepsCap: true, lay: layTowardFull,
    // Its densest stamp built toward the build held under its cap, as far as its `build` says.
    resolve: 'mix(densest, min(built, cap), build)',
  },
  build: { towardFull: true, keepsCap: false, lay: layTowardFull, resolve: 'built' },
  buildToOpacity: {
    towardFull: false, keepsCap: false,
    // Never lowers: in Photoshop's probes (fade opacity 40, fade opacity 130 minimum 20 flow 50) a fainter stamp
    // leaves the paint a stronger one built where it lands.
    lay: 'select(built, built + laid * (opacity - built), opacity > built)',
    resolve: 'built',
  },
} satisfies Record<StampAccumulation['kind'], { towardFull: boolean; keepsCap: boolean; lay: string; resolve: string }>;

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
  Object.values(STAMP_ACCUMULATIONS).map(({ lay }) => `return ${lay};`),
);

/**
 * How the GPU lays a layer's stamps. `fixedBlend`: by the blend B ← lerp(B, toward, t), equal to `lay` wherever
 * order can't matter: toward full, or toward an opacity that never falls, so B never exceeds the opacity arriving.
 * `ordered`: each pixel walks its stamps in order, laying each by `lay`, for a falling opacity the blend would
 * lower.
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
  Object.values(STAMP_ACCUMULATIONS).map(({ resolve }) => `return ${resolve};`),
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

const STAMP_RESOLVE_STAGES = STAMP_RESOLVE_PLANS.grainFirst;
/**
 * Every order the GPU can resolve a deposit's stages in: each plan's, and the others, which only a diagnosis asks for
 * (a probe scored under another order). Every stage runs in each; one that does nothing to a brush is skipped there.
 */
export const STAMP_RESOLVE_ORDERS: readonly (readonly StampResolveStage[])[] = [
  STAMP_RESOLVE_PLANS.grainFirst, STAMP_RESOLVE_PLANS.dualFirst,
  ['grain', 'pooling', 'dual'], ['dual', 'pooling', 'grain'], ['pooling', 'grain', 'dual'], ['pooling', 'dual', 'grain'],
];

/** An order's case in the WGSL of stampResolveOrdersWgsl; throws on a list that isn't every stage once. */
export function stampResolveOrderIndex(order: readonly StampResolveStage[]): number {
  const index = STAMP_RESOLVE_ORDERS.findIndex((known) => known.join() === order.join());
  if (index < 0) throw new Error(`stamp paint: ${JSON.stringify(order.join(','))} isn't an order of the resolve's stages: it names each of ${STAMP_RESOLVE_STAGES.join(', ')} once`);
  return index;
}

/**
 * WGSL function `name(coverage, …params, order: i32) -> f32` running the stages in each order of
 * STAMP_RESOLVE_ORDERS, from `stages`, a statement each that moves `m`, with `after(k)` after the k-th (from 1): so
 * the orders the GPU runs and the one a diagnosis traces are one code.
 */
export function stampResolveOrdersWgsl(name: string, params: string, stages: Record<StampResolveStage, string>, after: (position: number) => string): string {
  return stampWgslSwitch(name, `coverage: f32, ${params}, order: i32`, 'f32', 'order', STAMP_RESOLVE_ORDERS.map((order) =>
    ['var m = coverage;', ...order.map((stage, k) => `${stages[stage]} ${after(k + 1)}`), 'return m;'].join(' ')));
}

type CanvasGrain<Image> = Extract<StampBrushGrain<Image>, { kind: 'canvas' }>;
type RollingGrain<Image> = Extract<StampBrushGrain<Image>, { kind: 'rolling' }>;

/**
 * A layer's stages that do something, each left out when it does nothing: a grain at depth 0 (but a relief), a rim of 0, a burnt
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
  // A texture's height relief holds its depth inside its formula: at depth 0 it takes all the paint, as Photoshop's does.
  const relief = grain?.blend.family === 'texture' && (grain.blend.mode === 'height' || grain.blend.mode === 'linearHeight');
  const cuts = grain && (grain.depth > 0 || relief) ? grain : undefined;
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
 * Which stages of `brush`'s main layer and its dual's are active at the deposit's `diameter`. `edgeSigma` is the blur
 * a layer's rim or burnt edge stands above (the widest active edge, a share of the stamp's radius), 0 when neither
 * layer has one.
 */
export function stampActiveLayers<Image>(brush: StampBrush<Image>, diameter: number) {
  const main = activeLayer(brush, diameter), dual = brush.dual && activeLayer(brush.dual, diameter * brush.dual.scale);
  const widths = [main, dual].flatMap((layer) => [layer?.rim?.width ?? 0, layer?.burntEdge?.width ?? 0]);
  const edged = [main, dual].some((layer) => layer?.rim || layer?.burntEdge);
  return { main, dual, edgeSigma: edged ? Math.max(1, Math.max(...widths) * diameter / 2) : 0 };
}
