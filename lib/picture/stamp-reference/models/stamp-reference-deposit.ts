// stamp-reference-deposit.ts: a deposit's coverage worked out pixel by pixel on the CPU, slowly, with every stage's
// buffer kept: the reference the GPU renderer is held to, and where stages are rearranged to see which order a
// capture selects. It samples as the GPU's samplers do, runs the CPU side of the GPU's formula and accumulation
// registries, and takes its active stages and their order from the same tables.
//
// Coverage only: colour, tints, paper, clipping and Procreate's blurred rims aren't here:
// they come after coverage, which is what its captures hold. A fill's body joins its build as the GPU's does, and where a
// deposit is kept (masking fluid, `within`, a fill's load and front) is stampDepositKeepAt's, applied last.

import type { StampBrush, StampBrushGrain, StampBrushLayer } from '#lib/picture/stamp-paint/models/stamp-brush.ts';
import type { PlacedStamp } from '#lib/picture/stamp-paint/models/stamp-placement.ts';
import type { StampFillBody, StampFillBodyLevels } from '#lib/picture/stamp-paint/models/stamp-fill.ts';
import { stampFillBody, stampGridAt, stampPolygonDistance } from '#lib/picture/stamp-paint/models/stamp-region.ts';
import { stampDualCombine, stampGrainCut, stampGrainPaint, stampNoiseSeed, stampPooled, stampPressedTip, stampTipNoise, stampTipNoiseAt } from '#lib/picture/stamp-paint/models/coverage-formulas.ts';
import {
  STAMP_ACCUMULATIONS, STAMP_BLUR_LEVELS, STAMP_RESOLVE_PLANS, stampAccumulationBuild, stampActiveLayers, stampResolvePlan, type StampActiveLayer, type StampResolveStage,
} from '#lib/picture/stamp-paint/models/stamp-deposit-stages.ts';
import { sampleStampReference, type StampReferenceMips } from './stamp-reference-image.ts';

/** A rearrangement to try against a capture; what's left out is as the GPU renderer does it. */
export type StampReferenceArrangement = {
  /** The stages after the build; the brush's plan's (STAMP_RESOLVE_PLANS) by default. */
  order?: readonly StampResolveStage[];
  /** Whether the deposit's opacity scales the finished coverage (`last`, the default) or each stamp's as it builds (`inBuild`). */
  opacity?: 'last' | 'inBuild';
};

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
  /** A fill's body and the levels it's laid at, joined to the main layer's build (CompiledStampFill). */
  fill?: StampFillBody & { levels: StampFillBodyLevels };
  /** How much of the deposit is kept at a pixel centre (stampDepositKeepAt); all of it when left out. */
  keep?: (x: number, y: number) => number;
};

/** Each buffer, row by row over the box, 0..1: the stamps as built, after each stage in order, and the result. */
export type StampReferenceDeposit = {
  box: StampReferenceBox;
  built: { main: Float32Array; dual?: Float32Array };
  stages: { stage: StampResolveStage; coverage: Float32Array }[];
  coverage: Float32Array;
};

const turned = (x: number, y: number, angle: number): [number, number] => {
  const s = Math.sin(angle), c = Math.cos(angle);
  return [c * x - s * y, s * x + c * y];
};

type Grain = StampBrushGrain<StampReferenceMips>;
/** A layer with its active stages (stampActiveLayers), and where its grains start. */
type LayerPlace = { layer: StampBrushLayer<StampReferenceMips>; active: StampActiveLayer<StampReferenceMips>; offset: readonly [number, number] };

/** `grain`'s tile in pixels at `diameter`, across and down, and the mip level a canvas-fixed read of it takes. */
function grainTile(grain: Grain, diameter: number) {
  const image = grain.image[0], across = grain.scale * diameter;
  return { across, down: across * (image.height / image.width), lod: Math.max(0, Math.log2(image.width / across)) };
}

/** A canvas-fixed grain's paint at pixel centre (px, py). */
function canvasGrainPaint(place: LayerPlace, grain: Grain, px: number, py: number): number {
  const tile = grainTile(grain, place.active.diameter);
  const raw = sampleStampReference(grain.image, px / tile.across + place.offset[0], py / tile.down + place.offset[1], tile.lod, grain.tiling === 'mirror' ? 'mirror' : 'tile');
  return stampGrainPaint(raw, grain, grainMean(grain));
}

/** A grain image's mean paint, its smallest mip, as the GPU reads it. */
const grainMean = (grain: Grain) => grain.image.at(-1)!.paint[0];

