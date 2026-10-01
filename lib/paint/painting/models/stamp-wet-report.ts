// stamp-wet-report.ts: what each wash's wet effects will find as they land, read off the same wetness the renderer
// paints by (compileStampWetness), so an author learns a bloom will merge before rendering it.
//
// It predicts eligibility by the engine's own rules (stampBloomVerdict), not a visible result: an eligible bloom can
// still be faint, and a drying's band here is an estimate, as the rim's real reach is a GPU fact (where paint went).

import type { CompiledStampDeposit, CompiledStampPaint, CompiledStampPass } from './stamp-paint-recipe-compile.ts';
import type { CompiledStampWashWait, StampWaitEffect, StampWashWait, StampWetEffectKind } from './stamp-wash-effects.ts';
import { stampBloomVerdict } from './stamp-wet-bloom.ts';
import { stampDryingRimSizing } from './stamp-wet-rim.ts';
import { stampLandingCover, stampWaitDeposits, type StampWashWaitRecord, type StampWetness, type StampWetRange } from './stamp-wetness.ts';

/**
 * A wait: what it waits for and judged (the passage, a condition's deposits, a region), the effect that asked, its
 * painting seconds and the paper it judged (StampWashWaitRecord). `alreadyDrier`: a condition's paper was already
 * past its target. `attained`: false where a condition's paper held no water, so it never was shiny or damp.
 */
export type StampWetReportWait = Omit<StampWashWaitRecord, 'step'> & {
  until: StampWashWait; under: 'wash' | 'deposits' | 'region'; effect: StampWaitEffect | null; seconds: number; alreadyDrier: boolean; attained: boolean;
};

/**
 * One deposit of an effect as it lands, `tau` painting seconds into its wash: the paper under it (`dryShare`, of the
 * points it covers, those already dry: a local wait can't wet them again), and whether the bloom stage acts on it.
 */
export type StampWetReportTouch = {
  id: string; tau: number; wetness: StampWetRange; workable: StampWetRange; dryShare: number;
  bloom: { acts: true; drive: number; sigma: number } | { acts: false; reason: string };
};

/**
 * An effect asked for: a bloom or a backrun is `acting` where the bloom stage acts on its deposits; a charge into
 * damp paint where the paint under it is still workable, so it mingles. `all`, `some` or `none` of its touches.
 */
export type StampWetReportEffect = { kind: StampWetEffectKind; id: string; acting: 'all' | 'some' | 'none'; reason: string | null; touches: readonly StampWetReportTouch[] };

/**
 * A drying (StampWashDrying) of `deposits` laid since the last: at painting second `at`, how far above damp its
 * wettest paper was (`wetShare`, 0..1), and its rim's band, px, as the rim stage would size it, an estimate. `rim`:
 * its strength. None for a drying that painted nothing.
 */
export type StampWetReportDrying = { closes: 'wait' | 'end'; at: number; deposits: number; wetShare: number; band: number; rim: number };

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
  const waits = record.waits.map(({ step: { until, under, effect }, ...judged }): StampWetReportWait => {
    const condition = until === 'shiny' || until === 'damp';
    return {
      until, under: underKind(under), effect: effect ?? null, ...judged,
      seconds: judged.to - judged.from, alreadyDrier: condition && judged.to === judged.from && judged.points > 0,
      attained: !condition || (judged.points > 0 && judged.wetness.before.most > 0),
    };
  });
  const effects = schedule.flatMap((step, index) => step.kind === 'wait' && step.effect
    ? [effectReport(step.effect, stampWaitDeposits(schedule, index).map((deposit) => touchReport(deposit, pass, wetness)))]
    : []);
  const dryings = record.dryings.flatMap((drying): StampWetReportDrying[] => {
    const sizing = stampDryingRimSizing(drying, wetness);
    if (!sizing) return [];
    const { closes, at, deposits, rim } = drying;
    return [{ closes: closes === 'end' ? 'end' : 'wait', at, deposits: deposits.length, wetShare: sizing.wetShare, band: sizing.band, rim }];
  });
  return { id: pass.id, duration, waits, effects, dryings, strict: pass.wash.strict === true };
}

