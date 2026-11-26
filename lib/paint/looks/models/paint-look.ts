import type { LookDescription } from './look-catalog.ts';
import { checkLookGraph, type LookStep } from './look-step.ts';

type Plan<S extends LookStep> = LookDescription & { readonly name: string; readonly steps: readonly S[]; readonly show: readonly string[] };
type Field = readonly [step: string, field: string];
type Bindings = Readonly<Record<string, readonly [Field, ...Field[]]>>;
type DrawField<S extends LookStep> = S extends { kind: 'draw'; params: infer P } ? readonly [S['name'], keyof P & string] : never;
type ValueAt<S extends LookStep, F extends Field> = Extract<S, { name: F[0] }> extends { params: infer P } ? P[F[1] & keyof P] : never;
type KnobValues<S extends LookStep, K extends Bindings> = { [N in keyof K]?: ValueAt<S, K[N][number]> };
type Replacements<S extends LookStep> = { [N in S['name']]?: (inherited: Extract<S, { name: N }>) => LookStep & { name: N } };
type Replaced<S extends LookStep, R> = Exclude<S, { name: keyof R }> | ReturnType<Extract<R[keyof R], (...args: never[]) => LookStep>>;

/** A catalog entry with a checked plan. with() writes each published control to its bound fields. */
export type PaintLook<S extends LookStep, K extends Bindings> = Plan<S> & {
  readonly knobs: K;
  with(values: KnobValues<S, K>): PaintLook<S, K>;
};

function resolveLook<S extends LookStep, K extends Bindings>(plan: Plan<S>, knobs: K): PaintLook<S, K> {
  checkLookGraph(plan.steps, plan.show);
  const named = new Map(plan.steps.map(step => [step.name, step]));
  for (const [knob, targets] of Object.entries(knobs)) {
    for (const [name, field] of targets) {
      const target = named.get(name);
      if (target?.kind !== 'draw' || (field !== 'redraw' && !Object.hasOwn(target.params, field))) {
        throw new Error(`look knob '${knob}' targets missing draw field '${name}.${field}'`);
      }
    }
  }
  const look: PaintLook<S, K> = { ...plan, knobs, with(values) {
    const fields = new Map<string, object>();
    for (const name of Object.keys(values)) {
      if (!Object.hasOwn(knobs, name)) throw new Error(`unknown look knob '${name}'`);
      // SAFETY: each own key names the corresponding typed value in KnobValues.
      const value = values[name as keyof K];
      for (const [target, field] of knobs[name]) {
        const edit = fields.get(target) ?? {};
        if (Object.hasOwn(edit, field)) throw new Error(`conflicting writes to ${target}.${field}`);
        fields.set(target, { ...edit, [field]: value });
      }
    }
    const replace = Object.fromEntries([...fields].map(([name, edit]) => [name, (step: S) => {
      if (step.kind !== 'draw') throw new Error(`expected a draw at '${name}'`);
      return step.with(edit);
    }]));
    // SAFETY: with() preserves the operation and its declared settings for each bound draw.
    return resolveLook({ ...plan, steps: replacedSteps(plan.steps, replace) as S[] }, knobs);
  } };
  return look;
}

/** Publish a recipe and its knobs. Bind a knob to one or more [draw name, parameter] pairs. */
export function defineLook<const S extends LookStep, const K extends Readonly<Record<string, readonly [DrawField<S>, ...DrawField<S>[]]>>>(
  plan: Plan<S>, knobs: K,
): PaintLook<S, K> {
  return resolveLook(plan, knobs);
}

function replacedSteps<S extends LookStep>(steps: readonly S[], edits: Readonly<Record<string, (step: S) => LookStep>>): LookStep[] {
  for (const name of Object.keys(edits)) if (!steps.some(step => step.name === name)) throw new Error(`unknown look step '${name}'`);
  return steps.map(step => {
    if (!Object.hasOwn(edits, step.name)) return step;
    const next = edits[step.name](step);
    if (next.name !== step.name) throw new Error(`replacement of ${step.name} must keep its name`);
    return next;
  });
}

/** Replace named steps against the last resolved plan, then check every connection and inherited knob binding. */
export function deriveLook<S extends LookStep, K extends Bindings, R extends object = {}>(
  base: PaintLook<S, K>, patch: { readonly name?: string; readonly replace?: R & NoInfer<Replacements<S>> },
): PaintLook<Replaced<S, R>, K> {
  // SAFETY: replacedSteps dispatches by name. Replaced maps that name to its callback's result.
  const steps = replacedSteps(base.steps, (patch.replace ?? {}) as Record<string, (step: S) => LookStep>) as Replaced<S, R>[];
  return resolveLook({ ...base, name: patch.name ?? base.name, steps }, base.knobs);
}

/** Print resolved parameters, coordinate space, ordered sheet membership and visible outputs. */
export function printLook(look: Plan<LookStep> & { readonly knobs: Bindings }): string {
  return [look.name, ...look.steps.map((step) => {
    if (step.kind === 'draw') {
      const changed = step.changed.length ? ` changed: ${step.changed.join(', ')}` : '';
      return `${step.name}  draw  ${step.description} (local) ${JSON.stringify({ ...step.params, redraw: step.params.redraw ? 'scheduled' : 'inherited' })}${changed}`;
    }
    if (step.kind === 'place') return `${step.name}  place  ${'sheet' in step ? `sheet [${step.sheet.join(', ')}]` : step.image} (stage)`;
    return `${step.name}  process  ${step.definition.name} ${JSON.stringify(step.inputs)} (${step.space})`;
  }), `show  ${look.show.join(', ')}`, ...Object.entries(look.knobs).map(([name, targets]) =>
    `${name}  knob  ${targets.map(([step, field]) => `${step}.${field}`).join(', ')}`)].join('\n');
}