/**
 * A layer's stamps built over the box. Each stamp's coverage is its tip, cut by a rolling grain when it has one, times
 * its flow, laid as its accumulation lays it (STAMP_ACCUMULATIONS).
 */
function buildLayer(place: LayerPlace, stamps: readonly PlacedStamp[], box: StampReferenceBox, opacityScale: number, fill?: StampReferenceDepositInput['fill']): Float32Array {
  const { layer, active } = place, { accumulation } = layer;
  const tipImage = layer.tip.image[0], span = layer.tip.span ?? 1, roundness = layer.tip.roundness;
  const [cx, cy] = layer.tip.center ?? [0.5, 0.5], noise = layer.tip.noise ?? 0, { pressed } = layer.tip;
  const built = new Float32Array(box.width * box.height);
  const { lay, keepsCap: glaze, resolve } = STAMP_ACCUMULATIONS[accumulation.kind];
  // What a glaze keeps beside its build; zeros, unread, for the others.
  const densest = new Float32Array(built.length), cap = new Float32Array(built.length);
  const rolling = active.rollingGrain;
  const rollingTile = rolling && grainTile(rolling, active.diameter);
  for (const stamp of stamps) {
    // The image's own proportions, then squashed, and never thinner than a pixel, as the GPU's stamps.
    const width = stamp.diameter * span, height = Math.max(1, width * (tipImage.height / tipImage.width) * roundness * stamp.roundness);
    // Anisotropic, as Photoshop resamples a squashed tip: the level of its less-shrunk side, averaged over up to 16 reads
    // along the other, so squashing blurs it only across the squash. Isotropic: one read at its more-shrunk side's level.
    const across = tipImage.width / width, down = tipImage.height / height;
    const anisotropic = layer.tip.sampling === 'anisotropic';
    const lod = Math.max(0, Math.log2(anisotropic ? Math.min(across, down) : Math.max(across, down))) + stamp.blur * STAMP_BLUR_LEVELS;
    const reads = anisotropic ? Math.min(16, Math.max(1, Math.ceil(Math.max(across, down) / Math.max(1, Math.min(across, down)) - 1e-9))) : 1;
    const alongV = down > across;
    const reach = (Math.max(width, height) / 2) * Math.SQRT2;
    const x0 = Math.max(box.x, Math.floor(stamp.x - reach)), x1 = Math.min(box.x + box.width, Math.ceil(stamp.x + reach));
    const y0 = Math.max(box.y, Math.floor(stamp.y - reach)), y1 = Math.min(box.y + box.height, Math.ceil(stamp.y + reach));
    const opacity = stamp.opacity * opacityScale, seed = stampNoiseSeed(stamp.x, stamp.y);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const dx = px + 0.5 - stamp.x, dy = py + 0.5 - stamp.y;
        const [lx, ly] = turned(dx, dy, -stamp.rotation);
        const u = (lx / width) * (stamp.flipX ? -1 : 1) + cx, v = (ly / height) * (stamp.flipY ? -1 : 1) + cy;
        let a = 0, contact = 0;
        for (let k = 0; k < reads; k++) {
          const off = (k + 0.5) / reads - 0.5, ru = alongV ? u : u + off / width, rv = alongV ? v + off / height : v;
          a += sampleStampReference(layer.tip.image, ru, rv, lod, 'clamp') / reads;
          if (pressed) contact += sampleStampReference(pressed.contact, ru, rv, lod, 'clamp') / reads;
        }
        if (pressed) a = stampPressedTip(a, contact, stamp.pressure, pressed.softness, ...pressed.range, pressed.diameter ? stamp.diameter / pressed.diameter : 1);
        if (a <= 0) continue;
        // The noise's pixel is the tip's, at the stamp's width, where the GPU's hull reads it.
        if (noise) a = stampTipNoise(a, stampTipNoiseAt(Math.max(0, Math.floor(u * width)), Math.max(0, Math.floor(v * width)), seed), noise);
        let capped = 1;
        if (rolling && rollingTile) {
          const size = Math.pow(stamp.diameter / active.diameter, rolling.zoom);
          const [gx, gy] = turned(dx, dy, -stamp.grainTurn);
          const gu = gx / (rollingTile.across * size) + (rolling.movement * stamp.x) / rollingTile.across + place.offset[0];
          const gv = gy / (rollingTile.down * size) + (rolling.movement * stamp.y) / rollingTile.down + place.offset[1];
          const g = stampGrainPaint(sampleStampReference(rolling.image, gu, gv, Math.max(0, Math.log2(rolling.image[0].width / (rollingTile.across * size))), rolling.tiling === 'mirror' ? 'mirror' : 'tile'), rolling, grainMean(rolling));
          const cut = { blend: rolling.blend, depth: rolling.depth * stamp.grainDepth };
          a = stampGrainCut(a, g, cut);
          capped = stampGrainCut(1, g, cut);
        }
        const i = (py - box.y) * box.width + (px - box.x), laid = a * stamp.alpha;
        built[i] = lay.cpu(built[i], laid, opacity);
        if (glaze) {
          densest[i] = Math.max(densest[i], laid * opacity);
          cap[i] = Math.max(cap[i], capped * stamp.alpha * opacity);
        }
      }
    }
  }
  // A fill's body joins the build as the GPU's blend joins it: toward full by screen, else by max; a glaze's cap too.
  if (fill) {
    const { towardFull } = STAMP_ACCUMULATIONS[accumulation.kind];
    built.forEach((b, i) => {
      const x = box.x + (i % box.width) + 0.5, y = box.y + Math.floor(i / box.width) + 0.5;
      const body = stampFillBody(stampPolygonDistance(fill.polygon, x, y), stampGridAt(fill.thickness, x, y), fill.inset);
      const laid = body * fill.levels.built;
      built[i] = towardFull ? laid + b * (1 - laid) : Math.max(b, laid);
      if (glaze) {
        densest[i] = Math.max(densest[i], body * fill.levels.densest);
        cap[i] = Math.max(cap[i], body * fill.levels.densest);
      }
    });
  }
  const build = stampAccumulationBuild(accumulation);
  return built.map((b, i) => resolve.cpu({ built: b, densest: densest[i], cap: cap[i] }, build));
}

