// painting-source.ts: a `*.painting.ts` module and what evaluating it gives. painting() runs its factory at checked
// property values, checks the document, and keeps the evaluation for those values, so a scene asking again each frame
// gets the same one; checkPaintingSource() is the same checks as a list, for a test or `studio paint check`.

import type { PaintingDocument } from './painting-document.ts';
import { checkPaintingDocument } from './painting-document-check.ts';
import { paintingFirstDifference } from './painting-document-difference.ts';
import { paintingErrors, paintingProblem, paintingProblemsError, type PaintingProblem } from './painting-problem.ts';
import {
  paintingPropertyValues, paintingSchemaProblems, paintingValueProblems, paintingValuesKey, type PaintingPropertyRecord, type PropertySchema,
  type PropertyValues,
} from './painting-properties.ts';
import type { PaintingSheets } from './painting-sheets.ts';
import type { PaintingStyleCatalogue } from './painting-styles.ts';

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
  readonly sheets: PaintingSheets;
  readonly warnings: readonly PaintingProblem[];
};

/** A source's name in problems: its factory's, or `painting source` for an anonymous one. */
export const paintingSourceName = <S extends PropertySchema>(source: PaintingSourceModule<S>) =>
  (source.default.name && source.default.name !== 'default' ? source.default.name : 'painting source');

/** Each source's schema problems, found once. */
const schemaProblemsOf = new WeakMap<object, readonly PaintingProblem[]>();
/** Each source's evaluations, by its full values' key. */
const evaluationsOf = new WeakMap<object, Map<string, PaintingEvaluation>>();

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

/**
 * `source` evaluated at `values` (defaults for the rest), checked, and kept for those values. Throws one Error listing
 * every problem when it has errors; a throw inside the factory keeps its own stack.
 */
export function painting<S extends PropertySchema>(source: PaintingSourceModule<S>, values: Partial<PropertyValues<S>> = {}): PaintingEvaluation {
  const given: Readonly<Partial<PaintingPropertyRecord>> = values;
  const name = paintingSourceName(source);
  const checked = sourceValues(source, given);
  if (!checked.values) throw paintingProblemsError(name, checked.problems);
  const key = paintingValuesKey(checked.values);
  const evaluations = evaluationsOf.get(source) ?? new Map<string, PaintingEvaluation>();
  evaluationsOf.set(source, evaluations);
  const kept = evaluations.get(key);
  if (kept) return kept;
  const paintingDocument = runFactory(source, checked.values);
  const { problems, sheets } = checkPaintingDocument(paintingDocument);
  if (!sheets || paintingErrors(problems).length > 0) throw paintingProblemsError(name, problems);
  const evaluation: PaintingEvaluation = { source: name, values: checked.values, document: paintingDocument, sheets, warnings: problems };
  evaluations.set(key, evaluation);
  return evaluation;
}

/**
 * Every problem `source` has at `values` that's found without solving: its schema, the values, the factory's purity
 * (called twice, its documents compared) and the document; with `styles`, its brushes and paper assets too. A stage
 * runs only if those before it found no error. A throw inside the factory isn't caught.
 */
export function checkPaintingSource<S extends PropertySchema>(
  source: PaintingSourceModule<S>, values: Partial<PropertyValues<S>> = {}, styles?: PaintingStyleCatalogue,
): readonly PaintingProblem[] {
  const given: Readonly<Partial<PaintingPropertyRecord>> = values;
  const checked = sourceValues(source, given);
  if (!checked.values) return checked.problems;
  const paintingDocument = runFactory(source, checked.values);
  const differ = paintingFirstDifference(paintingDocument, runFactory(source, checked.values));
  if (differ !== null) return [paintingProblem('error', 'document', differ, `${paintingSourceName(source)} isn't pure: two calls differ at ${differ || 'the document itself'}`)];
  return checkPaintingDocument(paintingDocument, styles).problems;
}
