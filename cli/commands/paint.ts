// studio paint: painting sources (`*.painting.ts`, docs/painting-authoring.md), checked without the GPU.
import { defineCommand } from 'citty';

/** Every `--<flag>` given, `--prop a=1 --prop b=2` and `--prop=a=1` alike: citty keeps only a flag's last value. */
function flagPairs(rawArgs: readonly string[], flag: 'prop' | 'to'): string[] {
  return rawArgs.flatMap((arg, i) => {
    if (arg.startsWith(`--${flag}=`)) return [arg.slice(`--${flag}=`.length)];
    const next = rawArgs[i + 1];
    return arg === `--${flag}` && next !== undefined ? [next] : [];
  });
}

/**
 * Runs a paint verb, a throw printed whole and failing the run: a throw from a source's import or factory is the
 * author's bug, and its stack says where. The studio would print only its message.
 */
async function withPaintSourceStack(verb: () => Promise<void>): Promise<void> {
  try {
    await verb();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}

const checkPaintCommand = defineCommand({
  meta: {
    name: 'check',
    description: "Evaluate a painting source at its default property values (or those --prop gives) and print every problem found without solving: the schema and values, the factory's purity (called twice, its documents compared), the document's shape and keys, its papers, brushes and assets against work/styles/, its geometry, charges and media, washes, clocks and `on`s that can never hold. Each problem prints as `<path>: <message> [x0,y0 → x1,y1]`, the box in document px; warnings say so. Then, if it has no error, the document's size and medium and each layer's medium, sheet, washes and applications. Fails on any error.",
  },
  args: {
    source: { type: 'positional', required: true, description: 'The *.painting.ts module' },
    prop: { type: 'string', valueHint: 'name=value', description: 'A property value, held to its schema like any other (an off-step value is an error); repeat it for several' },
  },
  run: ({ args, rawArgs }) => withPaintSourceStack(async () => {
    const { checkPaintingSourceFile } = await import('#lib/paint/document/engine/painting-source-load.ts');
    const { paintingProblemText, paintingErrors } = await import('#lib/paint/document/models/painting-problem.ts');
    const { paintingEvaluationSummary } = await import('#lib/paint/document/models/painting-summary.ts');
    const { problems, evaluation } = await checkPaintingSourceFile(args.source, flagPairs(rawArgs, 'prop'));
    for (const problem of problems) console.log(paintingProblemText(problem));
    if (evaluation) for (const line of paintingEvaluationSummary(evaluation)) console.log(line);
    const errors = paintingErrors(problems).length;
    console.error(`paint check: ${errors} ${errors === 1 ? 'error' : 'errors'}, ${problems.length - errors} ${problems.length - errors === 1 ? 'warning' : 'warnings'}`);
    if (errors > 0) process.exitCode = 1;
  }),
});

const diffPaintCommand = defineCommand({
  meta: {
    name: 'diff',
    description: "What a solve would redo between two evaluations: a source at --prop and at --prop with --to on top, or a source and an edited copy (--prop on both, --to on the second). Prints the document's fields that differ (paper colour among them, which re-solves nothing), then each wash in its sheet's order: `same`, `content` at the first path that differs in it, or `upstream` after the first change earlier on its sheet. Keys never count. A side with an error prints its problems instead; then it fails.",
  },
  args: {
    source: { type: 'positional', required: true, description: 'The *.painting.ts module' },
    edited: { type: 'positional', required: false, description: 'An edited copy to compare it with; the source again when left out' },
    prop: { type: 'string', valueHint: 'name=value', description: 'A property value both sides take; repeat it for several' },
    to: { type: 'string', valueHint: 'name=value', description: 'A property value the second side takes over --prop; repeat it for several' },
  },
  run: ({ args, rawArgs }) => withPaintSourceStack(async () => {
    const { diffPaintingSourceFiles } = await import('#lib/paint/document/engine/painting-source-load.ts');
    const { paintingProblemText, paintingErrors } = await import('#lib/paint/document/models/painting-problem.ts');
    const { paintingEvaluationDiffLines } = await import('#lib/paint/document/models/painting-evaluation-diff.ts');
    const props = flagPairs(rawArgs, 'prop');
    const { before, after, diff } = await diffPaintingSourceFiles(
      { file: args.source, pairs: props }, { file: args.edited ?? args.source, pairs: [...props, ...flagPairs(rawArgs, 'to')] },
    );
    if (!diff) {
      for (const [side, { problems }] of [['before', before], ['after', after]] as const) {
        for (const problem of paintingErrors(problems)) console.error(`${side}: ${paintingProblemText(problem)}`);
      }
      process.exitCode = 1;
      return;
    }
    for (const line of paintingEvaluationDiffLines(diff)) console.log(line);
  }),
});

export default defineCommand({
  meta: { name: 'paint', description: 'Painting sources: pure TS factories returning a PaintingDocument (docs/painting-authoring.md)' },
  subCommands: { check: checkPaintCommand, diff: diffPaintCommand },
});
