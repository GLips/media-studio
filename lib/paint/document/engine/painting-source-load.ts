// painting-source-load.ts: a painting source loaded by path in Node and checked as `studio paint check` reports it:
// its values from the command's `name=value` text, read by its schema; every problem found without solving, its
// brushes and paper assets against the styles in work/styles/; and, when it has no error, its evaluation to summarise
// or, for `studio paint diff`, to compare with another. A wrapped document's diff reads its brushes, as a still does.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { STUDIO_STYLES_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { readWorkspacePigmentStyle, type WorkspacePigmentStyle } from '#lib/paint/style/engine/workspace-pigment-style.ts';
import { paintingBrushRefs } from '../models/painting-brush-refs.ts';
import type { PaintingBrushOf } from '../models/painting-deposit-compile.ts';
import { paintingEvaluationDiff, type PaintingEvaluationDiff } from '../models/painting-evaluation-diff.ts';
import { paintingValuesFromText, type PropertySchema } from '../models/painting-properties.ts';
import { evaluatePaintingSource, type PaintingEvaluation, type PaintingSourceEvaluation, type PaintingSourceModule } from '../models/painting-source.ts';
import { paintingStyleCatalogue } from '../models/painting-styles.ts';

/** A `*.painting.ts` module as Node imports it: a default export that's a function, and an object for properties. */
function isPaintingSourceModule(loaded: unknown): loaded is PaintingSourceModule<PropertySchema> {
  if (typeof loaded !== 'object' || loaded === null || !('default' in loaded) || typeof loaded.default !== 'function') return false;
  return !('properties' in loaded) || loaded.properties === undefined || (typeof loaded.properties === 'object' && loaded.properties !== null);
}

/** The source module at `file`. Throws unless its default export is a factory. */
export async function loadPaintingSource(file: string): Promise<PaintingSourceModule<PropertySchema>> {
  // A source timed by its project's timeline imports it, and so the track's audio: the hooks load that as a URL.
  await import('#lib/output/render/engine/tsx-test-hooks.ts');
  const loaded: unknown = await import(pathToFileURL(resolve(file)).href);
  if (!isPaintingSourceModule(loaded)) throw new Error(`${file} isn't a painting source: its default export is its factory, and \`properties\` its schema`);
  return loaded;
}

/** The source at `file` checked at the values `texts` give by name, against this machine's styles. */
export async function checkPaintingSourceFile(file: string, texts: Readonly<Record<string, string>>): Promise<PaintingSourceEvaluation> {
  const source = await loadPaintingSource(file);
  const values = paintingValuesFromText(source.properties ?? {}, texts);
  const { default: styles } = await import('#lib/paint/style/engine/node-stamp-paint-styles.ts');
  return evaluatePaintingSource(source, values, paintingStyleCatalogue(styles));
}

/** One side of a comparison: a source file at the values `texts` give by name. */
export type PaintingSourceFileSide = { readonly file: string; readonly texts: Readonly<Record<string, string>> };

/** Both sides checked, and what changed from one to the other when neither has an error. */
export type PaintingSourceFileDiff = {
  readonly before: PaintingSourceEvaluation;
  readonly after: PaintingSourceEvaluation;
  readonly diff: PaintingEvaluationDiff | null;
};

/**
 * The workspace's pigment styles `evaluations` name, by name: their brushes', paper photographs' and grains'. `use`
 * names what needs them in errors. Throws for a style missing, or painting in flat colour.
 */
export async function readPaintingSourceStyles(evaluations: readonly PaintingEvaluation[], use: string): Promise<ReadonlyMap<string, WorkspacePigmentStyle>> {
  const names = new Set(evaluations.flatMap(({ tree }) => [
    ...paintingBrushRefs(tree).map(({ style }) => style),
    ...tree.sheets.flatMap(({ paper: { image, grain } }) => [image, grain?.image].flatMap((asset) => (asset ? [asset.style] : []))),
  ]));
  return new Map(await Promise.all([...names].map(async (name) => [name, await readWorkspacePigmentStyle(STUDIO_STYLES_DIR, name, use)] as const)));
}

/** `styles`' brushes as a compile resolves them. */
export const paintingStylesBrushOf = (styles: ReadonlyMap<string, WorkspacePigmentStyle>): PaintingBrushOf => ({ style, brush }) => styles.get(style)!.brushOf(brush);

/** `before` and `after` evaluated and compared: two values of one source, or one source before and after an edit. */
export async function diffPaintingSourceFiles(before: PaintingSourceFileSide, after: PaintingSourceFileSide): Promise<PaintingSourceFileDiff> {
  const a = await checkPaintingSourceFile(before.file, before.texts), b = await checkPaintingSourceFile(after.file, after.texts);
  if (!a.evaluation || !b.evaluation) return { before: a, after: b, diff: null };
  const evaluations = [a.evaluation, b.evaluation];
  const brushOf = evaluations.some(({ document }) => document.wrap !== undefined) ? paintingStylesBrushOf(await readPaintingSourceStyles(evaluations, 'paint diff')) : null;
  return { before: a, after: b, diff: paintingEvaluationDiff(a.evaluation, b.evaluation, brushOf) };
}
