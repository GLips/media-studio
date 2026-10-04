// painting-source.ts: a `*.painting.ts` module and what evaluating it gives. painting() runs its factory at checked
// property values, checks the document, and keeps the evaluation for those values, so a scene asking again each frame
// gets the same one; checkPaintingSource() is the same checks as a list, for a test or `studio paint check`. A render
// may override a painting's values over every scene's (`studio look --set`), installed before any scene loads.

import type { PaintingDocument } from './painting-document.ts';
import { checkPaintingDocument } from './painting-document-check.ts';
import { paintingFirstDifference } from './painting-document-difference.ts';
import { paintingErrors, paintingProblem, paintingProblemsError, type PaintingProblem } from './painting-problem.ts';
import {
  paintingPropertyValues, paintingSchemaProblems, paintingValueProblems, paintingValuesKey, type PaintingPropertyRecord, type PropertySchema,
  type PropertyValues,
} from './painting-properties.ts';
import type { PaintingStyleCatalogue } from './painting-styles.ts';
import type { PaintingTree } from './painting-tree.ts';

/** What a painting source's file name ends in: `meadow.painting.ts`. */
export const PAINTING_SOURCE_SUFFIX = '.painting.ts';

/**
 * Pure: reads only `values` and imports. No clock, engine state or unseeded randomness; module-level constants and
 * pure memos are fine.
 */
export type PaintingFactory<S extends PropertySchema> = (values: PropertyValues<S>) => PaintingDocument;

/**
 * A `*.painting.ts` module: its factory as default, and `properties` (`as const satisfies PropertySchema`) when it
 * takes any. Other exports are the author's own.
 */
export type PaintingSourceModule<S extends PropertySchema = {}> = { readonly properties?: S; readonly default: PaintingFactory<S> };

/**
 * A source at one set of values: its document, checked, with its tree resolved and its warnings. Made by painting(),
 * once per source and values.
 */
export type PaintingEvaluation = {
  /** The source's name in problems: its factory's. */
  readonly source: string;
  readonly values: PaintingPropertyRecord;
  readonly document: PaintingDocument;
  readonly tree: PaintingTree;
  readonly warnings: readonly PaintingProblem[];
};

/** A source's name in problems and overrides: its factory's, or `painting source` for an anonymous one. */
export const paintingSourceName = <S extends PropertySchema>(source: PaintingSourceModule<S>) =>
  (source.default.name && source.default.name !== 'default' ? source.default.name : 'painting source');

/**
 * Property values a render paints sources at over a scene's own, by source name (paintingSourceName): JSON, as it
 * crosses into the render's page.
 */
export type PaintingValueOverrides = Readonly<Record<string, PaintingPropertyRecord>>;
let paintingValueOverrides: PaintingValueOverrides = {};

/** Sets the values painting() lays over a scene's from here on; a render's bundle sets them before any scene loads. */
export function setPaintingValueOverrides(overrides: PaintingValueOverrides): void {
  paintingValueOverrides = overrides;
}

/** Each source's schema problems, found once. */
const schemaProblemsOf = new WeakMap<object, readonly PaintingProblem[]>();
/** Each source's evaluations, by its full values' key. */
const evaluationsOf = new WeakMap<object, Map<string, PaintingEvaluation>>();
/** How many evaluations painting() has made, and answered from its memo, since the module loaded. */
const evaluationCounts = { made: 0, memoHits: 0 };

/**
 * painting()'s running counts: evaluations made, and answered from the memo. A cost report counts the change around a
 * synchronous read of sources, which nothing else evaluates during.
 */
export const paintingEvaluationCounts = (): { readonly made: number; readonly memoHits: number } => ({ ...evaluationCounts });

/** The schema's and the values' problems, and the full values when there are none. */
function sourceValues<S extends PropertySchema>(source: PaintingSourceModule<S>, given: Readonly<Partial<PaintingPropertyRecord>>) {
  const schema: PropertySchema = source.properties ?? {};
  const schemaProblems = schemaProblemsOf.get(source) ?? paintingSchemaProblems(schema);
  schemaProblemsOf.set(source, schemaProblems);
  if (schemaProblems.length > 0) return { problems: schemaProblems, values: null };
  const problems = paintingValueProblems(schema, given, paintingSourceName(source));
  return { problems, values: problems.length > 0 ? null : paintingPropertyValues(schema, given) };
}

