// stamp-paint-recipe.ts: what a stamp painting is, apart from how it's rendered or where its brushes came from.
//
// A recipe is ordered groups of ordered passes of deposits: a stroke, placed
// stamps or a fill of a region, of one brush in one material, landing under the masking fluid declared before it.
// `compileStampPaintRecipe` checks it and places every stamp of the painting once. A frame at `t` only chooses how
// many of each deposit's stamps show (`visibleStampCountAt`) and how far a fill's front has crossed it
// (`stampFillProgressAt`), so it is a function of `t` alone.
//
// Randomness comes from IDs, never order: each deposit is seeded by its ID (`<group>/<pass>/<deposit>`), so adding a
// stroke changes no other.

import { seededRandom } from '#lib/picture/motion/models/random.ts';
import { paintMixtureProblem, type PaintMixture } from '#lib/picture/paint/models/paint-mixture.ts';
import type { StampBlend, StampBrush, StampBrushAsset, StampBrushColorDynamics, StampBrushLayer } from './stamp-brush.ts';
import { placeAuthoredStamps, placeStrokeStamps, type PlacedStamp, type StampPlacement, type StampPlacementBrush, type StampStrokePoint } from './stamp-placement.ts';
import { handStampStroke, type StampStrokeHand } from './stamp-stroke-hand.ts';
import { STAMP_ACCUMULATIONS } from './stamp-deposit-stages.ts';
import {
  placeStampFill, stampFillBodyLevels, stampFillFront, stampFillProbe, stampRegionSeed, type StampFillBody, type StampFillBodyLevels, type StampFillFront,
} from './stamp-fill.ts';
import type { StampPaintField } from './stamp-paint-field.ts';
import { stampRegionPolygon, type StampEdge, type StampPoint, type StampRegion } from './stamp-region.ts';

export type StampPaintColor = `#${string}`;

/** What a painting is laid on: a style's paper with each image named in full, as a painting is laid on it. */
export type StampPaintPaper = {
  color: StampPaintColor;
  image?: StampBrushAsset;
  grain?: { image: StampBrushAsset; scale: number; depth: number };
};

/**
 * What a deposit is made of. A `color` is flat colour, laid by its blend as Photoshop lays it; in a style that paints
 * in pigment it's fitted as a pigment of its own. A `mixture` is pigments in proportion at a strength
 * (paint-mixture.ts), which only a style that paints in pigment can lay.
 */
export type PaintMaterial = { kind: 'color'; color: StampPaintColor } | ({ kind: 'mixture' } & PaintMixture);

type StampDepositSettings = {
  brush: StampBrush;
  material: PaintMaterial;
  /** The stamp's diameter at full size, in the painting's pixels. */
  diameter: number;
  /** Left out, the brush's own blend. */
  blend?: StampBlend;
  /** The colour a brush whose colour follows pressure moves toward (StampBrushColorDynamics); a colour material's own if left out. */
  secondaryColor?: StampPaintColor;
  /** The most this deposit can build to, 0..1, however its stamps overlap. */
  opacity?: number;
} & StampDepositReveal;

/**
 * When a deposit shows. `appliedAt`: seconds into the scene when it starts to appear; left out, it's there from the
 * start. `drawnOver`: seconds it takes to draw from `appliedAt` (so only with one), showing a growing share of a
 * stroke's length or of its placements, or a front crossing a fill; left out, it lands whole.
 */
type StampDepositReveal = { appliedAt?: undefined; drawnOver?: undefined } | { appliedAt: number; drawnOver?: number };

export type StampStrokeSettings = StampDepositSettings & {
  path: readonly StampStrokePoint[];
  /**
   * How a hand paints the path: a pressure profile, pressure and speed from its turns, and wobble (stamp-stroke-hand.ts),
   * composed with any pressure its points carry, and seeded by the deposit's ID. Left out, the points' pressure is all
   * there is and the stroke reveals at an even pace.
   */
  hand?: StampStrokeHand;
};
export type StampPlacementSettings = StampDepositSettings & { at: readonly StampPlacement[] };

/**
 * A wash over `region` (stamp-fill.ts): solid inside, the brush's own at its edge, its dual across all of it.
 * `direction`: radians the dual's rows run along and a drawn fill's front crosses (0: rows left to right, the front
 * coming down). `load`: how much paint, 0..1, across the region, 1 when left out; a colour lays it as coverage.
 */
export type StampFillSettings = StampDepositSettings & { region: StampRegion; direction?: number; load?: StampPaintField<number> };

