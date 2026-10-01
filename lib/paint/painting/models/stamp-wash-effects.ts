// stamp-wash-effects.ts: a wash's waits and the wet effects built on them (a bloom's, a charge's, a backrun's), as
// written into a recipe (stamp-paint-recipe.ts), and a wash's schedule as compiled. A wait judging the next
// application learns how many deposits that is only once it's written, so the wash scope wraps each application
// method in `applied`.

import type { StampBrush } from '#lib/paint/brush/models/stamp-brush.ts';
import { stampScatteredStrokePath, stampScatterMarks, type StampScatterAngle, type StampScatterPlacement } from './stamp-marks.ts';
import { pickStampMaterial, type StampMaterialSet } from './stamp-material-set.ts';
import { checkedStampPolygon } from './stamp-deposit-compile.ts';
import type { CompiledStampDeposit, CompiledStampMask } from './stamp-paint-recipe-compile.ts';
import type { StampMarkPaintSettings, StampWashWater } from './stamp-paint-recipe-types.ts';
import type { StampSeededPaintField } from './stamp-paint-field.ts';
import type { StampStrokePoint } from '#lib/paint/brush/models/stamp-placement.ts';
import type { StampPoint, StampRegion } from './stamp-region.ts';
import type { StampStrokeHand } from '#lib/paint/brush/models/stamp-stroke-hand.ts';

/**
 * Colour charged into a wet wash: `touches` short swelling strokes of `brush` scattered by `placement`
 * (stampScatterMarks), sizes in px from [min, max], each loaded from `mixtures` by its own key. They show in turn
 * over `appliedAt`..+`drawnOver`. `when: 'damp'` waits once first, until the paper under all of them is damp.
 * Written as strokes `${id}` keyed `0`, `1`…, each a mark.
 */
export type StampChargeSettings = {
  placement: StampScatterPlacement;
  touches: number;
  mixtures: StampMaterialSet;
  brush: StampBrush;
  diameter: readonly [number, number];
  length: readonly [number, number];
  angle?: StampScatterAngle;
  water?: number;
  when?: 'now' | 'damp';
  appliedAt: number;
  drawnOver: number;
};
/**
 * A backrun on purpose: clean water (`water`, 1 when left out) stroked `along` an authored junction once the paper
 * under it is damp, pushing paint back into a lobed edge. Sugar for wait('damp') under it and a water
 * stroke; whether it blooms is the bloom stage's call.
 */
export type StampBackrunSettings = {
  along: readonly StampStrokePoint[];
  brush: StampBrush;
  diameter: number;
  /** Left out, a taper. */
  hand?: StampStrokeHand;
  water?: number;
  opacity?: number;
  appliedAt: number;
  drawnOver?: number;
};
/**
 * A wash waiting in painting time: until the paper it judges is no wetter than its medium's `shiny` or `damp`
 * (PaintSheen); until the whole wash is `dry`, its water gone and no paint workable, a drying (it rims); or, the
 * advanced form, for `seconds`, which dries the paper as long without a drying event.
 */
export type StampWashWait = 'shiny' | 'damp' | 'dry' | { seconds: number };
/**
 * What a shiny or damp wait judges: the paper under the next application written after it (`'next'`, the default:
 * a stroke, a fill, a bloom's drop, a charge's touches together), the wettest paper in the whole wash, or a region.
 * A dry wait and a seconds wait are the wash's.
 */
export type StampWaitTarget = 'next' | 'wash' | { region: StampRegion };
/**
 * What a wait judges (StampWaitTarget), and a wait('dry')'s `rim`: how strongly its drying's rim gathers pigment, 0..2
 * (StampWashOptions' `rim`), its wash's when left out. Only a wait for dry takes a rim: no other wait rims.
 */
export type StampWaitOptions = { under?: StampWaitTarget; rim?: number };

/** A wet effect a wash method asks for, which the wet report (stamp-wet-report.ts) judges. */
export type StampWetEffectKind = 'bloom' | 'backrun' | 'charge';
/** A wet effect's own wait: what asked for it, its ID full once compiled, so a report can tell a bloom's drop from plain water. */
export type StampWaitEffect = { kind: StampWetEffectKind; id: string };
/**
 * A wait as written, judging the whole wash, the `next` deposits after it (the next application's, counted once it's
 * written), or a region; a wait('dry') may carry its drying's `rim`.
 */
export type StampWrittenWait = { kind: 'wait'; until: StampWashWait; under: 'wash' | { next: number } | { region: StampRegion }; rim?: number; effect?: StampWaitEffect };

/**
 * A wash's waits written into `steps`: `applied` wraps an application method so the waits before it judging the next
 * judge its deposits; `ended` refuses a wait left with nothing after it to judge.
 */
