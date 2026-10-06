// painting-properties.ts: a painting source's property schema and the values a scene gives it. A property is the only
// input a factory reads, so each distinct value is an evaluation and a solve: a number states its range and may state
// the grid it's quantised to, and a value off it is refused rather than rounded, so a scene can't ask for a solve it
// never meant.

import { paintingProblem, type PaintingProblem } from './painting-problem.ts';

/**
 * One property. A number states its range; `unit` is for people. `step`, when given, is the only grid accepted, from
 * `min` (within 1e-9 × step), so a scene can't ask for a value it never quantised: each distinct value is an
 * evaluation and a solve. An enum's `default` is one of its `values`.
 */
export type PropertySpec =
  | { readonly type: 'number'; readonly unit?: string; readonly min: number; readonly max: number; readonly step?: number; readonly default: number }
  | { readonly type: 'boolean'; readonly default: boolean }
  | { readonly type: 'enum'; readonly values: readonly string[]; readonly default: string };

export type PropertySchema = Readonly<Record<string, PropertySpec>>;

/** The value a property takes: a boolean's true or false, an enum's values, a number. Any of them, for any property. */
export type PropertyValue<P extends PropertySpec> = P extends { readonly type: 'boolean' } ? boolean
  : P extends { readonly type: 'enum'; readonly values: readonly (infer V extends string)[] } ? V
  : number;

/** The validated values a factory receives: every property, defaults filled in. */
export type PropertyValues<S extends PropertySchema> = { readonly [K in keyof S]: PropertyValue<S[K]> };

export type PaintingPropertyValue = PropertyValue<PropertySpec>;

/** Values as the engine handles them, whatever the schema: by property name. */
export type PaintingPropertyRecord = Readonly<Record<string, PaintingPropertyValue>>;

/** How far off its grid a value may sit, in steps: a scene's arithmetic (180 + 0.1 × 200) rounds. */
const STEP_TOLERANCE = 1e-9;

const owner = (name: string) => `property ${name}`;

/** Whether `value` sits on `step`'s grid from `min`. */
const onStep = (value: number, min: number, step: number) => {
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) <= STEP_TOLERANCE * Math.max(1, Math.abs(steps));
};

const shown = (value: PaintingPropertyValue) => (typeof value === 'string' ? `'${value}'` : String(value));

/** Problems in the schema itself: a range upside down, a step not above 0, a default it refuses. */
export function paintingSchemaProblems(schema: PropertySchema): PaintingProblem[] {
  return Object.entries(schema).flatMap(([name, spec]): PaintingProblem[] => {
    const at = (field: string, message: string) => [paintingProblem('error', owner(name), field, message)];
    // A JS source can name any type; the union below covers only the three there are.
    const type: string = spec.type;
    if (type !== 'number' && type !== 'boolean' && type !== 'enum') return at('type', `${name}'s type '${type}' isn't number, boolean or enum`);
    const fallback: PaintingPropertyValue = spec.default;
    if (spec.type === 'boolean') return typeof fallback === 'boolean' ? [] : at('default', `${name}'s default ${shown(fallback)} isn't true or false`);
    if (spec.type === 'enum') {
      if (spec.values.length === 0) return at('values', `${name} has no values`);
      return spec.values.includes(spec.default) ? [] : at('default', `${name}'s default ${shown(spec.default)} isn't one of ${spec.values.join(', ')}`);
    }
    const { min, max, step } = spec;
    if (!(Number.isFinite(min) && Number.isFinite(max) && min <= max)) return at('min', `${name}'s range ${min}..${max} isn't a finite range, low to high`);
    if (step !== undefined && !(step > 0 && Number.isFinite(step))) return at('step', `${name}'s step ${step} isn't above 0`);
    return numberProblem(name, spec, spec.default, `${name}'s default`).flatMap((message) => at('default', message));
  });
}

/** What's wrong with `value` for a number property, `what` naming it in the message. */
function numberProblem(name: string, spec: Extract<PropertySpec, { type: 'number' }>, value: number, what: string): string[] {
  if (!(value >= spec.min && value <= spec.max)) return [`${what} ${value} is outside ${spec.min}..${spec.max}`];
  if (spec.step !== undefined && !onStep(value, spec.min, spec.step)) return [`${what} ${value} is off its step ${spec.step}`];
  return [];
}

/** Problems in `values` given for `schema` of the source named `source`: unknown names, values out of range or type. */
export function paintingValueProblems(schema: PropertySchema, values: Readonly<Partial<PaintingPropertyRecord>>, source: string): PaintingProblem[] {
  return Object.entries(values).flatMap(([name, value]): PaintingProblem[] => {
    if (value === undefined) return [];
    const spec = Object.hasOwn(schema, name) ? schema[name] : undefined;
    const problem = (message: string) => [paintingProblem('error', owner(name), 'value', message)];
    if (!spec) return problem(`${name} isn't a property of ${source}`);
    if (spec.type === 'number') {
      return typeof value === 'number' ? numberProblem(name, spec, value, `${name} =`).flatMap(problem) : problem(`${name} = ${shown(value)} isn't a number`);
    }
    if (spec.type === 'boolean') return typeof value === 'boolean' ? [] : problem(`${name} = ${shown(value)} isn't true or false`);
    return typeof value === 'string' && spec.values.includes(value) ? [] : problem(`${name} = ${shown(value)} isn't one of ${spec.values.join(', ')}`);
  });
}

/** Every property's value: as given, else its default. Expects values that passed paintingValueProblems. */
export function paintingPropertyValues(schema: PropertySchema, values: Readonly<Partial<PaintingPropertyRecord>>): PaintingPropertyRecord {
  return Object.fromEntries(Object.entries(schema).map(([name, spec]) => [name, values[name] ?? spec.default]));
}

/** A canonical key for full values, names sorted: equal values, equal keys, whatever order a scene wrote them in. */
export function paintingValuesKey(values: PaintingPropertyRecord): string {
  return JSON.stringify(Object.keys(values).toSorted().map((name) => [name, values[name]]));
}

/**
 * A command line's `--<flag>` of comma-separated `name=value` pairs, in order: each name and its value as text, both
 * trimmed. Throws for a pair with no `=` or no name.
 */
export function paintingValueTextPairs(flag: string, text: string): [name: string, value: string][] {
  return text.split(',').filter((pair) => pair.trim()).map((pair) => {
    const at = pair.indexOf('='), name = pair.slice(0, at).trim();
    if (at < 0 || !name) throw new Error(`--${flag} takes name=value pairs, not "${pair}"`);
    return [name, pair.slice(at + 1).trim()];
  });
}

/**
 * Values written as text (a command line's `name=value`) read by `schema`: a number property's as a number, a
 * boolean's as true or false where they read so. Anything else stays text, for paintingValueProblems to refuse by name.
 */
export function paintingValuesFromText(schema: PropertySchema, texts: Readonly<Record<string, string>>): PaintingPropertyRecord {
  return Object.fromEntries(Object.entries(texts).map(([name, text]): [string, PaintingPropertyValue] => {
    const type = Object.hasOwn(schema, name) ? schema[name].type : undefined;
    if (type === 'number' && text.trim() !== '' && Number.isFinite(Number(text))) return [name, Number(text)];
    if (type === 'boolean' && (text === 'true' || text === 'false')) return [name, text === 'true'];
    return [name, text];
  }));
}
