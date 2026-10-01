// stamp-wash-effects.ts: a passage's waits, as written into a recipe (stamp-paint-passage.ts) by a state wait or an
// operation's condition, and the schedule of a passage with wet history as compiled. A wet effect (a bloom's, a
// charge's, a backrun's: stamp-wet-techniques.ts) is a condition that names what asked for it, for the wet report.

import { checkedStampPolygon } from './stamp-deposit-compile.ts';
import { stampDepositNameText, type StampDepositName } from './stamp-deposit-identity.ts';
import type { CompiledStampDeposit, CompiledStampMask } from './stamp-paint-recipe-compile.ts';
import type { StampSeededPaintField } from './stamp-paint-field.ts';
import type { StampPoint, StampRegion } from './stamp-region.ts';

/** A sheen an operation may wait for (PaintSheen): its paper no wetter than its medium's `shiny`, or `damp`. */
export type StampCondition = 'shiny' | 'damp';
/**
 * A passage waiting in painting time: until the paper it judges is no wetter than its medium's `shiny` or `damp`;
 * until the whole passage is `set`, its water gone and no paint workable, a drying (it rims); or for `seconds`, a
 * drying too if the whole passage has set by then.
 */
export type StampWashWait = StampCondition | 'set' | { seconds: number };

/** A wet effect a technique asks for, which the wet report (stamp-wet-report.ts) judges. */
export type StampWetEffectKind = 'bloom' | 'backrun' | 'charge';
/** A wet effect's own wait: what asked for it, its ID full once compiled, so a report can tell a bloom's drop from plain water. */
export type StampWaitEffect = { kind: StampWetEffectKind; id: string };
/**
 * A wait as written, judging the whole passage (`wash`), the deposits a condition stands before, by name, or a
 * region; a wait('set') may carry its drying's `rim`.
 */
export type StampWrittenWait = {
  kind: 'wait'; until: StampWashWait; under: 'wash' | { deposits: readonly StampDepositName[] } | { region: StampRegion }; rim?: number; effect?: StampWaitEffect;
};

/**
 * A passage with wet history in painting order: each deposit and each wait. `preparation` is the clean water laid
 * over its region before any of it, null for dry paper. `rim`, its dryings' unless a wait('set') says
 * (StampWashDrying), absent for the medium's own.
 */
export type CompiledStampWash = {
  /** `held`: a standing before's reserve, which its water doesn't reach either; absent for none (StampStandsBefore). */
  preparation: { polygon: readonly StampPoint[]; wetness: StampSeededPaintField<number>; held?: CompiledStampMask } | null;
  schedule: readonly CompiledStampWashStep[];
  rim?: number;
};
/**
 * A wait in a schedule: until `until`, judging the whole passage's wettest paper, the paper under the deposits it
 * stands before (by ID), or a region's, traced; `rim` a wait('set')'s own; `effect` when a wet effect asked for it.
 */
export type CompiledStampWashWait = {
  kind: 'wait'; until: StampWashWait; under: 'wash' | { deposits: readonly string[] } | { region: readonly StampPoint[] }; rim?: number; effect?: StampWaitEffect;
};
export type CompiledStampWashStep = { kind: 'deposit'; deposit: CompiledStampDeposit } | CompiledStampWashWait;

/**
 * A written wait as compiled into passage `passId`: a seconds wait finite from 0, its region traced, its deposits and
 * its effect named in full, its rim checked.
 */
export function compileStampWashWait({ until, under, rim, effect }: StampWrittenWait, passId: string): CompiledStampWashWait {
  if (typeof until === 'object' && !(until.seconds >= 0 && Number.isFinite(until.seconds))) throw new Error(`stamp paint: ${passId} waits ${until.seconds}s, and a wait takes a finite 0 or more`);
  const full = (name: StampDepositName) => `${passId}/${stampDepositNameText(name)}`;
  const judged = (): CompiledStampWashWait['under'] => {
    if (under === 'wash') return under;
    return 'region' in under ? { region: checkedStampPolygon(under.region, passId) } : { deposits: under.deposits.map(full) };
  };
  return {
    kind: 'wait', until, under: judged(),
    ...(rim !== undefined && { rim: checkedStampRim(rim, passId) }), ...(effect && { effect: { ...effect, id: `${passId}/${effect.id}` } }),
  };
}

/** A rim's strength as compiled, a passage's or a wait('set')'s: 0..2. */
export function checkedStampRim(rim: number, passId: string): number {
  if (!(rim >= 0 && rim <= 2)) throw new Error(`stamp paint: ${passId} rims at ${rim}, and a rim's strength is 0..2`);
  return rim;
}
