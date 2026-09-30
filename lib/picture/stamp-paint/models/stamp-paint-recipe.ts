// stamp-paint-recipe.ts: what a stamp painting is, apart from how it's rendered or where its brushes came from.
//
// A recipe is ordered compositing groups, each a stack of ordered passes, each a list of deposits: a stroke, or
// stamps placed by hand, of one brush in one material. A scene writes it with `stampPaintRecipe`, and
// `compileStampPaintRecipe` checks it and places every stamp of every deposit, the whole painting's worth, once. A
// frame at time `t` then only chooses how many of each deposit's stamps show (`visibleStampCountAt`), so it is a
// function of `t` alone.
//
// Randomness comes from IDs, never from order: each deposit is seeded by its hierarchical ID
// (`<group>/<pass>/<deposit>`), so adding a stroke changes no other stroke, and renaming one reseeds only it.

import { seededRandom } from '#lib/picture/motion/models/random.ts';
import type { StampBlend, StampBrush, StampBrushColorDynamics, StampBrushLayer } from './stamp-brush.ts';
import { placeAuthoredStamps, placeStrokeStamps, type PlacedStamp, type StampPlacement, type StampPlacementBrush, type StampStrokePoint } from './stamp-placement.ts';
import { handStampStroke, type StampStrokeHand } from './stamp-stroke-hand.ts';

export type StampPaintColor = `#${string}`;

/**
 * What a deposit is made of, which decides how it mixes with paint already in its group. `flat` mixes only by its
 * blend; `pigment` mixes spectrally with the pigment under it, as real paints do (blue over yellow reads green).
 */
export type PaintMaterial = { kind: 'flat'; color: StampPaintColor } | { kind: 'pigment'; color: StampPaintColor };

/** An area of the painting, in its pixels. */
export type StampRegion =
  | { kind: 'polygon'; points: readonly { x: number; y: number }[] }
  | { kind: 'ellipse'; x: number; y: number; radiusX: number; radiusY: number };

type StampDepositSettings = {
  brush: StampBrush;
  material: PaintMaterial;
  /** The stamp's diameter at full size, in the painting's pixels. */
  diameter: number;
  /** Left out, the brush's own blend. */
  blend?: StampBlend;
  /** The colour a brush whose colour follows pressure moves toward (StampBrushColorDynamics); the material's own if left out. */
  secondaryColor?: StampPaintColor;
  /** The most this deposit can build to, 0..1, however its stamps overlap. */
  opacity?: number;
} & StampDepositReveal;

/**
 * When a deposit shows. `appliedAt`: seconds into the scene when it starts to appear; left out, it's there from the
 * start. `drawnOver`: seconds it takes to draw from `appliedAt` (so only with one), showing a growing share of a
 * stroke's length or of its placements; left out, it lands whole.
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
 * `opaque` covers what it's painted over, as body colour does; `glaze` lays over it at `opacity`, letting it show
 * through. `depth` orders groups far (higher) to near, and `order` overrides depth: a group with a higher order paints
 * after every group with a lower one, whatever their depths. Both default to 0, and ties keep the order written.
 */
export type StampGroupOptions = ({ composite: 'opaque' } | { composite: 'glaze'; opacity: number }) & { depth?: number; order?: number };

/**
 * A `clipped` pass lands only where the nearest unclipped pass before it in its group holds paint, as a Procreate
 * clipping mask clips to the layer under it: texture inside a silhouette.
 */
export type StampPassOptions = { clipped?: boolean };

/**
 * Regions no deposit made inside `body` can reach. Paint already there stays, and nothing is erased, so a protected
 * region never turns back to paper. Protections nest, each adding its regions.
 */
type StampProtect = (regions: readonly StampRegion[], body: () => void) => void;

export type StampPaintScope = { group: (id: string, options: StampGroupOptions, body: (group: StampGroupScope) => void) => void; protect: StampProtect };
export type StampGroupScope = { pass: (id: string, options: StampPassOptions, body: (pass: StampPassScope) => void) => void; protect: StampProtect };
export type StampPassScope = {
  stroke: (id: string, settings: StampStrokeSettings) => void;
  stamps: (id: string, settings: StampPlacementSettings) => void;
  protect: StampProtect;
};