/**
 * Masking fluid over `region`: no deposit declared after it in its scope lands under it, until an unmask lifts it.
 * Paint already there stays. Its `edge` is a 1-px antialiased line unless it's soft or ragged (StampEdge).
 */
export type StampMaskSettings = { region: StampRegion; edge?: StampEdge };
/**
 * Lifts `amount` (0..1, 1 when left out) of the fluid within `region`, or everywhere without one, for deposits
 * declared after it in its scope.
 */
export type StampUnmaskSettings = { region?: StampRegion; edge?: StampEdge; amount?: number };

/**
 * `opaque` covers what it's painted over, as body colour does; `glaze` lays over it at `opacity`, letting it show
 * through. `depth` orders groups far (higher) to near, and `order` overrides depth: a group with a higher order paints
 * after every group with a lower one, whatever their depths. Both default to 0, and ties keep the order written.
 */
export type StampGroupOptions = ({ composite: 'opaque' } | { composite: 'glaze'; opacity: number }) & { depth?: number; order?: number };

/**
 * A `clipped` pass lands only where the nearest unclipped pass before it in its group holds paint, as a Procreate
 * clipping mask clips to the layer under it: texture inside a silhouette. A pass `within` a region lands only inside
 * it, its edge a 1-px antialiased line: a reflection kept to its water.
 */
export type StampPassOptions = { clipped?: boolean; within?: StampRegion };

/**
 * Masks and unmasks, in any scope. Each changes the fluid for what's declared after it in its scope and the scopes
 * inside it; leaving a scope puts back the fluid it began with, so an element's reserve never leaks into the next.
 * Their IDs name them within their scope as a deposit's do, and seed a ragged edge.
 */
type StampMasking = { mask: (id: string, settings: StampMaskSettings) => void; unmask: (id: string, settings: StampUnmaskSettings) => void };

export type StampPaintScope = StampMasking & { group: (id: string, options: StampGroupOptions, body: (group: StampGroupScope) => void) => void };
export type StampGroupScope = StampMasking & { pass: (id: string, options: StampPassOptions, body: (pass: StampPassScope) => void) => void };
export type StampPassScope = StampMasking & {
  stroke: (id: string, settings: StampStrokeSettings) => void;
  stamps: (id: string, settings: StampPlacementSettings) => void;
  fill: (id: string, settings: StampFillSettings) => void;
};

export type StampPaintDeposit = ({ kind: 'stroke' } & StampStrokeSettings) | ({ kind: 'stamps' } & StampPlacementSettings) | ({ kind: 'fill' } & StampFillSettings);

/** The fluid as it stands: the latest op, over the fluid before it; null when there's none. */
type StampPaintRecipeMask = {
  /** Its scope's IDs, then its own. */
  path: readonly string[];
  op: ({ kind: 'mask' } & StampMaskSettings) | ({ kind: 'unmask' } & StampUnmaskSettings);
  under: StampPaintRecipeMask | null;
} | null;
type StampPaintRecipeDeposit = { id: string; deposit: StampPaintDeposit; mask: StampPaintRecipeMask };
type StampPaintRecipePass = { id: string; clipped: boolean; within?: StampRegion; deposits: readonly StampPaintRecipeDeposit[] };
type StampPaintRecipeGroup = { id: string; options: StampGroupOptions; passes: readonly StampPaintRecipePass[] };

/** A recipe as written, IDs unchecked: `compileStampPaintRecipe` checks it. */
export type StampPaintRecipe = { groups: readonly StampPaintRecipeGroup[]; masks: readonly NonNullable<StampPaintRecipeMask>[] };

/** Writes a recipe by calling `body`, which declares groups, their passes and the passes' deposits in painting order. */
export function stampPaintRecipe(body: (paint: StampPaintScope) => void): StampPaintRecipe {
  const groups: StampPaintRecipeGroup[] = [], masks: NonNullable<StampPaintRecipeMask>[] = [];
  let fluid: StampPaintRecipeMask = null;
  const masking = (scope: readonly string[]): StampMasking => {
    const push = (op: NonNullable<StampPaintRecipeMask>['op'], id: string) => {
      fluid = { path: [...scope, id], op, under: fluid };
      masks.push(fluid);
    };
    return { mask: (id, settings) => push({ kind: 'mask', ...settings }, id), unmask: (id, settings) => push({ kind: 'unmask', ...settings }, id) };
  };
  /** Runs `inner`, then puts the fluid back as it was. */
  const scoped = (inner: () => void) => {
    const outer = fluid;
    try {
      inner();
    } finally {
      fluid = outer;
    }
  };
  body({
    ...masking([]),
    group(id, options, groupBody) {
      const passes: StampPaintRecipePass[] = [];
      groups.push({ id, options, passes });
      scoped(() => groupBody({
        ...masking([id]),
        pass(passId, { clipped = false, within }, passBody) {
          const deposits: StampPaintRecipeDeposit[] = [];
          passes.push({ id: passId, clipped, ...(within && { within }), deposits });
          scoped(() => passBody({
            ...masking([id, passId]),
            stroke: (depositId, settings) => deposits.push({ id: depositId, deposit: { kind: 'stroke', ...settings }, mask: fluid }),
            stamps: (depositId, settings) => deposits.push({ id: depositId, deposit: { kind: 'stamps', ...settings }, mask: fluid }),
            fill: (depositId, settings) => deposits.push({ id: depositId, deposit: { kind: 'fill', ...settings }, mask: fluid }),
          }));
        },
      }));
    },
  });
  return { groups, masks };
}

