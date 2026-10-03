// stamp-wetness.ts: when a wash's deposits land and how its paper dries, worked out once from the recipe. Painting
// time starts at 0 with each wash; only its waits advance it.
//
// Where water lands is per pixel, in each wash's wet field on the GPU (studio/stamp-wet-field.ts). Wetness and
// workability follow in closed form by the laws here, which STAMP_WET_PAPER_WGSL runs per pixel.
//
// A wait lasts in closed form too (stampWashWaitSeconds): a deposit's water is taken to reach all of its box, so a
// wait may run long where a stroke touched only part of it, or a lift took water up.
//
// Negative space: washes share no water, and water doesn't spread past its brush.

import type { PaintMedium, PaintWetting } from '#lib/paint/materials/models/paint-medium.ts';
import { stampDepositWater } from './stamp-paint-action.ts';
import { stampPaintFieldEnds } from './stamp-paint-field.ts';
import { stampPassDeposits, type CompiledStampDeposit, type CompiledStampGroup, type CompiledStampPaint, type CompiledStampPass } from './stamp-paint-recipe-compile.ts';
import type { StampPaintPaper } from './stamp-paint-recipe-types.ts';
import type { CompiledStampWashStep, CompiledStampWashWait, StampWashWait } from './stamp-wash-effects.ts';
import { stampPolygonBox, type StampBox } from './stamp-region.ts';
import { stampDepositSupport, type StampTipsOf } from './stamp-tip-support.ts';

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
 * by a wait the whole wash had set by, or its end. `id` seeds its rim. `rim`, 0..2: its wait('set')'s, else its
 * wash's, else 1. `wettest`: the wettest its paper can have stood, at most 1.
 */