function underKind(under: CompiledStampWashWait['under']): StampWetReportWait['under'] {
  if (under === 'wash') return 'wash';
  return 'deposits' in under ? 'deposits' : 'region';
}

function touchReport(deposit: CompiledStampDeposit, pass: CompiledStampPass, wetness: StampWetness): StampWetReportTouch {
  const landing = wetness.landings.get(deposit)!, { before } = landing;
  const cover = stampLandingCover(deposit, before.window, pass);
  const wet: StampWetRange = { least: Infinity, most: 0 }, workable: StampWetRange = { least: Infinity, most: 0 };
  let covered = 0, dry = 0;
  cover.forEach((share, w) => {
    if (share <= 0) return;
    covered++;
    if (before.wetness[w] <= 0) dry++;
    wet.least = Math.min(wet.least, before.wetness[w]); wet.most = Math.max(wet.most, before.wetness[w]);
    workable.least = Math.min(workable.least, before.workable[w]); workable.most = Math.max(workable.most, before.workable[w]);
  });
  if (!covered) wet.least = workable.least = 0;
  const verdict = stampBloomVerdict(landing, landing.medium.wetting, deposit.diameter);
  return { id: deposit.id, tau: landing.tau, wetness: wet, workable, dryShare: covered ? dry / covered : 1, bloom: verdict.sizing ? { acts: true, ...verdict.sizing } : { acts: false, reason: verdict.reason } };
}

function effectReport({ kind, id }: StampWaitEffect, touches: readonly StampWetReportTouch[]): StampWetReportEffect {
  const failure = ({ workable, bloom }: StampWetReportTouch): string | null => {
    if (kind === 'charge') return workable.most > 0 ? null : 'the paint under it had set';
    return bloom.acts ? null : bloom.reason;
  };
  const failures = touches.map(failure), count = failures.filter((reason) => reason === null).length;
  let acting: StampWetReportEffect['acting'] = 'some';
  if (count === touches.length) acting = 'all';
  else if (!count) acting = 'none';
  const reasons = [...new Set(failures.filter((reason) => reason !== null))];
  return { kind, id, acting, reason: acting === 'all' ? null : reasons.join('; '), touches };
}

/** One line per effect that certainly won't act, for a console on load: none of its touches will. */
export function stampWetReportWarnings(report: StampWetReport): string[] {
  const verb: Record<StampWetEffectKind, string> = { bloom: "won't bloom", backrun: "won't backrun", charge: "won't mingle" };
  return report.washes.flatMap((wash) => wash.effects.filter((effect) => effect.acting === 'none').map((effect) => `stamp paint: ${effect.id} (${effect.kind}) ${verb[effect.kind]}: ${effect.reason}`));
}

/**
 * What fails a strict wash (StampPassageOptions' `strict`), a line each: a condition that judged paper with no water,
 * or an effect none of whose touches the engine will act on. Only strict washes; none for a report without them.
 */
export function stampWetReportStrictFailures(report: StampWetReport): string[] {
  return report.washes.filter(({ strict }) => strict).flatMap((wash) => wash.waits
    .flatMap(({ until, effect, attained }) => (attained || typeof until !== 'string' ? [] : [`stamp paint: ${wash.id}'s wait until ${until}${effect ? ` (for ${effect.id})` : ''} judged paper with no water: it was never ${until}`]))
    .concat(stampWetReportWarnings({ washes: [wash] })));
}

/** Throws, listing them, when any effect `report` holds certainly won't act (stampWetReportWarnings): for a test to hold a painting to its effects. */
export function assertStampWetEffects(report: StampWetReport): void {
  const warnings = stampWetReportWarnings(report);
  if (warnings.length) throw new Error(`stamp paint: ${warnings.length} wet effect(s) won't act:\n${warnings.join('\n')}`);
}
