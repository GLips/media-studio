// stamp-wet-report.ts: what each wash's wet effects will find as they land, read off the same wetness the renderer
// paints by (compileStampWetness), so an author learns a bloom will merge before rendering it.
//
// It predicts eligibility by the engine's own rules (stampBloomVerdict), not a visible result: an eligible bloom can
// still be faint, and a drying's band here is an estimate, as the rim's real reach is a GPU fact (where paint went).

import type { PaintMedium } from '#lib/picture/paint/models/paint-medium.ts';
import type { CompiledStampDeposit, CompiledStampPaint, CompiledStampPass } from './stamp-paint-recipe.ts';
import type { CompiledStampWashWait, StampWaitEffect, StampWashWait, StampWetEffectKind } from './stamp-wash-effects.ts';
import { stampBloomVerdict } from './stamp-wet-bloom.ts';
import { stampDryingRimBand, stampDryingRimWetShare, stampDryingWettest } from './stamp-wet-rim.ts';
import { stampLandingCover, stampWaitDeposits, type StampWashWaitRecord, type StampWetness, type StampWetRange } from './stamp-wetness.ts';

/**
 * A wait: what it waits for, what it judged (the whole wash, the next application, a region), the effect that asked
 * for it, the painting seconds it spans and the paper it judged as it began and ended (StampWashWaitRecord).
 * `alreadyDrier`: a shiny or damp wait whose paper was already past its target, so it took no time.
 */
export type StampWetReportWait = Omit<StampWashWaitRecord, 'step'> & {
  until: StampWashWait; under: 'wash' | 'next' | 'region'; effect: StampWaitEffect | null; seconds: number; alreadyDrier: boolean;
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
 * A drying (a wait('dry') or the wash's end) of `deposits` laid since the last: at painting second `at`, how far above
 * damp its wettest paper was (`wetShare`, 0..1), and its rim's band, px, as the rim stage would size it: an estimate.
 * `rim`: its strength (StampWashDrying's).
 */
export type StampWetReportDrying = { closes: 'wait' | 'end'; at: number; deposits: number; wetShare: number; band: number; rim: number };

export type StampWetReportWash = { id: string; duration: number; waits: readonly StampWetReportWait[]; effects: readonly StampWetReportEffect[]; dryings: readonly StampWetReportDrying[] };
export type StampWetReport = { washes: readonly StampWetReportWash[] };

/** Every wash of `painting`, as `wetness` (compileStampWetness's, for the same painting) lands it in `medium`. */
export function stampWetReport(painting: CompiledStampPaint, wetness: StampWetness, medium: PaintMedium): StampWetReport {
  const washes = painting.groups.flatMap((group) => group.passes).flatMap((pass) => {
    const record = wetness.washes.get(pass);
    return pass.kind === 'wash' && record ? [washReport(pass, wetness, medium)] : [];
  });
  return { washes };
}

function washReport(pass: Extract<CompiledStampPass, { kind: 'wash' }>, wetness: StampWetness, medium: PaintMedium): StampWetReportWash {
  const { schedule } = pass.wash, record = wetness.washes.get(pass)!, { duration } = record;
  const waits = record.waits.map(({ step: { until, under, effect }, ...judged }): StampWetReportWait => ({
    until, under: underKind(under), effect: effect ?? null, ...judged,
    seconds: judged.to - judged.from, alreadyDrier: (until === 'shiny' || until === 'damp') && judged.to === judged.from && judged.points > 0,
  }));
  const effects: StampWetReportEffect[] = [];
  const dryings: StampWetReportDrying[] = [];
  let since: CompiledStampDeposit[] = [], waited = 0;
  const dry = (closes: StampWetReportDrying['closes'], at: number, rim = pass.wash.rim ?? 1) => {
    const painted = since.filter((deposit) => deposit.action.kind === 'paint');
    const grid = since.length ? stampDryingWettest({ deposits: since }, wetness) : null;
    if (grid && painted.length) {
      const wetShare = stampDryingRimWetShare(grid.values.reduce((most, value) => Math.max(most, value), 0), medium.wetting.sheen.damp);
      const diameter = painted.reduce((sum, deposit) => sum + deposit.diameter, 0) / painted.length;
      dryings.push({ closes, at, deposits: since.length, wetShare, band: stampDryingRimBand(medium.wetting.spread, diameter, wetShare), rim });
    }
    since = [];
  };
  for (const [index, step] of schedule.entries()) {
    if (step.kind === 'deposit') {
      since.push(step.deposit);
      continue;
    }
    const wait = record.waits[waited++];
    if (step.until === 'dry') dry('wait', wait.to, step.rim);
    if (step.effect) effects.push(effectReport(step.effect, stampWaitDeposits(schedule, index).map((deposit) => touchReport(deposit, pass, wetness, medium))));
  }
  dry('end', duration);
  return { id: pass.id, duration, waits, effects, dryings };
}

function underKind(under: CompiledStampWashWait['under']): StampWetReportWait['under'] {
  if (under === 'wash') return 'wash';
  return 'next' in under ? 'next' : 'region';
}

function touchReport(deposit: CompiledStampDeposit, pass: CompiledStampPass, wetness: StampWetness, medium: PaintMedium): StampWetReportTouch {
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
  const verdict = stampBloomVerdict(landing, medium.wetting, deposit.diameter);
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

/** Throws, listing them, when any effect `report` holds certainly won't act (stampWetReportWarnings): for a test to hold a painting to its effects. */
export function assertStampWetEffects(report: StampWetReport): void {
  const warnings = stampWetReportWarnings(report);
  if (warnings.length) throw new Error(`stamp paint: ${warnings.length} wet effect(s) won't act:\n${warnings.join('\n')}`);
}
