// shot-painting-in-time.ts: a painting whose properties vary in time, as a painted plane's source (paintingInTime).
// As the shot loads, its values are sampled at every moment its plane's source reads, numbers quantised to their
// steps, and its key drawings chosen (shot-key-drawings.ts) and evaluated. A frame dissolves the two keys either side
// of its values by how far they've come. The plan names each key and why, for `studio paint check` and the cost
// report.
//
// Negative space: a painted texture and an instanced plane's variants take no painting in time. A plane's `clock`
// holds its presentation, not its source: `sourceClock` holds the moments this samples.

import { paintNodeTimeAt, type PaintSceneStep } from '#lib/paint/animation/models/paint-clock.ts';
import { paintSecondsText, paintSpanFrameRange } from '#lib/paint/animation/models/paint-span-moments.ts';
import { presentationValueAt, type PresentationValue } from '#lib/paint/animation/models/paint-value.ts';
import type { NodeKey } from '#lib/paint/document/models/painting-document.ts';
import { paintingField, paintingProblem, type PaintingProblem } from '#lib/paint/document/models/painting-problem.ts';
import {
  paintingSchemaProblems, paintingValuesKey, type PaintingPropertyRecord, type PaintingPropertyValue, type PropertySchema, type PropertySpec, type PropertyValue,
  type PropertyValues,
} from '#lib/paint/document/models/painting-properties.ts';
import { layersOf, type LayerSelection, type SelectionGround } from '#lib/paint/document/models/painting-selection.ts';
import { painting, paintingSourceName, type PaintingEvaluation, type PaintingSourceModule } from '#lib/paint/document/models/painting-source.ts';
import { paintMoment, type PaintMoment } from '#lib/paint/painting/models/stamp-paint-frame-state.ts';
import type { SceneShownSpan } from '#lib/timing/timeline/models/scene-seconds.ts';
import type { CompiledShotPlane } from './shot-compile.ts';
import { chooseShotKeyDrawings, shotKeyDissolveK, shotKeyDissolveMiss, type ShotKeyChoice, type ShotKeyReason, type ShotKeySample } from './shot-key-drawings.ts';
import { shotPlaneOccurrences } from './shot-occurrences.ts';
import { dissolve, paintedSourceProblems, type PaintedSource, type PaintedSourceEnd } from './shot-selection.ts';

/** A value for each property that moves: a constant, a keyed value or a callback of the moment. One left out holds its default. */
export type PaintingInTimeValues<S extends PropertySchema> = { readonly [K in keyof S]?: PresentationValue<PropertyValue<S[K]>> };

/**
 * `values` in time; `layers` of the source, laid on `ground`, their clocked washes and reveals shown at `at` (all of
 * both when left out), read at the plane's moment; `drawings`: the most distinct values it solves over the span.
 */
export type PaintingInTimeOptions<S extends PropertySchema> = {
  readonly values: PaintingInTimeValues<S>;
  readonly layers: readonly NodeKey[];
  readonly ground?: SelectionGround;
  readonly at?: PresentationValue<number>;
  readonly drawings: number;
};

/** A painted plane's source whose properties vary in time (paintingInTime), its schema's types erased. */
export type PaintingInTime = {
  readonly kind: 'in-time';
  /** The source's name in problems and plans (paintingSourceName). */
  readonly source: string;
  readonly schema: PropertySchema;
  readonly values: Readonly<Record<string, PresentationValue<PaintingPropertyValue> | undefined>>;
  /** The source evaluated at full values its schema accepts, as painting() keeps it. */
  readonly paint: (values: PaintingPropertyRecord) => PaintingEvaluation;
  readonly layers: readonly NodeKey[];
  readonly ground?: SelectionGround;
  readonly at?: PresentationValue<number>;
  readonly drawings: number;
};

