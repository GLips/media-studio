// stamp-wetness.ts: how a wash's paper dries and what a deposit lands on, by laws in closed form, and the shapes a
// painting's wetness is held in: each deposit's landing and each wash's dryings. When deposits land is decided
// elsewhere: by a recipe's waits (stamp-wash-waits.ts), each wash's bookkeeping kept by its ledger
// (stamp-wash-ledger.ts).
//
// Where water lands is per pixel, in each wash's wet field on the GPU (studio/stamp-wet-field.ts). Wetness and
// workability follow in closed form by the laws here, which STAMP_WET_PAPER_WGSL runs per pixel.

import type { PaintMedium, PaintWetting } from '#lib/paint/materials/models/paint-medium.ts';
import { stampDepositWater } from './stamp-paint-action.ts';
import { stampPassDeposits, type CompiledStampDeposit, type CompiledStampGroup, type CompiledStampPaint, type CompiledStampPass } from './stamp-paint-recipe-compile.ts';
import type { StampPaintPaper } from './stamp-paint-recipe-types.ts';
import type { CompiledStampWashWait } from './stamp-wash-effects.ts';

/**
 * How paper dries, from its medium and itself: water leaves at `rate` of a full wash a second, evenly, as standing
 * water evaporates and soaks in; `openTime`, and `shiny` and `damp` (its sheen), are the medium's (PaintWetting).
 */
export type StampDrying = { rate: number; openTime: number; shiny: number; damp: number };

/** A paper's absorbency when it doesn't say. */
export const STAMP_PAPER_ABSORBENCY = 0.5;

/** A soft, unsized paper drinks a wash sooner than a hard-sized one: at absorbency 0.5, a full wash dries in `drying` s. */
export function stampDrying(wetting: PaintWetting, paper: StampPaintPaper): StampDrying {
  return { rate: (0.5 + (paper.absorbency ?? STAMP_PAPER_ABSORBENCY)) / wetting.drying, openTime: wetting.openTime, ...wetting.sheen };
}

/** Wetness at painting time `tau` of paper wetted to `level` at `at`. */
export const stampWetnessAt = (level: number, at: number, tau: number, { rate }: StampDrying) => Math.max(0, level - rate * (tau - at));

/**
 * How workable paint is at `tau` on paper wetted to `level` at `at`: fully while the paper is wetter than damp, then
 * falling with its water. Paint sets `openTime` behind its water: it's as workable as the paper was that long before.
 */
export function stampWorkableAt(level: number, at: number, tau: number, { rate, openTime, damp }: StampDrying): number {
  return Math.min(1, Math.max(0, level - rate * Math.max(0, tau - at - openTime)) / damp);
}

/**
 * The paper at painting time `tau` from a texel of a wash's wet field (`field`: the level its water last went to, the
 * time it went there, and whether it had dried out since, StampWetPaper's settled, when last written), as its
 * `drying` (rate, openTime, damp) dries it: stampWetnessAt and stampWorkableAt per pixel, and settled once it's set.
 */
export const STAMP_WET_PAPER_WGSL = /* wgsl */ `
struct WetPaper { wetness: f32, workable: f32, settled: f32 }
fn wetPaperAt(field: vec4f, tau: f32, drying: vec3f) -> WetPaper {
  let since = tau - field.y;
  let workable = clamp(max(0.0, field.x - drying.x * max(0.0, since - drying.y)) / drying.z, 0.0, 1.0);
  return WetPaper(max(0.0, field.x - drying.x * since), workable, select(field.z, 1.0, workable <= 0.0));
}`;

/**
 * How wet paper `now` wet is once a deposit's tool touched `contact` of it: at least as wet as the `water` it carries,
 * as far as it touched; a lift (`lift`, its strength, null for none) soaks it up. The one law of where water lands,
 * which the wet field runs per pixel as STAMP_LANDED_WETNESS_WGSL (a negative `lift` for none).
 */
export const stampLandedWetness = (now: number, contact: number, water: number, lift: number | null) =>
  (lift === null ? now + contact * (Math.max(now, water) - now) : now * (1 - contact * lift));
export const STAMP_LANDED_WETNESS_WGSL = /* wgsl */ `fn landedWetness(now: f32, contact: f32, water: f32, lift: f32) -> f32 {
  return select(now + contact * (max(now, water) - now), now * (1.0 - contact * lift), lift >= 0.0);
}`;

/**
 * How much of a pixel a wash deposit's water reached: where its tool `touch`ed, as far as its paint landed there and
 * paint may land (`landed`, its footprint's r and g: grain holes stay dry, fluid and walls keep water out). What every
 * reader of a landing takes as its contact.
 */
