// stamp-wash-waits.ts: a recipe's washes landed at the painting seconds their waits set, worked out once. Painting
// time starts at 0 with each wash; only its waits advance it. Each wash's ledger (stamp-wash-ledger.ts) keeps what
// its deposits find and how it dries.
//
// A wait lasts in closed form (stampWashWaitSeconds): a deposit's water is taken to reach all of its box, so a wait
// may run long where a stroke touched only part of it, or a lift took water up.
//
// Negative space: washes share no water, and water doesn't spread past its brush.

import type { PaintMedium } from '#lib/paint/materials/models/paint-medium.ts';
import { stampPaintFieldEnds } from './stamp-paint-field.ts';
import type { CompiledStampDeposit, CompiledStampPaint, CompiledStampPass } from './stamp-paint-recipe-compile.ts';
import type { CompiledStampWashStep, StampWashWait } from './stamp-wash-effects.ts';
import { createStampWashLedger, type StampWetting } from './stamp-wash-ledger.ts';
import { stampPolygonBox, type StampBox } from './stamp-region.ts';
import { stampDepositSupport, type StampTipsOf } from './stamp-tip-support.ts';
import { stampDrying, stampWetnessAt, type StampDrying, type StampPaintMedia, type StampWashRecord, type StampWashWaitRecord, type StampWetLanding, type StampWetness } from './stamp-wetness.ts';

/**
 * Painting seconds a wash may still have to go and count as set: a seconds wait as long as wait('set') would take
 * lands within rounding of the moment, not on it.
 */
const STAMP_SET_SLACK = 1e-6;

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
    let prepared: StampWetting | null = null;
    if (preparation) {
      const { first, second } = stampPaintFieldEnds(preparation.wetness);
      prepared = { at: 0, level: Math.max(first, second), box: stampPolygonBox(preparation.polygon) };
    }
    const ledger = createStampWashLedger({
      id: pass.id, mediumOf: () => medium, drying, preparation: prepared, waterOf: media.waterOf, supportOf, reachOf: (deposit, water) => margin(deposit, medium, water),
    });
    let tau = 0;
    const waits: StampWashWaitRecord[] = [];
    const washRim = pass.wash.rim ?? 1;
    for (const [index, step] of schedule.entries()) {
      if (step.kind === 'deposit') {
        landings.set(step.deposit, ledger.land(step.deposit, tau));
        continue;
      }
      const { under } = step;
      // A wait judging only the deposits it names may close a drying while paper elsewhere is wet.
      let boxes: StampBox[] | undefined;
      if (under !== 'wash') boxes = 'deposits' in under ? stampWaitDeposits(schedule, index).flatMap((next) => supportOf(next) ?? []) : [stampPolygonBox(under.region)];
      const judged = ledger.wettings(boxes);
      const from = tau, wet = judged.some(({ level, at }) => stampWetnessAt(level, at, tau, drying) > 0);
      tau += stampWashWaitSeconds(judged, tau, step.until, drying);
      waits.push({ step, from, to: tau, judged: judged.length, wet });
      // The paper decides, not the token: any wait the whole wash has set by closes its drying, as wait('set') does.
      if (step.until === 'set' || stampWashWaitSeconds(ledger.wettings(), tau, 'set', drying) <= STAMP_SET_SLACK) ledger.dry(tau, 'set', step.rim ?? washRim);
    }
    ledger.dry(tau, 'end', washRim);
    washes.set(pass, { duration: tau, waits, dryings: ledger.dryings });
  }
  return { landings, washes };
}

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