/** `source` painted with its properties in time, as a plane's source: the shot chooses which moments to solve. */
export function paintingInTime<S extends PropertySchema>(source: PaintingSourceModule<S>, options: PaintingInTimeOptions<S>): PaintingInTime {
  const { values, layers, ground, at, drawings } = options;
  return {
    kind: 'in-time', source: paintingSourceName(source), schema: source.properties ?? {}, values, layers, drawings, ...(ground && { ground }), ...(at !== undefined && { at }),
    // SAFETY: a plan paints only full values, each checked against the schema and on its step (planShotKeyDrawings).
    paint: (drawn) => painting(source, drawn as Partial<PropertyValues<S>>),
  };
}

type NumberSpec = Extract<PropertySpec, { readonly type: 'number' }>;

/** A number property a painting in time reads, by name. */
type ShotKeyNumber = { readonly name: string; readonly spec: NumberSpec };

/**
 * A key drawing: the moment it was chosen at, why, its values as painted (each number on its step) and its painting;
 * `unit`, those numbers 0..1 of their ranges, and `run`, its booleans and enums, which a frame reads.
 */
export type ShotKeyDrawing = {
  readonly moment: PaintMoment; readonly reason: ShotKeyReason; readonly values: PaintingPropertyRecord; readonly painting: PaintingEvaluation;
  readonly unit: readonly number[]; readonly run: string;
};

/**
 * A painting in time planned over a shot's span, for plane `plane`: its numbers, how many moments it sampled, its
 * keys in time order, and each drawing's selection once (its `ends`, as a dissolve's are).
 */
export type ShotKeyDrawings = {
  readonly kind: 'key-drawings'; readonly plane: string; readonly source: PaintingInTime; readonly numbers: readonly ShotKeyNumber[]; readonly sampled: number;
  readonly keys: readonly ShotKeyDrawing[]; readonly ends: readonly PaintedSourceEnd[];
};

/** The moments a source held by `sourceClock` reads over `span`'s frames, each once, in time order. */
export function shotSourceMoments(span: SceneShownSpan, sourceClock: readonly PaintSceneStep[], animationFps: number): PaintMoment[] {
  const { first, end } = paintSpanFrameRange(span), moments = new Map<string, PaintMoment>();
  for (let k = first; k < end; k++) {
    const held = paintNodeTimeAt(sourceClock, paintMoment(k / span.fps), animationFps);
    moments.set(`${held.at} ${held.frame}`, held);
  }
  return [...moments.values()].toSorted((a, b) => a.at - b.at);
}

/** Every property's value at `moment`: as `source` gives it, else its default. */
const valuesAt = (source: PaintingInTime, moment: PaintMoment): PaintingPropertyRecord => Object.fromEntries(Object.entries(source.schema).map(([name, spec]) => {
  const given = source.values[name];
  return [name, given === undefined ? spec.default : presentationValueAt(given, moment)];
}));

/** Why `value`, property `name`'s, isn't one `spec` takes: its type, or a number not finite or outside its range. Off its step is quantised. */
function sampledValueProblem(name: string, spec: PropertySpec, value: PaintingPropertyValue): string | null {
  if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${name} = ${String(value)} isn't a finite number`;
    return value >= spec.min && value <= spec.max ? null : `${name} = ${value} is outside ${spec.min}..${spec.max}`;
  }
  if (spec.type === 'boolean') return typeof value === 'boolean' ? null : `${name} = ${String(value)} isn't true or false`;
  return typeof value === 'string' && spec.values.includes(value) ? null : `${name} = ${String(value)} isn't one of ${spec.values.join(', ')}`;
}

/**
 * `value` on `spec`'s step from its min, the nearest within its range; as given with no step. Kept to 12 significant
 * digits, so three steps of 0.1 paint 0.3, one drawing however the arithmetic rounds.
 */
function onStep(value: number, { min, max, step }: NumberSpec): number {
  if (step === undefined) return value;
  const steps = Math.round((value - min) / step), within = min + steps * step > max + step * 1e-9 ? steps - 1 : steps;
  return Number((min + within * step).toPrecision(12));
}

