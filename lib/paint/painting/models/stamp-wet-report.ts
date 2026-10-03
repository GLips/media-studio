// stamp-wet-report.ts: what each wash's wet effects may find as they land, read off the same schedule the renderer
// paints by (compileStampWetness), so an author learns a bloom can't act before rendering it.
//
// Where water lands is a GPU fact, so this is an estimate from the schedule alone: an effect is warned of only where
// it certainly can't act (stampBloomBound, StampWetFinds); one that may can still merge or be faint, and a drying's
// band is the most its rim could reach.

import type { CompiledStampDeposit, CompiledStampPaint, CompiledStampPass } from './stamp-paint-recipe-compile.ts';
import type { CompiledStampWashWait, StampWaitEffect, StampWashWait, StampWetEffectKind } from './stamp-wash-effects.ts';
import { stampBloomBound } from './stamp-wet-bloom.ts';
import { stampDryingRimBound } from './stamp-wet-rim.ts';
import { stampWaitDeposits } from './stamp-wash-waits.ts';
import type { StampWashDrying, StampWashWaitRecord, StampWetFinds, StampWetness } from './stamp-wetness.ts';

/**
 * A wait: what it waits for and judged, what it stood before (the effect that asked, else its one deposit), its
 * seconds and the wettings it judged (StampWashWaitRecord). `alreadyDrier`: a sheen's water was already past it.
 * `attained`: false where that paper held no water. `inert`: why a sheen wait changed nothing, else null.
 * `authored`: a call asked for it (StampWrittenWait).
 */
export type StampWetReportWait = Omit<StampWashWaitRecord, 'step'> & {
  until: StampWashWait; under: 'wash' | 'deposits' | 'region'; effect: StampWaitEffect | null; before: string | null; seconds: number;
  alreadyDrier: boolean; attained: boolean; inert: string | null; authored: boolean;
};

/**
 * One deposit of an effect as it lands, `tau` painting seconds into its wash: what it may find under it, and whether
 * the bloom stage may act on it, its water spreading `sigma` px at most (stampBloomBound).
 */
export type StampWetReportTouch = {
  id: string; tau: number; finds: StampWetFinds; bloom: { mayAct: true; sigma: number } | { mayAct: false; reason: string };
};

/**
 * An effect asked for: a bloom or a backrun is `mayActing` where the bloom stage may act on its deposits; a charge, a
 * soften or a lift where the paint under it may still be workable, so it mingles, moves or comes up. `all`, `some` or
 * `none` of its touches.
 */
export type StampWetReportEffect = { kind: StampWetEffectKind; id: string; mayActing: 'all' | 'some' | 'none'; reason: string | null; touches: readonly StampWetReportTouch[] };

/**
 * A drying (StampWashDrying) of `deposits` laid since the last, closed as its wash `set` or at its `end`: at painting
 * second `at`, how far above damp its wettest paper can have been (`wetShare`, 0..1), and the widest its rim's band
 * can be, px (stampDryingRimBound). `rim`: its strength. None for a drying that painted nothing.
 */
export type StampWetReportDrying = { closes: StampWashDrying['closes']; at: number; deposits: number; wetShare: number; band: number; rim: number };

/** A wash's report; `strict` when its passage holds it to it (stampWetReportStrictFailures). */
export type StampWetReportWash = { id: string; duration: number; waits: readonly StampWetReportWait[]; effects: readonly StampWetReportEffect[]; dryings: readonly StampWetReportDrying[]; strict: boolean };
export type StampWetReport = { washes: readonly StampWetReportWash[] };

/** Every wash of `painting`, as `wetness` (compileStampWetness's, for the same painting) lands it, each in its group's medium. */
export function stampWetReport(painting: CompiledStampPaint, wetness: StampWetness): StampWetReport {
  const washes = painting.groups.flatMap((group) => group.passes).flatMap((pass) => {
    const record = wetness.washes.get(pass);
    return pass.kind === 'wash' && record ? [washReport(pass, wetness)] : [];
  });
  return { washes };
}