export const STAMP_WET_CONTACT_WGSL = /* wgsl */ `fn wetContact(touch: f32, landed: vec2f) -> f32 {
  return touch * clamp(landed.x, 0.0, 1.0) * clamp(landed.y, 0.0, 1.0);
}`;

/**
 * Whether the paper under a deposit may still hold water (`wet`) or workable paint (`workable`) as it lands: by the
 * closed form over its wash's earlier water whose box meets its own. An overestimate, as a wait is.
 */
export type StampWetFinds = { wet: boolean; workable: boolean };

/**
 * A wash's deposit landing: `tau`, painting seconds into its wash; `water`, what its brush carries (0 for a lift); its
 * group's `medium`, and how its wash's paper dries (`drying`); and what it may find under it (`finds`).
 */
export type StampWetLanding = { tau: number; water: number; medium: PaintMedium; drying: StampDrying; finds: StampWetFinds };

/**
 * Whether `deposit` is walled: a flood whose edge is a barrier, which holds its water in and which its paint dries
 * against as on dry paper. The one rule for it, read by the wet field and the rim: the GPU lays only walled floods'
 * regions (and `within`s) as the rim's walls.
 */
export const stampDepositWalled = (deposit: CompiledStampDeposit) => deposit.kind === 'flood' && deposit.flood.edge.kind === 'barrier';

/**
 * How wet a flood stands where it touched, for its rim: a walled one (stampDepositWalled) holds its water in, so
 * water that reaches shine stands as a puddle (1), as wet as prewet paper, and its line rims on dry paper too. A lost
 * edge holds none back (it bleeds out), and nor does any other deposit: 0.
 */
export function stampFloodHeldWetness(deposit: CompiledStampDeposit, landing: Pick<StampWetLanding, 'water' | 'medium'>): number {
  if (!stampDepositWalled(deposit)) return 0;
  return Math.min(1, landing.water / Math.max(1e-3, landing.medium.wetting.sheen.shiny));
}

/**
 * A wait of a wash's: its step, the painting seconds it began and ended at, how many of the wash's earlier wettings
 * (its preparation, and deposits carrying water) it judged, and whether any of them was still `wet` as it began.
 */
export type StampWashWaitRecord = { step: CompiledStampWashWait; from: number; to: number; judged: number; wet: boolean };

/**
 * One drying of a wash: the deposits laid since the last, drying and rimming as one, closed at painting second `at`
 * once the whole wash had `set`, or at its `end`. `id` seeds its rim. `rim`, 0..2: its wait('set')'s, else its
 * wash's, else 1. `wettest`: the wettest its paper can have stood, at most 1.
 */
export type StampWashDrying = {
  id: string; deposits: readonly CompiledStampDeposit[]; rim: number; at: number; closes: 'set' | 'end'; wettest: number;
};

/**
 * A wash's record: how many painting seconds it took, its waits included, each wait in painting order, and its dryings
 * in painting order (what the rim stage and the wet report both read).
 */
export type StampWashRecord = { duration: number; waits: readonly StampWashWaitRecord[]; dryings: readonly StampWashDrying[] };

export type StampWetness = {
  landings: ReadonlyMap<CompiledStampDeposit, StampWetLanding>;
  washes: ReadonlyMap<CompiledStampPass, StampWashRecord>;
};

/**
 * A painting's media, bound once for the renderer and its washes: each group's medium (null in flat colour, which has
 * none), and each deposit's water, resolved in its group's medium (stampDepositWater). Both go by ID, so a boil
 * epoch's and live marks' read the ones written. Washes need a medium (StampPaintMedia<PaintMedium>).
 */
export type StampPaintMedia<M extends PaintMedium | null = PaintMedium | null> = {
  mediumOf: (group: Pick<CompiledStampGroup, 'id'>) => M; waterOf: (deposit: CompiledStampDeposit) => number;
};

/** `painting`'s media, each group's by `mediumOf`: every deposit's water resolved now, so a painting that can't be wet fails first. */
export function stampPaintMedia<M extends PaintMedium | null>(painting: CompiledStampPaint, mediumOf: (group: Pick<CompiledStampGroup, 'id'>) => M): StampPaintMedia<M> {
  const water = new Map(painting.groups.flatMap((group) => group.passes.flatMap((pass) => stampPassDeposits(pass).map((deposit) => [deposit.id, stampDepositWater(deposit, mediumOf(group))] as const))));
  return { mediumOf, waterOf: (deposit) => water.get(deposit.id)! };
}