/**
 * The fluid a deposit lands under: its latest op over the fluid before it, null for none. Deposits under the same
 * fluid share one object, so the renderer works each out once.
 */
export type CompiledStampMask = {
  /** `<scope>/<op>`, unique in the painting. */
  id: string;
  kind: 'mask' | 'unmask';
  /** Its region traced, null for an unmask of all the fluid. */
  polygon: readonly StampPoint[] | null;
  edge?: StampEdge;
  /** The share of the fluid an unmask lifts; 1 for a mask. */
  amount: number;
  /** Its ragged edge's seed (stampRegionSeed of its ID). */
  seed: number;
  under: CompiledStampMask | null;
};

/** A fill's placed body and how its front crosses it (stamp-fill.ts). */
export type CompiledStampFill = StampFillBody & { load: StampPaintField<number>; levels: StampFillBodyLevels; front: StampFillFront };

type CompiledStampDepositCommon = {
  /** `<group>/<pass>/<deposit>`, unique in the painting: the seed of every stamp in it. */
  id: string;
  brush: StampBrush;
  /** Its material, a colour moved by the brush's stroke colour jitter. */
  material: PaintMaterial;
  /** None for a mixture: a brush's colour dynamics move a colour, not pigments. */
  secondaryColor?: StampPaintColor;
  /** Where the brush's grain and its dual's start, as shares of their tiles: each deposit's own, by offset jitter. */
  grainOffset: { main: readonly [number, number]; dual: readonly [number, number] };
  /** The stamp's diameter at full size, as the deposit states it: what its texturized grain and edges scale with. */
  diameter: number;
  blend: StampBlend;
  opacity: number;
  /** The fluid it lands under. */
  mask: CompiledStampMask | null;
  /** When it shows (StampDepositReveal): from `at` seconds, drawn over `over` (0 lands whole); none, there throughout. */
  reveal?: { at: number; over: number };
  /** Every stamp of the finished deposit, in reveal order: a fill's are its edge stroke's. */
  stamps: readonly PlacedStamp[];
  /** The brush's dual stamps, placed by its own settings along the same stroke, in reveal order; none without one. */
  dualStamps: readonly PlacedStamp[];
};

/** A stroke's stamps overlap along its path; placed stamps each land alone; a fill is a body under its edge stroke. */
export type CompiledStampDeposit = CompiledStampDepositCommon & ({ kind: 'stroke' | 'stamps' } | { kind: 'fill'; fill: CompiledStampFill });

export type CompiledStampPass = {
  /** `<group>/<pass>`. */
  id: string;
  /** The pass this one is clipped to, by ID: it lands only where that pass holds paint. Absent for an unclipped pass. */
  clipTo?: string;
  /** The region it lands within, traced; null for none. */
  within: readonly StampPoint[] | null;
  deposits: readonly CompiledStampDeposit[];
};

export type CompiledStampGroup = { id: string; composite: 'opaque' | 'glaze'; opacity: number; passes: readonly CompiledStampPass[] };

/** A checked recipe with every stamp placed, its groups in the order they paint. */
export type CompiledStampPaint = { groups: readonly CompiledStampGroup[] };

/**
 * Checks `recipe` and places every stamp. Throws on an ID used twice at one level (it would seed two deposits alike),
 * an empty ID or one holding the seed's separators `/` or `|`, a clipped pass with nothing before it, a deposit with
 * no points or diameter, a stroke's non-positive speed, a negative `drawnOver`, a bad mixture, or a bad mask.
 */
