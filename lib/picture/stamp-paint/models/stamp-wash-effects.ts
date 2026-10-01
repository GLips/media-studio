// stamp-wash-effects.ts: a wash's waits and the wet effects built on them (a bloom's, a charge's, a backrun's), as
// written into a recipe (stamp-paint-recipe.ts). A wait judging the next application learns how many deposits that is
// only once it's written, so the wash scope wraps each application method in `applied`.

import type { StampBrush } from './stamp-brush.ts';
import { stampScatteredStrokePath, stampScatterMarks, type StampScatterAngle, type StampScatterPlacement } from './stamp-marks.ts';
import { pickStampMaterial, type StampMaterialSet } from './stamp-material-set.ts';
import type { StampMarkPaintSettings, StampWashWater } from './stamp-paint-recipe.ts';
import type { StampStrokePoint } from './stamp-placement.ts';
import type { StampRegion } from './stamp-region.ts';
import type { StampStrokeHand } from './stamp-stroke-hand.ts';

/**
 * Colour charged into a wet wash: `touches` short swelling strokes of `brush` scattered by `placement`
 * (stampScatterMarks), sizes in px from [min, max], each loaded from `mixtures` by its own key. They show in turn
 * over `appliedAt`..+`drawnOver`. `when: 'damp'` waits once first, until the paper under all of them is damp.
 * Written as strokes `${id}-0`, `${id}-1`…, each its own mark.
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
export type StampWaitOptions = { under?: StampWaitTarget };

/** A wet effect a wash method asks for, which the wet report (stamp-wet-report.ts) judges. */
export type StampWetEffectKind = 'bloom' | 'backrun' | 'charge';
/** A wet effect's own wait: what asked for it, its ID full once compiled, so a report can tell a bloom's drop from plain water. */
export type StampWaitEffect = { kind: StampWetEffectKind; id: string };
/**
 * A wait as written, judging the whole wash, the `next` deposits after it (the next application's, counted once it's
 * written), or a region.
 */
export type StampWrittenWait = { kind: 'wait'; until: StampWashWait; under: 'wash' | { next: number } | { region: StampRegion }; effect?: StampWaitEffect };

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
  const wait = (until: StampWashWait, { under = until === 'shiny' || until === 'damp' ? 'next' : 'wash' }: StampWaitOptions = {}) => {
    if ((typeof until === 'object' || until === 'dry') && under !== 'wash') {
      throw new Error(`stamp paint: ${scope.join('/')} waits ${JSON.stringify(until)} under ${JSON.stringify(under)}, and only a shiny or damp wait judges less than the wash`);
    }
    if (under !== 'next') {
      steps.push({ kind: 'wait', until, under });
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

/** A charge's touches as mark paint, each with its ID's suffix: its geometry from the charge's key `full`, its material from a stream of its own. */
export function stampChargeTouches(full: string, settings: StampChargeSettings): { suffix: string; settings: StampMarkPaintSettings & StampWashWater }[] {
  const { placement, touches, mixtures, brush, diameter, length, angle, water, appliedAt, drawnOver } = settings;
  if (!(Number.isInteger(touches) && touches >= 1)) throw new Error(`stamp paint: ${full} charges ${touches} touches, and a charge lays a whole number from 1`);
  // Separate streams: a new mixture moves no touch, and a moved touch changes no colour.
  const marks = stampScatterMarks(placement, { count: touches, length, diameter, ...(angle !== undefined && { angle }), key: full });
  return marks.map((scattered, k) => ({
    suffix: `-${k}`,
    settings: {
      mark: { key: scattered.key, brush, diameter: scattered.diameter, geometry: { kind: 'stroke', path: stampScatteredStrokePath(scattered), hand: { profile: 'swell' } } },
      material: pickStampMaterial(mixtures, `${full}|${k}|material`),
      appliedAt: appliedAt + (drawnOver * k) / touches, drawnOver: drawnOver / touches,
      ...(water !== undefined && { water }),
    },
  }));
}

/** `until` as compiled: a seconds wait is finite from 0. */
export function checkedStampWashWait(until: StampWashWait, passId: string): StampWashWait {
  if (typeof until === 'object' && !(until.seconds >= 0 && Number.isFinite(until.seconds))) throw new Error(`stamp paint: ${passId} waits ${until.seconds}s, and a wait takes a finite 0 or more`);
  return until;
}
