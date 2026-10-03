// painting-source-load.ts: a painting source loaded by path in Node and checked as `studio paint check` reports it:
// its values from `--prop name=value`, read by its schema; every problem found without solving, its brushes and
// paper assets against the styles in work/styles/; and, when it has no error, its evaluation to summarise or, for
// `studio paint diff`, to compare with another.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { paintingEvaluationDiff, type PaintingEvaluationDiff } from '../models/painting-evaluation-diff.ts';
import { paintingErrors, type PaintingProblem } from '../models/painting-problem.ts';
import type { PaintingPropertyRecord, PaintingPropertyValue, PropertySchema } from '../models/painting-properties.ts';
import { checkPaintingSource, painting, type PaintingEvaluation, type PaintingSourceModule } from '../models/painting-source.ts';
import { paintingStyleCatalogue } from '../models/painting-styles.ts';

/** A `*.painting.ts` module as Node imports it: a default export that's a function, and an object for properties. */
function isPaintingSourceModule(loaded: unknown): loaded is PaintingSourceModule<PropertySchema> {
  if (typeof loaded !== 'object' || loaded === null || !('default' in loaded) || typeof loaded.default !== 'function') return false;
  return !('properties' in loaded) || loaded.properties === undefined || (typeof loaded.properties === 'object' && loaded.properties !== null);
}

/** The source module at `file`. Throws unless its default export is a factory. */
export async function loadPaintingSource(file: string): Promise<PaintingSourceModule<PropertySchema>> {
  const loaded: unknown = await import(pathToFileURL(resolve(file)).href);
  if (!isPaintingSourceModule(loaded)) throw new Error(`${file} isn't a painting source: its default export is its factory, and \`properties\` its schema`);
  return loaded;
}

/**
 * `name=value` pairs read by `schema`: a number property's value as a number, a boolean's as true or false where
 * they read so. Anything else stays a string, for the check to refuse by name.
 */
export function paintingPropsFromPairs(schema: PropertySchema, pairs: readonly string[]): PaintingPropertyRecord {
  return Object.fromEntries(pairs.map((pair): [string, PaintingPropertyValue] => {
    const split = pair.indexOf('=');
    if (split <= 0) throw new Error(`--prop ${pair} isn't name=value`);
    const name = pair.slice(0, split), text = pair.slice(split + 1), type = Object.hasOwn(schema, name) ? schema[name].type : undefined;
    if (type === 'number' && text.trim() !== '' && Number.isFinite(Number(text))) return [name, Number(text)];
    if (type === 'boolean' && (text === 'true' || text === 'false')) return [name, text === 'true'];
    return [name, text];
  }));
}

/** What checking a source file found: its problems, and its evaluation when it has no error. */
export type PaintingSourceFileCheck = { readonly problems: readonly PaintingProblem[]; readonly evaluation: PaintingEvaluation | null };

/** The source at `file` checked at the values `pairs` give, against this machine's styles. */
export async function checkPaintingSourceFile(file: string, pairs: readonly string[]): Promise<PaintingSourceFileCheck> {
  const source = await loadPaintingSource(file);
  const values = paintingPropsFromPairs(source.properties ?? {}, pairs);
  const { default: styles } = await import('#lib/paint/style/engine/node-stamp-paint-styles.ts');
  const problems = checkPaintingSource(source, values, paintingStyleCatalogue(styles));
  return { problems, evaluation: paintingErrors(problems).length > 0 ? null : painting(source, values) };
}

/** One side of a comparison: a source file at the values its `name=value` pairs give. */
export type PaintingSourceFileSide = { readonly file: string; readonly pairs: readonly string[] };

/** Both sides checked, and what changed from one to the other when neither has an error. */
export type PaintingSourceFileDiff = {
  readonly before: PaintingSourceFileCheck;
  readonly after: PaintingSourceFileCheck;
  readonly diff: PaintingEvaluationDiff | null;
};

/** `before` and `after` evaluated and compared: two values of one source, or one source before and after an edit. */
export async function diffPaintingSourceFiles(before: PaintingSourceFileSide, after: PaintingSourceFileSide): Promise<PaintingSourceFileDiff> {
  const a = await checkPaintingSourceFile(before.file, before.pairs), b = await checkPaintingSourceFile(after.file, after.pairs);
  return { before: a, after: b, diff: a.evaluation && b.evaluation ? paintingEvaluationDiff(a.evaluation, b.evaluation) : null };
}