export function compileStampPaintRecipe(recipe: StampPaintRecipe): CompiledStampPaint {
  const seen = new Set<string>(), duplicates = new Set<string>();
  const claim = (id: string, parent?: string) => {
    if (!id || /[/|]/.test(id)) throw new Error(`stamp paint: "${id}" isn't an ID: IDs are non-empty and hold no "/" or "|"`);
    const full = parent ? `${parent}/${id}` : id;
    if (seen.has(full)) duplicates.add(full);
    seen.add(full);
    return full;
  };
  const masks = new Map<NonNullable<StampPaintRecipeMask>, CompiledStampMask>();
  for (const node of recipe.masks) {
    const { path, op, under } = node;
    const full = claim(path.at(-1)!, path.slice(0, -1).join('/') || undefined);
    const amount = op.kind === 'unmask' ? op.amount ?? 1 : 1;
    if (!(amount >= 0 && amount <= 1)) throw new Error(`stamp paint: ${full} lifts ${amount} of the fluid, and an unmask lifts 0..1 of it`);
    const { soft = 0, ragged } = op.edge ?? {};
    if (!(soft >= 0) || (ragged && !(ragged.amount >= 0 && ragged.scale > 0))) throw new Error(`stamp paint: ${full}'s edge needs a soft width of 0 or more, and a ragged amount of 0 or more at a positive scale`);
    masks.set(node, {
      id: full, kind: op.kind, polygon: op.region ? stampRegionPolygon(op.region) : null, ...(op.edge && { edge: op.edge }),
      amount, seed: stampRegionSeed(full), under: under ? masks.get(under)! : null,
    });
  }
  const groups = recipe.groups.map(({ id, options, passes }, written) => {
    const groupId = claim(id);
    let clipBase: string | undefined;
    const compiledPasses = passes.map((pass): CompiledStampPass => {
      const passId = claim(pass.id, groupId);
      if (pass.clipped && !clipBase) throw new Error(`stamp paint: ${passId} is clipped, but no unclipped pass comes before it in ${groupId}`);
      const clipTo = pass.clipped ? clipBase : undefined;
      if (!pass.clipped) clipBase = passId;
      const deposits = pass.deposits.map(({ id: depositId, deposit, mask }) => compileDeposit(claim(depositId, passId), deposit, mask && masks.get(mask)!));
      return { id: passId, ...(clipTo && { clipTo }), within: pass.within ? stampRegionPolygon(pass.within) : null, deposits };
    });
    const opacity = options.composite === 'glaze' ? options.opacity : 1;
    return { written, order: options.order ?? 0, depth: options.depth ?? 0, group: { id: groupId, composite: options.composite, opacity, passes: compiledPasses } };
  });
  if (duplicates.size) throw new Error(`stamp paint: IDs used twice, which would seed two deposits alike: ${[...duplicates].join(', ')}`);
  groups.sort((a, b) => a.order - b.order || b.depth - a.depth || a.written - b.written);
  return { groups: groups.map(({ group }) => group) };
}

/** A deposit checked and its stamps placed, `full` its ID, under the fluid `mask`. */
function compileDeposit(full: string, deposit: StampPaintDeposit, mask: CompiledStampMask | null): CompiledStampDeposit {
  const { brush, material, blend = brush.blend, opacity = 1, appliedAt, drawnOver, diameter } = deposit;
  if (!(diameter > 0) || !Number.isFinite(diameter)) throw new Error(`stamp paint: ${full} has diameter ${diameter}, and a stamp needs a positive one`);
  if (drawnOver !== undefined && drawnOver < 0) throw new Error(`stamp paint: ${full} draws over ${drawnOver}s, and a draw takes no less than 0`);
  if (deposit.kind !== 'fill' && !(deposit.kind === 'stroke' ? deposit.path : deposit.at).length) throw new Error(`stamp paint: ${full} has no points to stamp`);
  if (deposit.kind === 'fill' && deposit.region.kind === 'polygon' && deposit.region.points.length < 3) throw new Error(`stamp paint: ${full} fills a polygon of fewer than 3 points`);
  if (deposit.kind === 'stroke' && deposit.path.some(({ speed }) => speed !== undefined && !(speed > 0))) throw new Error(`stamp paint: ${full} has a point whose speed isn't positive`);
  const random = seededRandom(`${full}|deposit|paint`);
  const offset = (layer?: StampBrushLayer) => [random(), random()].map((r) => r * (layer?.grain?.offsetJitter ?? 0)) as [number, number];
  const grainOffset = { main: offset(brush), dual: offset(brush.dual) };
  const jitter = [random(), random(), random(), random()];
  let paint: Pick<CompiledStampDeposit, 'material' | 'secondaryColor'>;
  if (material.kind === 'color') {
    paint = { material: { kind: 'color', color: brush.color ? strokeColor(material.color, brush.color.stroke, jitter) : material.color }, secondaryColor: deposit.secondaryColor ?? material.color };
  } else {
    const problem = paintMixtureProblem(material);
    if (problem) throw new Error(`stamp paint: ${full}'s mixture can't be painted: ${problem}`);
    paint = { material };
  }
  const common = {
    id: full, brush, ...paint, grainOffset, diameter, blend, opacity, mask, ...(appliedAt !== undefined && { reveal: { at: appliedAt, over: drawnOver ?? 0 } }),
  };
  if (deposit.kind === 'fill') {
    const direction = deposit.direction ?? 0;
    const { body, stamps, dualStamps } = placeStampFill(deposit.region, brush, diameter, direction, full);
    const levels = stampFillBodyLevels(STAMP_ACCUMULATIONS[brush.accumulation.kind].towardFull, stampFillProbe(brush, diameter, `${full}|probe`));
    const fill = { ...body, load: deposit.load ?? { kind: 'constant' as const, value: 1 }, levels, front: stampFillFront(body.polygon, direction, diameter) };
    return { ...common, kind: 'fill', fill, stamps, dualStamps };
  }
  // The hand's path is worked out once, so the main stamps and the dual's follow the same wobble.
  const path = deposit.kind !== 'stroke' ? [] : deposit.hand ? handStampStroke(deposit.path, deposit.hand, diameter, `${full}|hand`) : deposit.path;
  const place = (stamping: StampPlacementBrush, scale: number, seed: string) => deposit.kind === 'stroke'
    ? placeStrokeStamps(path, stamping, diameter * scale, seed)
    : placeAuthoredStamps(deposit.at.map((at) => (at.diameter === undefined ? at : { ...at, diameter: at.diameter * scale })), stamping, diameter * scale, seed);
  return { ...common, kind: deposit.kind, stamps: place(brush, 1, full), dualStamps: brush.dual ? place(brush.dual, brush.dual.scale, `${full}|dual`) : [] };
}

