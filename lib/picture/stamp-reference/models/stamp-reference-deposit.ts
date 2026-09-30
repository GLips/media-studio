// stamp-reference-deposit.ts: a deposit's coverage worked out pixel by pixel on the CPU, slowly, with every stage's
// buffer kept: the reference the GPU renderer (stamp-paint/studio/stamp-paint-renderer.ts) is held to, and where
// stages are rearranged to see which order a capture selects (vid-97). It samples tips and grains as the GPU's
// samplers do (stamp-reference-image.ts) and blends by the same definitions (stamp-paint/models/coverage-formulas.ts).
//
// Coverage only: a deposit's colour, tints, paper, protected regions, clipping and Procreate's blurred wet and burnt
// rims aren't here. Its captures are of coverage, and those stages sit after the ones in question.

import type { StampBrush, StampBrushGrain, StampBrushLayer } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { PlacedStamp } from '#lib/picture/stamp-paint/models/stamp-placement.ts';
import { stampDualBeforeGrain, stampDualCombine, stampGrainCut, stampGrainPaint, stampPooled } from '#lib/picture/stamp-paint/models/coverage-formulas.ts';
import { sampleStampReference, type StampReferenceMips } from './stamp-reference-image.ts';

/** Mip levels a stamp's full blur reads above its own, as the GPU's BLUR_LEVELS. */
const BLUR_LEVELS = 4;

/** The stages after the stamps have built, each on the coverage the one before it left. */
export type StampReferenceStage = 'grain' | 'dual' | 'pooling';

export type StampReferenceArrangement = {
  order: readonly StampReferenceStage[];
  /** Whether the deposit's opacity scales the finished coverage (`last`) or each stamp's as it builds (`inBuild`). */
  opacity: 'last' | 'inBuild';
};

/** What Photoshop's captures select: canvas texture on the built stroke, then the dual, then wet edges, then opacity. */
export const PHOTOSHOP_STAMP_ARRANGEMENT: StampReferenceArrangement = { order: ['grain', 'dual', 'pooling'], opacity: 'last' };

/** Pixels `x`, `y` up to `width` × `height`, in the painting's pixels: what a reference deposit works out. */
export type StampReferenceBox = { x: number; y: number; width: number; height: number };

export type StampReferenceDepositInput = {
  /** Its images bound to their mip chains (bindStampBrushImages). */
  brush: StampBrush<StampReferenceMips>;
  stamps: readonly PlacedStamp[];
  dualStamps: readonly PlacedStamp[];
  /** The deposit's full diameter: what its grains tile by. */
  diameter: number;
  opacity: number;
  /** Where its grains start, as shares of their tiles. */
  grainOffset: { main: readonly [number, number]; dual: readonly [number, number] };
  box: StampReferenceBox;
  arrangement?: StampReferenceArrangement;
};

/** Each buffer, row by row over the box, 0..1: the stamps as built, after each stage in order, and the result. */
export type StampReferenceDeposit = {
  box: StampReferenceBox;
  built: { main: Float32Array; dual?: Float32Array };
  stages: { stage: StampReferenceStage; coverage: Float32Array }[];
  coverage: Float32Array;
};

const turned = (x: number, y: number, angle: number): [number, number] => {
  const s = Math.sin(angle), c = Math.cos(angle);
  return [c * x - s * y, s * x + c * y];
};

type Grain = StampBrushGrain<StampReferenceMips>;
type LayerPlace = { layer: StampBrushLayer<StampReferenceMips>; diameter: number; offset: readonly [number, number] };

/** `grain`'s tile in pixels at `diameter`, across and down, and the mip level a canvas-fixed read of it takes. */
function grainTile(grain: Grain, diameter: number) {
  const image = grain.image[0], across = grain.scale * diameter;
  return { across, down: across * (image.height / image.width), lod: Math.max(0, Math.log2(image.width / across)) };
}