export function stampWashWaits(scope: readonly string[], steps: (StampWrittenWait | { kind: 'deposit' })[]) {
  let pending: (StampWrittenWait & { under: { next: number } })[] = [];
  const applied = <A extends unknown[]>(write: (...args: A) => void) => (...args: A) => {
    const waiting = pending, first = steps.length;
    pending = [];
    write(...args);
    const written = steps.slice(first).filter((step) => step.kind === 'deposit').length;
    for (const step of waiting) step.under.next = written;
  };
  /** An effect's wait until the paper under the `next` deposits it writes after it is damp. */
  const waitUnder = (next: number, kind: StampWetEffectKind, id: string) => steps.push({ kind: 'wait', until: 'damp', under: { next }, effect: { kind, id } });
  const wait = (until: StampWashWait, { under = until === 'shiny' || until === 'damp' ? 'next' : 'wash', rim }: StampWaitOptions = {}) => {
    if ((typeof until === 'object' || until === 'dry') && under !== 'wash') {
      throw new Error(`stamp paint: ${scope.join('/')} waits ${JSON.stringify(until)} under ${JSON.stringify(under)}, and only a shiny or damp wait judges less than the wash`);
    }
    if (rim !== undefined && until !== 'dry') throw new Error(`stamp paint: ${scope.join('/')} gives a rim to a wait for ${JSON.stringify(until)}, and only a wait for dry rims`);
    if (under !== 'next') {
      steps.push({ kind: 'wait', until, under, ...(rim !== undefined && { rim }) });
      return;
    }
    const step = { kind: 'wait' as const, until, under: { next: 0 } };
    steps.push(step);
    pending.push(step);
  };
  const ended = () => {
    const [left] = pending;
    if (left) throw new Error(`stamp paint: ${scope.join('/')} waits until ${JSON.stringify(left.until)} under the next application, and nothing is painted after it`);
  };
  return { applied, waitUnder, wait, ended };
}

/**
 * A charge's touches as mark paint, each with its key among the charge's children (touch k's is `k`): its geometry
 * from the charge's full ID `full`, its material from a stream of its own.
 */
export function stampChargeTouches(full: string, settings: StampChargeSettings): { key: string; settings: StampMarkPaintSettings & StampWashWater }[] {
  const { placement, touches, mixtures, brush, diameter, length, angle, water, appliedAt, drawnOver } = settings;
  if (!(Number.isInteger(touches) && touches >= 1)) throw new Error(`stamp paint: ${full} charges ${touches} touches, and a charge lays a whole number from 1`);
  // Separate streams: a new mixture moves no touch, and a moved touch changes no colour.
  const marks = stampScatterMarks(placement, { count: touches, length, diameter, ...(angle !== undefined && { angle }), key: full });
  return marks.map((scattered, k) => ({
    key: `${k}`,
    settings: {
      mark: { key: scattered.key, brush, diameter: scattered.diameter, geometry: { kind: 'stroke', path: stampScatteredStrokePath(scattered), hand: { profile: 'swell' } } },
      material: pickStampMaterial(mixtures, `${full}|${k}|material`),
      appliedAt: appliedAt + (drawnOver * k) / touches, drawnOver: drawnOver / touches,
      ...(water !== undefined && { water }),
    },
  }));
}

/**
 * A wash in painting order: each deposit and each wait. `preparation` is the clean water laid over its region before
 * any of it, null for dry paper. `rim`, its dryings' unless a wait('dry') says (stampWashDryings), absent for the
 * medium's own.
 */
export type CompiledStampWash = {
  /** `held`: a standing before's reserve, which its water doesn't reach either; absent for none (StampStandsBefore). */
  preparation: { polygon: readonly StampPoint[]; wetness: StampSeededPaintField<number>; held?: CompiledStampMask } | null;
  schedule: readonly CompiledStampWashStep[];
  rim?: number;
};
/**
 * A wait in a wash's schedule: until `until`, judging the whole wash's wettest paper, the paper under the `next`
 * deposits after it (waits between skipped), or a region's, traced; `rim` a wait('dry')'s own; `effect` when a wet
 * effect asked for it.
 */
export type CompiledStampWashWait = {
  kind: 'wait'; until: StampWashWait; under: 'wash' | { next: number } | { region: readonly StampPoint[] }; rim?: number; effect?: StampWaitEffect;
};
export type CompiledStampWashStep = { kind: 'deposit'; deposit: CompiledStampDeposit } | CompiledStampWashWait;

/** A written wait as compiled into pass `passId`: a seconds wait finite from 0, its region traced, its rim checked, its effect's ID full. */
export function compileStampWashWait({ until, under, rim, effect }: StampWrittenWait, passId: string): CompiledStampWashWait {
  if (typeof until === 'object' && !(until.seconds >= 0 && Number.isFinite(until.seconds))) throw new Error(`stamp paint: ${passId} waits ${until.seconds}s, and a wait takes a finite 0 or more`);
  return {
    kind: 'wait', until, under: typeof under === 'object' && 'region' in under ? { region: checkedStampPolygon(under.region, passId) } : under,
    ...(rim !== undefined && { rim: checkedStampRim(rim, passId) }), ...(effect && { effect: { ...effect, id: `${passId}/${effect.id}` } }),
  };
}

/** A rim's strength as compiled, a wash's or a wait('dry')'s: 0..2. */
export function checkedStampRim(rim: number, passId: string): number {
  if (!(rim >= 0 && rim <= 2)) throw new Error(`stamp paint: ${passId} rims at ${rim}, and a rim's strength is 0..2`);
  return rim;
}