export type StampPaintDeposit = ({ kind: 'stroke' } & StampStrokeSettings) | ({ kind: 'stamps' } & StampPlacementSettings);

type StampPaintRecipeDeposit = { id: string; deposit: StampPaintDeposit; protectedBy: readonly StampRegion[] };
type StampPaintRecipePass = { id: string; clipped: boolean; deposits: readonly StampPaintRecipeDeposit[] };
type StampPaintRecipeGroup = { id: string; options: StampGroupOptions; passes: readonly StampPaintRecipePass[] };

/** A recipe as written, IDs unchecked: `compileStampPaintRecipe` checks it. */
export type StampPaintRecipe = { groups: readonly StampPaintRecipeGroup[] };

/** Writes a recipe by calling `body`, which declares groups, their passes and the passes' deposits in painting order. */
export function stampPaintRecipe(body: (paint: StampPaintScope) => void): StampPaintRecipe {
  const groups: StampPaintRecipeGroup[] = [];
  let protectedBy: readonly StampRegion[] = [];
  const protect: StampProtect = (regions, inner) => {
    const outer = protectedBy;
    protectedBy = [...outer, ...regions];
    try {
      inner();
    } finally {
      protectedBy = outer;
    }
  };
  body({
    protect,
    group(id, options, groupBody) {
      const passes: StampPaintRecipePass[] = [];
      groups.push({ id, options, passes });
      groupBody({
        protect,
        pass(passId, { clipped = false }, passBody) {
          const deposits: StampPaintRecipeDeposit[] = [];
          passes.push({ id: passId, clipped, deposits });
          passBody({
            protect,
            stroke: (depositId, settings) => deposits.push({ id: depositId, deposit: { kind: 'stroke', ...settings }, protectedBy }),
            stamps: (depositId, settings) => deposits.push({ id: depositId, deposit: { kind: 'stamps', ...settings }, protectedBy }),
          });
        },
      });
    },
  });
  return { groups };
}

export type CompiledStampDeposit = {
  /** `<group>/<pass>/<deposit>`, unique in the painting: the seed of every stamp in it. */
  id: string;
  /** A stroke's stamps overlap along its path; placed stamps each land alone. */
  kind: StampPaintDeposit['kind'];
  brush: StampBrush;
  /** Its material, its colour moved by the brush's stroke colour jitter. */
  material: PaintMaterial;
  secondaryColor: StampPaintColor;
  /** Where the brush's grain and its dual's start, as shares of their tiles: each deposit's own, by offset jitter. */
  grainOffset: { main: readonly [number, number]; dual: readonly [number, number] };
  /** The stamp's diameter at full size, as the deposit states it: what its texturized grain and edges scale with. */
  diameter: number;
  blend: StampBlend;
  opacity: number;
  protectedBy: readonly StampRegion[];
  /** When it shows (StampDepositReveal): from `at` seconds, drawn over `over` (0 lands whole); none, there throughout. */
  reveal?: { at: number; over: number };
  /** Every stamp of the finished deposit, in reveal order. */
  stamps: readonly PlacedStamp[];
  /** The brush's dual stamps, placed by its own settings along the same stroke, in reveal order; none without one. */
  dualStamps: readonly PlacedStamp[];
};

export type CompiledStampPass = {
  /** `<group>/<pass>`. */
  id: string;
  /** The pass this one is clipped to, by ID: it lands only where that pass holds paint. Absent for an unclipped pass. */
  clipTo?: string;
  deposits: readonly CompiledStampDeposit[];
};

export type CompiledStampGroup = { id: string; composite: 'opaque' | 'glaze'; opacity: number; passes: readonly CompiledStampPass[] };

/** A checked recipe with every stamp placed, its groups in the order they paint. */
export type CompiledStampPaint = { groups: readonly CompiledStampGroup[] };