/** A deposit's coverage over `box`, stage by stage in the GPU renderer's order unless `arrangement` rearranges it. */
export function renderStampReferenceDeposit(input: StampReferenceDepositInput): StampReferenceDeposit {
  const { brush, box } = input;
  const order = input.arrangement?.order ?? STAMP_RESOLVE_PLANS[stampResolvePlan(brush.dual)], opacityAt = input.arrangement?.opacity ?? 'last';
  const opacityInBuild = opacityAt === 'inBuild' ? input.opacity : 1;
  const active = stampActiveLayers(brush, input.diameter);
  const main: LayerPlace = { layer: brush, active: active.main, offset: input.grainOffset.main };
  const dualPlace: LayerPlace | undefined = brush.dual && active.dual && { layer: brush.dual, active: active.dual, offset: input.grainOffset.dual };
  const built = { main: buildLayer(main, input.stamps, box, opacityInBuild, input.fill), dual: dualPlace && buildLayer(dualPlace, input.dualStamps, box, 1) };
  const at = (i: number) => [box.x + (i % box.width) + 0.5, box.y + Math.floor(i / box.width) + 0.5] as const;
  // The dual's own canvas grain cuts it, and its own pooling gathers it, before it combines, wherever the dual stage
  // falls.
  const secondary = dualPlace && built.dual?.map((s, i) => {
    const { canvasGrain: grain, pooling: pools } = dualPlace.active;
    const cut = grain ? stampGrainCut(s, canvasGrainPaint(dualPlace, grain, ...at(i)), grain) : s;
    return pools ? stampPooled(cut, pools) : cut;
  });
  const dual = brush.dual && secondary && { blend: brush.dual.blend, coverage: secondary };
  const { canvasGrain, pooling } = active.main;
  const runStage: Record<StampResolveStage, (c: number, i: number) => number> = {
    grain: (c, i) => (canvasGrain ? stampGrainCut(c, canvasGrainPaint(main, canvasGrain, ...at(i)), canvasGrain) : c),
    dual: (c, i) => (dual ? stampDualCombine(c, dual.coverage[i], dual.blend) : c),
    pooling: (c) => (pooling ? stampPooled(c, pooling) : c),
  };
  let coverage = built.main;
  const stages: StampReferenceDeposit['stages'] = [];
  for (const stage of order) {
    const next = coverage.map((c, i) => runStage[stage](c, i));
    stages.push({ stage, coverage: next });
    coverage = next;
  }
  const opacityLast = opacityAt === 'last' ? input.opacity : 1;
  const { keep } = input;
  return { box, built, stages, coverage: coverage.map((c, i) => Math.min(1, Math.max(0, c)) * opacityLast * (keep ? keep(...at(i)) : 1)) };
}