/** `values`' numbers 0..1 of their ranges, in `numbers`' order: 0 for a range of one value. Anything else reads 0 too. */
const unitOf = (numbers: readonly ShotKeyNumber[], values: PaintingPropertyRecord) => numbers.map(({ name, spec: { min, max } }) => {
  const value = values[name];
  return typeof value === 'number' && max > min ? (value - min) / (max - min) : 0;
});

/** What a sample's booleans and enums are, for telling a cut. */
const runOf = (schema: PropertySchema, values: PaintingPropertyRecord) => JSON.stringify(Object.keys(schema).filter((name) => schema[name].type !== 'number').map((name) => values[name]));

/** Values as a plan prints them: those the source gives in time, in its schema's order. */
function valuesText(source: PaintingInTime, values: PaintingPropertyRecord): string {
  return Object.keys(source.schema).filter((name) => source.values[name] !== undefined).map((name) => `${name} ${String(values[name])}`).join(', ');
}

const keyText = (source: PaintingInTime, { moment, values }: Pick<ShotKeyDrawing, 'moment' | 'values'>) => {
  const given = valuesText(source, values);
  return given ? `${paintSecondsText(moment.at)} (${given})` : paintSecondsText(moment.at);
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Why each of `keys` is one, as a plan prints it. */
const KEY_REASONS: Readonly<Record<ShotKeyReason, string>> = {
  first: 'the first moment', last: 'the last moment', cut: 'a cut, a boolean or enum changing', turn: 'where its values turn', between: 'halfway along a change',
};

/** A stretch a frame dissolves: key `a` toward `b` by `k` (`b` null: `a` alone), and what its values miss that by, 0..1 of their ranges. */
type ShotKeyStretch = { readonly a: ShotKeyDrawing; readonly b: ShotKeyDrawing | null; readonly k: number; readonly miss: readonly number[] };

/**
 * The stretch a frame dissolves, its numbers `unit`, `index` the key at or before it: of the stretches round that key
 * within its run, the one its values lie nearest. A drawing's values sit up to half a step from its key moment's, so
 * a frame changes stretch where its values pass a drawing's, not at the key's moment.
 */
function keyStretchAt(keys: readonly ShotKeyDrawing[], index: number, unit: readonly number[]): ShotKeyStretch {
  const { run } = keys[index];
  let nearest: (ShotKeyStretch & { readonly off: number }) | null = null;
  for (const at of [index, index - 1, index + 1]) {
    if (at < 0 || at + 1 >= keys.length || keys[at].run !== run || keys[at + 1].run !== run) continue;
    const a = keys[at], b = keys[at + 1], miss = shotKeyDissolveMiss(a.unit, b.unit, unit), off = Math.hypot(...miss);
    if (!nearest || off < nearest.off) nearest = { a, b, k: shotKeyDissolveK(a.unit, b.unit, unit), miss, off };
  }
  return nearest ?? { a: keys[index], b: null, k: 0, miss: unit.map((value, i) => value - keys[index].unit[i]) };
}

/**
 * The worst of `plan`'s sampled moments straying from what its keys dissolve to, as a warning: a number farther from
 * its stretch's dissolve than its step (a fiftieth of its range with none), when the budget left a turn undrawn.
 * `samples` are the plan's, `chosen` its keys by sample.
 */
function strayWarning(
  plan: ShotKeyDrawings, samples: readonly { readonly moment: PaintMoment; readonly unit: readonly number[] }[], chosen: readonly ShotKeyChoice[],
): PaintingProblem[] {
  let worst: { readonly ratio: number; readonly text: string } | null = null, index = 0;
  const strayed = new Set<ShotKeyDrawing>();
  for (const [i, { moment, unit }] of samples.entries()) {
    while (index + 1 < chosen.length && chosen[index + 1].sample <= i) index++;
    const { a, b, miss } = keyStretchAt(plan.keys, index, unit);
    for (const [p, { name, spec: { min, max, step } }] of plan.numbers.entries()) {
      const by = Math.abs(miss[p]) * (max - min), allowed = step ?? (max - min) / 50, ratio = by / allowed;
      if (ratio <= 1) continue;
      strayed.add(a);
      if (worst && ratio <= worst.ratio) continue;
      const from = b ? `the dissolve between its key drawings at ${paintSecondsText(a.moment.at)} and ${paintSecondsText(b.moment.at)}` : `its key drawing at ${paintSecondsText(a.moment.at)}`;
      const within = step === undefined ? 'a fiftieth of its range' : 'its step';
      worst = { ratio, text: `${name} strays ${Number(by.toPrecision(3))} from ${from} at ${paintSecondsText(moment.at)} (${within}, ${Number(allowed.toPrecision(3))}, allowed)` };
    }
  }
  if (!worst) return [];
  const others = strayed.size > 1 ? `, and ${strayed.size - 1} other stretch${strayed.size > 2 ? 'es' : ''} between keys stray too` : '';
  const budget = plural(plan.source.drawings, 'drawing', 'drawings');
  return [paintingProblem('warning', plan.plane, 'source.drawings', `${worst.text}${others}: at most ${budget}, it leaves a turn undrawn; allow more`)];
}

/**
 * `source`, the source of plane `plane`, planned over `moments` (shotSourceMoments): its values sampled and checked,
 * its key drawings chosen and evaluated, each drawing's selection checked and showing the occurrences the first does.
 * The plan, or null and its errors; with a plan, a warning for frames its keys can't dissolve to.
 */
export function planShotKeyDrawings(plane: string, source: PaintingInTime, moments: readonly PaintMoment[]): { readonly plan: ShotKeyDrawings | null; readonly problems: PaintingProblem[] } {
  const problems: PaintingProblem[] = [], error = (field: string, message: string) => problems.push(paintingProblem('error', plane, paintingField('source', field), message));
  const { schema, values, drawings: budget } = source, refused = () => ({ plan: null, problems });
  problems.push(...paintingSchemaProblems(schema));
  for (const name of Object.keys(values)) if (!Object.hasOwn(schema, name)) error(`values.${name}`, `names ${name}, which isn't a property of ${source.source}`);
  if (!(Number.isInteger(budget) && budget >= 1)) error('drawings', `${budget} isn't a whole number of drawings, 1 or more`);
  if (problems.length) return refused();
  const given = moments.map((moment) => valuesAt(source, moment));
  for (const [name, spec] of Object.entries(schema)) {
    const i = given.findIndex((at) => sampledValueProblem(name, spec, at[name]) !== null);
    if (i >= 0) error(`values.${name}`, `${sampledValueProblem(name, spec, given[i][name])} at ${paintSecondsText(moments[i].at)}`);
  }
  const at = source.at, offAt = at === undefined ? -1 : moments.findIndex((moment) => !Number.isFinite(presentationValueAt(at, moment)));
  if (at !== undefined && offAt >= 0) error('at', `${presentationValueAt(at, moments[offAt])} at ${paintSecondsText(moments[offAt].at)} isn't a finite scene second`);
  if (problems.length) return refused();
  const numbers = Object.entries(schema).flatMap(([name, spec]): ShotKeyNumber[] => (spec.type === 'number' ? [{ name, spec }] : []));
  const drawn = given.map((record) => Object.fromEntries(Object.entries(record).map(([name, value]) => {
    const spec = schema[name];
    return [name, spec.type === 'number' && typeof value === 'number' ? onStep(value, spec) : value];
  })));
  const samples = given.map((record, i): ShotKeySample & { readonly moment: PaintMoment } => ({
    moment: moments[i], drawing: paintingValuesKey(drawn[i]), run: runOf(schema, record), unit: unitOf(numbers, record),
  }));
  const chosen = chooseShotKeyDrawings(samples, budget), drawingsOf = (keys: readonly ShotKeyChoice[]) => new Set(keys.map(({ sample }) => samples[sample].drawing)).size;
  if (!chosen.fits) {
    const forced = chosen.keys.map(({ sample }) => keyText(source, { moment: moments[sample], values: drawn[sample] })).join(', ');
    error('drawings', `is ${budget}, and its first and last moments and either side of each cut draw ${drawingsOf(chosen.keys)}: ${forced}`);
    return refused();
  }
  const paintings = new Map<string, PaintingEvaluation>(), paintingOf = (sample: number) => {
    const { drawing } = samples[sample], kept = paintings.get(drawing) ?? source.paint(drawn[sample]);
    paintings.set(drawing, kept);
    return kept;
  };
  const keys = chosen.keys.map(({ sample, reason }): ShotKeyDrawing => ({
    moment: moments[sample], reason, values: drawn[sample], painting: paintingOf(sample), unit: unitOf(numbers, drawn[sample]), run: samples[sample].run,
  }));
  const ends = [...paintings.values()].map((evaluation): PaintedSourceEnd => ({ selection: keySelection(source, evaluation, undefined), field: 'source' }));
  const found = new Map(ends.flatMap(({ selection }) => paintedSourceProblems(plane, selection)).map((problem) => [`${problem.path} ${problem.message}`, problem]));
  if (found.size) return { plan: null, problems: [...found.values()] };
  const firstShows = shotPlaneOccurrences(plane, ends[0].selection).map(({ key }) => key).join(', ');
  for (const key of keys) {
    const shows = shotPlaneOccurrences(plane, keySelection(source, key.painting, undefined)).map(({ key: occurrence }) => occurrence).join(', ');
    if (shows !== firstShows) {
      error('', `at ${keyText(source, key)} shows ${shows}, and at ${keyText(source, keys[0])} ${firstShows}: a painting in time shows the same layers and groups at every key`);
      return refused();
    }
  }
  const plan: ShotKeyDrawings = { kind: 'key-drawings', plane, source, numbers, sampled: moments.length, keys, ends };
  return { plan, problems: strayWarning(plan, samples, chosen.keys) };
}

/** `evaluation`'s layers as `source` selects them, shown at `at`. */
const keySelection = (source: PaintingInTime, evaluation: PaintingEvaluation, at: number | undefined): LayerSelection =>
  layersOf(evaluation, source.layers, { ...(source.ground && { ground: source.ground }), ...(at !== undefined && { at }) });

/**
 * What a plane painting `plan` shows at `moment`, its source clock's: the stretch between keys its values lie nearest
 * (keyStretchAt) dissolved by how far they've come along it; a key alone before a cut, past the last, or where both
 * ends draw alike.
 */
export function shotKeyDrawingsAt(plan: ShotKeyDrawings, moment: PaintMoment): PaintedSource {
  const { keys, source } = plan, at = source.at === undefined ? undefined : presentationValueAt(source.at, moment);
  const index = Math.max(0, keys.findLastIndex((key) => key.moment.at <= moment.at));
  const { a, b, k } = keyStretchAt(keys, index, unitOf(plan.numbers, valuesAt(source, moment)));
  const shown = (key: ShotKeyDrawing) => keySelection(source, key.painting, at);
  if (!b || k === 0 || b.painting === a.painting) return shown(a);
  return k === 1 ? shown(b) : dissolve(shown(a), shown(b), k);
}

/**
 * `plan` as `studio paint check` prints it and a shot's cost report notes it: what it draws, then each key, its
 * moment, values and why it's one.
 */
export function shotKeyDrawingsText({ plane, source, sampled, keys, ends }: ShotKeyDrawings): string[] {
  return [
    `${plane}: ${source.source} in time, ${plural(ends.length, 'drawing', 'drawings')} (at most ${source.drawings}) solved at ${plural(keys.length, 'key', 'keys')} of the ${plural(sampled, 'moment', 'moments')} it reads`,
    ...keys.map((key) => `${plane}: key at ${keyText(source, key)}: ${KEY_REASONS[key.reason]}`),
  ];
}

/** Every plan of `planes` (a compiled shot's) as shotKeyDrawingsText prints it, plane by plane. */
export const shotPlanesKeyDrawingsText = (planes: readonly CompiledShotPlane[]): string[] =>
  planes.flatMap((plane) => (plane.kind === 'painted' && plane.keyDrawings ? shotKeyDrawingsText(plane.keyDrawings) : []));