function washReport(pass: Extract<CompiledStampPass, { kind: 'wash' }>, wetness: StampWetness): StampWetReportWash {
  const { schedule } = pass.wash, record = wetness.washes.get(pass)!, { duration } = record;
  const waits = record.waits.map(({ step: { until, under, effect, authored }, ...judged }): StampWetReportWait => {
    const sheen = until === 'shiny' || until === 'damp';
    const attained = !sheen || judged.wet, alreadyDrier = sheen && attained && judged.to === judged.from;
    let inert: string | null = null;
    if (!attained) inert = `the paper under it held no water, so it was never ${until}`;
    else if (alreadyDrier) inert = `the paper under it was already no wetter than ${until}, so it waited 0 s; only paper wetter than that (prepared, or watered) waits`;
    const deposits = under !== 'wash' && 'deposits' in under ? under.deposits : [];
    return {
      until, under: underKind(under), effect: effect ?? null, before: effect?.id ?? (deposits.length === 1 ? deposits[0] : null), ...judged,
      seconds: judged.to - judged.from, alreadyDrier, attained, inert, authored: authored === true,
    };
  });
  const effects = schedule.flatMap((step, index) => step.kind === 'wait' && step.effect
    ? [effectReport(step.effect, stampWaitDeposits(schedule, index).map((deposit) => touchReport(deposit, wetness)))]
    : []);
  const dryings = record.dryings.flatMap((drying): StampWetReportDrying[] => {
    const bound = stampDryingRimBound(drying, wetness);
    if (!bound) return [];
    const { closes, at, deposits, rim } = drying;
    return [{ closes, at, deposits: deposits.length, wetShare: bound.wetShare, band: bound.band, rim }];
  });
  return { id: pass.id, duration, waits, effects, dryings, strict: pass.wash.strict === true };
}

function underKind(under: CompiledStampWashWait['under']): StampWetReportWait['under'] {
  if (under === 'wash') return 'wash';
  return 'deposits' in under ? 'deposits' : 'region';
}

function touchReport(deposit: CompiledStampDeposit, wetness: StampWetness): StampWetReportTouch {
  const landing = wetness.landings.get(deposit)!, bound = stampBloomBound(deposit, landing);
  return { id: deposit.id, tau: landing.tau, finds: landing.finds, bloom: bound.sigma === null ? { mayAct: false, reason: bound.reason } : { mayAct: true, sigma: bound.sigma } };
}

function effectReport({ kind, id }: StampWaitEffect, touches: readonly StampWetReportTouch[]): StampWetReportEffect {
  const failure = ({ finds, bloom }: StampWetReportTouch): string | null => {
    if (kind === 'bloom' || kind === 'backrun') return bloom.mayAct ? null : bloom.reason;
    return finds.workable ? null : 'the paint under it had set';
  };
  const failures = touches.map(failure), count = failures.filter((reason) => reason === null).length;
  let mayActing: StampWetReportEffect['mayActing'] = 'some';
  if (count === touches.length) mayActing = 'all';
  else if (!count) mayActing = 'none';
  const reasons = [...new Set(failures.filter((reason) => reason !== null))];
  return { kind, id, mayActing, reason: mayActing === 'all' ? null : reasons.join('; '), touches };
}

/**
 * One line per thing a wash asked for that certainly does nothing, for a console on load: an effect none of whose
 * touches will act, and an authored sheen wait or `when` that changed nothing (StampWetReportWait's `inert`).
 */
export function stampWetReportWarnings(report: StampWetReport): string[] {
  const verb: Record<StampWetEffectKind, string> = { bloom: "won't bloom", backrun: "won't backrun", charge: "won't mingle", soften: "won't soften", lift: 'lifts little' };
  return report.washes.flatMap((wash) => [
    ...wash.waits.flatMap(({ until, before, inert, authored }) => (inert && authored && typeof until === 'string' ? [`stamp paint: ${before ?? wash.id}'s wait until ${until} does nothing: ${inert}`] : [])),
    ...wash.effects.filter((effect) => effect.mayActing === 'none').map((effect) => `stamp paint: ${effect.id} (${effect.kind}) ${verb[effect.kind]}: ${effect.reason}`),
  ]);
}

/**
 * What fails a strict wash (StampPassageOptions' `strict`), a line each: its warnings (stampWetReportWarnings), and
 * a technique's own sheen condition that judged paper with no water. Only strict washes; none for a report without them.
 */
export function stampWetReportStrictFailures(report: StampWetReport): string[] {
  return report.washes.filter(({ strict }) => strict).flatMap((wash) => wash.waits
    .flatMap(({ until, before, attained, authored }) => (attained || authored || typeof until !== 'string' ? [] : [`stamp paint: ${wash.id}'s wait until ${until}${before ? ` (for ${before})` : ''} judged paper with no water: it was never ${until}`]))
    .concat(stampWetReportWarnings({ washes: [wash] })));
}

/**
 * Throws, listing them, when `report` warns (stampWetReportWarnings): an effect that certainly won't act, or a wait
 * that does nothing. For a test to hold a painting to what it asks of its paint.
 */
export function assertStampWetEffects(report: StampWetReport): void {
  const warnings = stampWetReportWarnings(report);
  if (warnings.length) throw new Error(`stamp paint: ${warnings.length} wet warning(s):\n${warnings.join('\n')}`);
}