/**
 * Checks `recipe` and places every stamp. Throws on an ID used twice at one level (it would seed two deposits alike),
 * an empty ID or one holding `/` or `|` (the seed's separators), a clipped pass with nothing before it to clip to, a
 * deposit with no points or a diameter that isn't positive, a stroke point whose speed isn't positive, and a negative
 * `drawnOver`.
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
  const groups = recipe.groups.map(({ id, options, passes }, written) => {
    const groupId = claim(id);
    let clipBase: string | undefined;
    const compiledPasses = passes.map((pass): CompiledStampPass => {
      const passId = claim(pass.id, groupId);
      if (pass.clipped && !clipBase) throw new Error(`stamp paint: ${passId} is clipped, but no unclipped pass comes before it in ${groupId}`);
      const clipTo = pass.clipped ? clipBase : undefined;
      if (!pass.clipped) clipBase = passId;
      const deposits = pass.deposits.map(({ id: depositId, deposit, protectedBy }): CompiledStampDeposit => {
        const full = claim(depositId, passId);
        const { brush, material, blend = brush.blend, opacity = 1, appliedAt, drawnOver, diameter } = deposit;
        if (!(diameter > 0) || !Number.isFinite(diameter)) throw new Error(`stamp paint: ${full} has diameter ${diameter}, and a stamp needs a positive one`);
        if (drawnOver !== undefined && drawnOver < 0) throw new Error(`stamp paint: ${full} draws over ${drawnOver}s, and a draw takes no less than 0`);
        if (!(deposit.kind === 'stroke' ? deposit.path : deposit.at).length) throw new Error(`stamp paint: ${full} has no points to stamp`);
        if (deposit.kind === 'stroke' && deposit.path.some(({ speed }) => speed !== undefined && !(speed > 0))) throw new Error(`stamp paint: ${full} has a point whose speed isn't positive`);
        // The hand's path is worked out once, so the main stamps and the dual's follow the same wobble.
        const path = deposit.kind !== 'stroke' ? [] : deposit.hand ? handStampStroke(deposit.path, deposit.hand, diameter, `${full}|hand`) : deposit.path;
        const place = (stamping: StampPlacementBrush, scale: number, seed: string) => deposit.kind === 'stroke'
          ? placeStrokeStamps(path, stamping, diameter * scale, seed)
          : placeAuthoredStamps(deposit.at.map((at) => (at.diameter === undefined ? at : { ...at, diameter: at.diameter * scale })), stamping, diameter * scale, seed);
        const stamps = place(brush, 1, full);
        const dualStamps = brush.dual ? place(brush.dual, brush.dual.scale, `${full}|dual`) : [];
        const random = seededRandom(`${full}|deposit|paint`);
        const offset = (layer?: StampBrushLayer) => [random(), random()].map((r) => r * (layer?.grain?.offsetJitter ?? 0)) as [number, number];
        const grainOffset = { main: offset(brush), dual: offset(brush.dual) };
        const color = brush.color ? strokeColor(material.color, brush.color.stroke, [random(), random(), random(), random()]) : material.color;
        return {
          id: full, kind: deposit.kind, brush, material: { ...material, color }, secondaryColor: deposit.secondaryColor ?? material.color, grainOffset,
          diameter, blend, opacity, protectedBy, ...(appliedAt !== undefined && { reveal: { at: appliedAt, over: drawnOver ?? 0 } }), stamps, dualStamps,
        };
      });
      return { id: passId, clipTo, deposits };
    });
    const opacity = options.composite === 'glaze' ? options.opacity : 1;
    return { written, order: options.order ?? 0, depth: options.depth ?? 0, group: { id: groupId, composite: options.composite, opacity, passes: compiledPasses } };
  });
  if (duplicates.size) throw new Error(`stamp paint: IDs used twice, which would seed two deposits alike: ${[...duplicates].join(', ')}`);
  groups.sort((a, b) => a.order - b.order || b.depth - a.depth || a.written - b.written);
  return { groups: groups.map(({ group }) => group) };
}

/**
 * How many of `deposit`'s stamps (or its dual stamps) show at `t` seconds: none before `appliedAt`, then a growing
 * prefix of them.
 */
export function visibleStampCountAt(deposit: CompiledStampDeposit, t: number, which: 'stamps' | 'dualStamps' = 'stamps'): number {
  const stamps = deposit[which];
  const { reveal } = deposit;
  if (!reveal) return stamps.length;
  if (t < reveal.at) return 0;
  const progress = reveal.over ? Math.min(1, (t - reveal.at) / reveal.over) : 1;
  // Stamps come in reveal order, so the count is where `progress` would sort among them.
  let low = 0, high = stamps.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (stamps[middle].reveal <= progress) low = middle + 1;
    else high = middle;
  }
  return low;
}

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