/**
 * How many of `deposit`'s stamps (or its dual stamps) show at `t` seconds: none before `appliedAt`, then a growing
 * prefix of them. A fill's all show from `appliedAt`: its front reveals it (stampFillProgressAt).
 */
export function visibleStampCountAt(deposit: CompiledStampDeposit, t: number, which: 'stamps' | 'dualStamps' = 'stamps'): number {
  const stamps = deposit[which];
  const { reveal } = deposit;
  if (!reveal) return stamps.length;
  if (t < reveal.at) return 0;
  if (deposit.kind === 'fill') return stamps.length;
  const progress = revealProgress(reveal, t);
  // Stamps come in reveal order, so the count is where `progress` would sort among them.
  let low = 0, high = stamps.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (stamps[middle].reveal <= progress) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** How far a fill's front has crossed it at `t` seconds, 0..1 (STAMP_FILL_FRONT_SHARE): 0 before `appliedAt`. */
export function stampFillProgressAt(deposit: CompiledStampDeposit & { kind: 'fill' }, t: number): number {
  const { reveal } = deposit;
  if (!reveal) return 1;
  return t < reveal.at ? 0 : revealProgress(reveal, t);
}

const revealProgress = ({ at, over }: { at: number; over: number }, t: number) => (over ? Math.min(1, (t - at) / over) : 1);

/** `color` moved by a brush's stroke colour jitter, from four draws (each 0..1). */
function strokeColor(color: StampPaintColor, jitter: StampBrushColorDynamics['stroke'], draws: readonly number[]): StampPaintColor {
  return shiftStampPaintColor(color, {
    hue: (draws[0] * 2 - 1) * jitter.hue,
    saturation: (draws[1] * 2 - 1) * jitter.saturation,
    lightness: draws[2] * jitter.lightness - draws[3] * jitter.darkness,
  });
}

/**
 * `color` turned by `hue` (a share of the wheel) and moved in HSL by `saturation` and `lightness` (each −1..1, added,
 * then held in range). The renderer shifts a stamp's tint the same way (STAMP_TINT_WGSL).
 */
export function shiftStampPaintColor(color: StampPaintColor, { hue, saturation, lightness }: { hue: number; saturation: number; lightness: number }): StampPaintColor {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const h2 = (((h / 6 + hue) % 1) + 1) % 1, s2 = Math.min(1, Math.max(0, s + saturation)), l2 = Math.min(1, Math.max(0, l + lightness));
  const c = (1 - Math.abs(2 * l2 - 1)) * s2;
  const channel = (n: number) => {
    const k = (n + h2 * 12) % 12;
    return l2 - (c / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const hex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${hex(channel(0))}${hex(channel(8))}${hex(channel(4))}`;
}