export type StampWashDrying = {
  pass: CompiledStampPass; id: string; deposits: readonly CompiledStampDeposit[]; rim: number; at: number; closes: CompiledStampWashWait | 'end'; wettest: number;
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
 * Painting seconds a wash may still have to go and count as set: a seconds wait as long as wait('set') would take
 * lands within rounding of the moment, not on it.
 */
const STAMP_SET_SLACK = 1e-6;

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

/** Water a wash laid: as wet as `level` at painting second `at`, as far as `box` (null for none). */
type StampWetting = { at: number; level: number; box: StampBox | null };

/**
 * Every wash deposit's landing in `painting`, on its paper, by `media`'s paint and water, each wash starting from dry
 * paper (or its preparation) at painting time 0. What a deposit finds under it is read `margin(deposit, medium, water)`
 * px past where its stamps can lay paint (stampDepositSupport, by `tips`): a stage's `reach`.
 */
export function compileStampWetness(
  painting: CompiledStampPaint, media: StampPaintMedia<PaintMedium>, tips: StampTipsOf,
  margin: (deposit: CompiledStampDeposit, medium: PaintMedium, water: number) => number = () => 0,
): StampWetness {
  const { paper } = painting, landings = new Map<CompiledStampDeposit, StampWetLanding>(), washes = new Map<CompiledStampPass, StampWashRecord>();
  const supportOf = (deposit: CompiledStampDeposit) => stampDepositSupport(deposit, tips(deposit));
  for (const [group, pass] of painting.groups.flatMap((each) => each.passes.map((laid) => [each, laid] as const))) {
    if (pass.kind !== 'wash') continue;
    const medium = media.mediumOf(group), drying = stampDrying(medium.wetting, paper);
    const { preparation, schedule } = pass.wash;
    const wettings: StampWetting[] = [];
    if (preparation) {
      const { first, second } = stampPaintFieldEnds(preparation.wetness);
      wettings.push({ at: 0, level: Math.max(first, second), box: stampPolygonBox(preparation.polygon) });
    }
    let tau = 0;
    // The wettest any of the wash's water can still stand: what a drying starts from. A wait judging only the deposits
    // it names may close one while paper elsewhere is wet.
    const standing = () => Math.min(1, Math.max(0, ...wettings.map(({ level, at }) => stampWetnessAt(level, at, tau, drying))));
    let wettest = standing();
    const waits: StampWashWaitRecord[] = [], dryings: StampWashDrying[] = [];
    let since: CompiledStampDeposit[] = [];
    const washRim = pass.wash.rim ?? 1;
    const dry = (closes: StampWashDrying['closes'], rim: number) => {
      if (since.length) dryings.push({ pass, id: dryings.length ? `${pass.id}|dry${dryings.length}` : pass.id, deposits: since, rim, at: tau, closes, wettest });
      since = [];
      wettest = standing();
    };
    for (const [index, step] of schedule.entries()) {
      if (step.kind === 'wait') {
        const { under } = step;
        let boxes: StampBox[] | null = null;
        if (under !== 'wash') boxes = 'deposits' in under ? stampWaitDeposits(schedule, index).flatMap((next) => supportOf(next) ?? []) : [stampPolygonBox(under.region)];
        const judged = boxes ? wettings.filter(({ box }) => meetsAny(box, boxes)) : wettings;
        const from = tau, wet = judged.some(({ level, at }) => stampWetnessAt(level, at, tau, drying) > 0);
        tau += stampWashWaitSeconds(judged, tau, step.until, drying);
        waits.push({ step, from, to: tau, judged: judged.length, wet });
        // The paper decides, not the token: any wait the whole wash has set by closes its drying, as wait('set') does.
        if (step.until === 'set' || stampWashWaitSeconds(wettings, tau, 'set', drying) <= STAMP_SET_SLACK) dry(step, step.rim ?? washRim);
        continue;
      }
      const { deposit } = step, { action } = deposit, water = media.waterOf(deposit), support = supportOf(deposit);
      const reach = support && grown(support, margin(deposit, medium, water));
      const under = wettings.filter(({ box }) => meetsAny(box, reach ? [reach] : []));
      const finds = {
        wet: under.some(({ level, at }) => stampWetnessAt(level, at, tau, drying) > 0),
        workable: under.some(({ level, at }) => stampWorkableAt(level, at, tau, drying) > 0),
      };
      landings.set(deposit, { tau, water, medium, drying, finds });
      if (water > 0 && action.kind !== 'lift') {
        wettings.push({ at: tau, level: water, box: support });
        wettest = Math.max(wettest, Math.min(1, water), stampFloodHeldWetness(deposit, { water, medium }));
      }
      since.push(deposit);
    }
    dry('end', washRim);
    washes.set(pass, { duration: tau, waits, dryings });
  }
  return { landings, washes };
}

/** `box` grown by `pad` px on every side. */
const grown = ({ x0, y0, x1, y1 }: StampBox, pad: number): StampBox => ({ x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad });

/** Whether `box` overlaps any of `boxes`: none for a box of nothing. */
const meetsAny = (box: StampBox | null, boxes: readonly StampBox[]) =>
  !!box && boxes.some((other) => box.x0 < other.x1 && other.x0 < box.x1 && box.y0 < other.y1 && other.y0 < box.y1);

/**
 * Painting seconds from `tau` until `until` over the paper `wettings` laid: 'shiny' or 'damp' once the wettest is no
 * wetter than that, 'set' once no paint is workable. Each wetting reaches it in closed form, as if it covered its box
 * wholly and nothing wetter came after; the wait lasts to the latest, 0 if all are past it.
 */
function stampWashWaitSeconds(wettings: readonly StampWetting[], tau: number, until: StampWashWait, { rate, openTime, shiny, damp }: StampDrying): number {
  if (typeof until === 'object') return until.seconds;
  const floor = { shiny, damp, set: 0 }[until], lag = until === 'set' ? openTime : 0;
  let latest = tau;
  for (const { at, level } of wettings) if (level > floor) latest = Math.max(latest, at + lag + (level - floor) / rate);
  return latest - tau;
}

/** The deposits a condition at `index` of `schedule` judges: those it names, as they're laid after it. */
export function stampWaitDeposits(schedule: readonly CompiledStampWashStep[], index: number): CompiledStampDeposit[] {
  const step = schedule[index];
  const named = new Set(step.kind === 'wait' && typeof step.under === 'object' && 'deposits' in step.under ? step.under.deposits : []);
  return schedule.slice(index + 1).flatMap((later) => (later.kind === 'deposit' && named.has(later.deposit.id) ? [later.deposit] : []));
}