/** A canvas-fixed grain's paint at pixel centre (px, py). */
function canvasGrainPaint(place: LayerPlace, grain: Grain, px: number, py: number): number {
  const tile = grainTile(grain, place.diameter);
  const raw = sampleStampReference(grain.image, px / tile.across + place.offset[0], py / tile.down + place.offset[1], tile.lod, grain.tiling === 'mirror' ? 'mirror' : 'tile');
  return stampGrainPaint(raw, grain, grainMean(grain));
}

/** A grain image's mean paint, its smallest mip, as the GPU reads it. */
const grainMean = (grain: Grain) => grain.image.at(-1)!.paint[0];

/** `layer`'s grain when it's fixed to the canvas and cuts. */
const canvasGrainOf = (layer?: StampBrushLayer<StampReferenceMips>) => (layer?.grain?.kind === 'canvas' && layer.grain.depth > 0 ? layer.grain : undefined);

/**
 * A layer's stamps built over the box. Each stamp's coverage is its tip, cut by a rolling grain when it has one, times
 * its flow. `buildToOpacity` moves each pixel toward the stamp's opacity and never lowers it; `build` lays alpha ×
 * opacity over it; `glaze` does too and keeps the densest stamp, built toward its cap as far as its build says.
 */
function buildLayer(place: LayerPlace, stamps: readonly PlacedStamp[], box: StampReferenceBox, opacityScale: number): Float32Array {
  const { layer } = place, { accumulation } = layer;
  const tipImage = layer.tip.image[0], span = layer.tip.span ?? 1, roundness = layer.tip.roundness;
  const [cx, cy] = layer.tip.center ?? [0.5, 0.5];
  const built = new Float32Array(box.width * box.height);
  const glaze = accumulation.kind === 'glaze';
  const densest = glaze ? new Float32Array(built.length) : undefined, cap = glaze ? new Float32Array(built.length) : undefined;
  const rolling = layer.grain?.kind === 'rolling' && layer.grain.depth > 0 ? layer.grain : undefined;
  const rollingTile = rolling && grainTile(rolling, place.diameter);
  for (const stamp of stamps) {
    // Never thinner than a pixel, as the GPU's stamps.
    const width = stamp.diameter * span, height = Math.max(1, width * roundness * stamp.roundness);
    // Anisotropic, as Photoshop resamples a squashed tip: the level of its less-shrunk side, averaged over up to 16 reads
    // along the other, so squashing blurs it only across the squash. Isotropic: one read at its more-shrunk side's level.
    const across = tipImage.width / width, down = tipImage.height / height;
    const anisotropic = layer.tip.sampling === 'anisotropic';
    const lod = Math.max(0, Math.log2(anisotropic ? Math.min(across, down) : Math.max(across, down))) + stamp.blur * BLUR_LEVELS;
    const reads = anisotropic ? Math.min(16, Math.max(1, Math.ceil(Math.max(across, down) / Math.max(1, Math.min(across, down)) - 1e-9))) : 1;
    const alongV = down > across;
    const reach = (width / 2) * Math.SQRT2;
    const x0 = Math.max(box.x, Math.floor(stamp.x - reach)), x1 = Math.min(box.x + box.width, Math.ceil(stamp.x + reach));
    const y0 = Math.max(box.y, Math.floor(stamp.y - reach)), y1 = Math.min(box.y + box.height, Math.ceil(stamp.y + reach));
    const opacity = stamp.opacity * opacityScale;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const dx = px + 0.5 - stamp.x, dy = py + 0.5 - stamp.y;
        const [lx, ly] = turned(dx, dy, -stamp.rotation);
        const u = (lx / width) * (stamp.flipX ? -1 : 1) + cx, v = (ly / height) * (stamp.flipY ? -1 : 1) + cy;
        let a = 0;
        for (let k = 0; k < reads; k++) {
          const off = (k + 0.5) / reads - 0.5;
          a += sampleStampReference(layer.tip.image, alongV ? u : u + off / width, alongV ? v + off / height : v, lod, 'clamp') / reads;
        }
        if (a <= 0) continue;
        let capped = 1;
        if (rolling && rollingTile) {
          const size = Math.pow(stamp.diameter / place.diameter, rolling.zoom);
          const [gx, gy] = turned(dx, dy, -stamp.grainTurn);
          const gu = gx / (rollingTile.across * size) + (rolling.movement * stamp.x) / rollingTile.across + place.offset[0];
          const gv = gy / (rollingTile.down * size) + (rolling.movement * stamp.y) / rollingTile.down + place.offset[1];
          const g = stampGrainPaint(sampleStampReference(rolling.image, gu, gv, Math.max(0, Math.log2(rolling.image[0].width / (rollingTile.across * size))), rolling.tiling === 'mirror' ? 'mirror' : 'tile'), rolling, grainMean(rolling));
          a = stampGrainCut(a, g, rolling);
          capped = stampGrainCut(1, g, rolling);
        }
        const i = (py - box.y) * box.width + (px - box.x), laid = a * stamp.alpha;
        if (glaze) {
          const paint = laid * opacity;
          built[i] += paint * (1 - built[i]);
          densest![i] = Math.max(densest![i], paint);
          cap![i] = Math.max(cap![i], capped * stamp.alpha * opacity);
        } else if (accumulation.kind === 'build') {
          built[i] += laid * opacity * (1 - built[i]);
        } else if (opacity > built[i]) {
          built[i] += laid * (opacity - built[i]);
        }
      }
    }
  }
  if (accumulation.kind === 'glaze') for (let i = 0; i < built.length; i++) built[i] = densest![i] + (Math.min(built[i], cap![i]) - densest![i]) * accumulation.build;
  return built;
}