/** The factory at `values`, which passed its schema: the one place a record of values becomes the factory's own type. */
function runFactory<S extends PropertySchema>(source: PaintingSourceModule<S>, values: PaintingPropertyRecord): PaintingDocument {
  // SAFETY: `values` holds every property of S, each checked against its spec (paintingValueProblems), defaults filled.
  return source.default(values as PropertyValues<S>);
}

/** What evaluating a source at values found: every problem, and the evaluation when none is an error. */
export type PaintingSourceEvaluation = { readonly problems: readonly PaintingProblem[]; readonly evaluation: PaintingEvaluation | null };

/**
 * `source` at checked `values`: its factory run (twice, its documents compared, when `purity` asks) and its document
 * checked, with `styles` when given. A throw inside the factory isn't caught.
 */
function evaluateAt<S extends PropertySchema>(
  source: PaintingSourceModule<S>, values: PaintingPropertyRecord, purity: boolean, styles?: PaintingStyleCatalogue,
): PaintingSourceEvaluation {
  const name = paintingSourceName(source), paintingDocument = runFactory(source, values);
  const differ = purity ? paintingFirstDifference(paintingDocument, runFactory(source, values)) : null;
  if (differ !== null) return { problems: [paintingProblem('error', 'document', differ, `${name} isn't pure: two calls differ at ${differ || 'the document itself'}`)], evaluation: null };
  const { problems, tree } = checkPaintingDocument(paintingDocument, styles);
  if (!tree || paintingErrors(problems).length > 0) return { problems, evaluation: null };
  return { problems, evaluation: { source: name, values, document: paintingDocument, tree, warnings: problems } };
}

/**
 * `source` evaluated at `values` (defaults for the rest), any override set for it laid over them, checked, and kept
 * for those values. Throws one Error listing every problem when it has errors; a throw inside the factory keeps its own
 * stack.
 */
export function painting<S extends PropertySchema>(source: PaintingSourceModule<S>, values: Partial<PropertyValues<S>> = {}): PaintingEvaluation {
  const name = paintingSourceName(source), overrides = Object.hasOwn(paintingValueOverrides, name) ? paintingValueOverrides[name] : {};
  const given: Readonly<Partial<PaintingPropertyRecord>> = { ...values, ...overrides };
  const checked = sourceValues(source, given);
  if (!checked.values) throw paintingProblemsError(name, checked.problems);
  const key = paintingValuesKey(checked.values);
  const evaluations = evaluationsOf.get(source) ?? new Map<string, PaintingEvaluation>();
  evaluationsOf.set(source, evaluations);
  const kept = evaluations.get(key);
  if (kept) {
    evaluationCounts.memoHits++;
    return kept;
  }
  evaluationCounts.made++;
  const { problems, evaluation } = evaluateAt(source, checked.values, false);
  if (!evaluation) throw paintingProblemsError(name, problems);
  evaluations.set(key, evaluation);
  return evaluation;
}

/**
 * Every problem `source` has at `values` that's found without solving, and its evaluation when none is an error: its
 * schema, the values, the factory's purity (called twice, its documents compared) and the document; with `styles`,
 * its brushes and paper assets too. A stage runs only if those before it found no error. Not kept, unlike painting().
 */
export function evaluatePaintingSource<S extends PropertySchema>(
  source: PaintingSourceModule<S>, values: Partial<PropertyValues<S>> = {}, styles?: PaintingStyleCatalogue,
): PaintingSourceEvaluation {
  const given: Readonly<Partial<PaintingPropertyRecord>> = values;
  const checked = sourceValues(source, given);
  return checked.values ? evaluateAt(source, checked.values, true, styles) : { problems: checked.problems, evaluation: null };
}

/** evaluatePaintingSource's problems, for a test. A throw inside the factory isn't caught. */
export function checkPaintingSource<S extends PropertySchema>(
  source: PaintingSourceModule<S>, values: Partial<PropertyValues<S>> = {}, styles?: PaintingStyleCatalogue,
): readonly PaintingProblem[] {
  return evaluatePaintingSource(source, values, styles).problems;
}