/**
 * A deposit's coverage over `box`, stage by stage in `arrangement`'s order: by default Photoshop's, or the dual first
 * when it shapes where the stamps' paint lies, as the GPU renderer orders them.
 */
export function renderStampReferenceDeposit(input: StampReferenceDepositInput): StampReferenceDeposit {
  const { brush, box } = input;
  const arrangement = input.arrangement ?? (brush.dual && stampDualBeforeGrain(brush.dual.blend)
    ? { ...PHOTOSHOP_STAMP_ARRANGEMENT, order: ['dual', 'grain', 'pooling'] as const } : PHOTOSHOP_STAMP_ARRANGEMENT);
  const opacityInBuild = arrangement.opacity === 'inBuild' ? input.opacity : 1;
  const main: LayerPlace = { layer: brush, diameter: input.diameter, offset: input.grainOffset.main };
  const dual: LayerPlace | undefined = brush.dual && { layer: brush.dual, diameter: input.diameter * brush.dual.scale, offset: input.grainOffset.dual };
  const built = { main: buildLayer(main, input.stamps, box, opacityInBuild), dual: dual && buildLayer(dual, input.dualStamps, box, 1) };
  // The dual's own canvas grain cuts it before it combines, wherever the dual stage falls.
  const dualGrain = canvasGrainOf(brush.dual), mainGrain = canvasGrainOf(brush);
  const secondary = dual && built.dual!.map((s, i) => {
    if (!dualGrain) return s;
    const px = box.x + (i % box.width) + 0.5, py = box.y + Math.floor(i / box.width) + 0.5;
    return stampGrainCut(s, canvasGrainPaint(dual, dualGrain, px, py), dualGrain);
  });
  const pooling = brush.wetEdges?.kind === 'pooling' ? brush.wetEdges : undefined;
  let coverage = built.main;
  const stages: StampReferenceDeposit['stages'] = [];
  for (const stage of arrangement.order) {
    const next = coverage.map((c, i) => {
      const px = box.x + (i % box.width) + 0.5, py = box.y + Math.floor(i / box.width) + 0.5;
      if (stage === 'grain') return mainGrain ? stampGrainCut(c, canvasGrainPaint(main, mainGrain, px, py), mainGrain) : c;
      if (stage === 'dual') return secondary ? stampDualCombine(c, secondary[i], brush.dual!.blend) : c;
      return pooling ? stampPooled(c, pooling) : c;
    });
    stages.push({ stage, coverage: next });
    coverage = next;
  }
  const opacityLast = arrangement.opacity === 'last' ? input.opacity : 1;
  return { box, built, stages, coverage: coverage.map((c) => Math.min(1, Math.max(0, c)) * opacityLast) };
}
