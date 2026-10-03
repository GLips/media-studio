// studio paint: painting sources (`*.painting.ts`, docs/painting-authoring.md): checked, compared, and solved on the
// GPU to be seen.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../command-flags.ts';

/** `--<flag>`'s `a=1,b=true` by name, as text: the source's schema reads each value. */
function flagValues(flag: 'set' | 'to', list: string | undefined): Record<string, string> {
  return Object.fromEntries((list ?? '').split(',').filter(Boolean).map((pair) => {
    const at = pair.indexOf('='), name = pair.slice(0, at).trim();
    if (at < 0 || !name) throw new Error(`--${flag} takes name=value pairs, not "${pair}"`);
    return [name, pair.slice(at + 1).trim()];
  }));
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

const checkPaintArgs = {
  source: { type: 'positional', required: true, description: 'The *.painting.ts module' },
  set: { type: 'string', valueHint: 'hillTopPx=210,dusk=true', description: 'Property values, held to their schema like any other (an off-step value is an error)' },
  solve: { type: 'boolean', description: 'With no error, solve the root sheet on the GPU (under the GPU lock): print each wash\'s start and set times and each application\'s landing time, and write the painting and each film over the paper as PNGs' },
  out: { type: 'string', valueHint: 'meadow.solve', description: 'Where --solve writes painting.png and films/<layer>.png (default: <source>.solve in the current directory)' },
} as const satisfies ArgsDef;

const checkPaintCommand = defineCommand({
  meta: {
    name: 'check',
    description: "Evaluate a painting source at its default property values (or those --set gives) and print every problem found: the schema and values, the factory's purity (called twice, its documents compared), the document's shape and keys, its papers, brushes and assets against work/styles/, its geometry, charges and media, washes, clocks and `on`s that can never hold. Each problem prints as `<path>: <message> [x0,y0 → x1,y1]`, the box in document px; warnings say so. Then, if it has no error, the document's size and medium and each layer's medium, sheet, washes and applications; with --solve, the root sheet solved (an application that can't land fails the check, naming where its rule failed). Fails on any error.",
  },
  args: checkPaintArgs,
  run: ({ args, rawArgs }) => {
    // Read before the verb runs: a malformed flag is the command's to refuse in a line, not a source's stack.
    refuseUnknownCommandFlags(rawArgs, checkPaintArgs);
    const set = flagValues('set', args.set);
    return withPaintSourceStack(async () => {
      const { paintingProblemText, paintingErrors } = await import('#lib/paint/document/models/painting-problem.ts');
      const { paintingEvaluationSummary } = await import('#lib/paint/document/models/painting-summary.ts');
      const { checkPaintingSourceFile } = await import('#lib/paint/document/engine/painting-source-load.ts');
      const { problems, evaluation } = await checkPaintingSourceFile(args.source, set);
      for (const problem of problems) console.log(paintingProblemText(problem));
      if (evaluation) for (const line of paintingEvaluationSummary(evaluation)) console.log(line);
      const errors = paintingErrors(problems).length;
      console.error(`paint check: ${errors} ${errors === 1 ? 'error' : 'errors'}, ${problems.length - errors} ${problems.length - errors === 1 ? 'warning' : 'warnings'}`);
      if (errors > 0) {
        process.exitCode = 1;
        return;
      }
      if (!args.solve) return;
      const { paintPaintingSourceStill, paintingSourceStem, writePaintingSolveImages } = await import('#lib/paint/document/engine/painting-still.ts');
      const { still, refused } = await paintPaintingSourceStill(args.source, set, { films: true });
      if (!still) {
        console.error(`paint check: ${refused}`);
        process.exitCode = 1;
        return;
      }
      for (const line of [...still.lines, still.costs]) console.log(line);
      const wrote = writePaintingSolveImages(still, args.out ?? `${paintingSourceStem(args.source)}.solve`);
      console.error(`paint check: wrote ${wrote.painting} and ${still.films.length} films in ${wrote.films}`);
    });
  },
});

const stillPaintArgs = {
  source: { type: 'positional', required: true, description: 'The *.painting.ts module' },
  set: { type: 'string', valueHint: 'hillTopPx=210,dusk=true', description: 'Property values, held to their schema like any other' },
  out: { type: 'string', valueHint: 'meadow.png', description: 'The PNG to write (default: <source>.png in the current directory)' },
} as const satisfies ArgsDef;

const stillPaintCommand = defineCommand({
  meta: {
    name: 'still',
    description: "Paint a painting source at its default property values (or those --set gives): checked as `paint check` checks it, then its root sheet solved on the GPU (run it under the GPU lock) and written as a PNG the document's size. Prints its problems and fails on any error, or on an application that can't land.",
  },
  args: stillPaintArgs,
  run: ({ args, rawArgs }) => {
    refuseUnknownCommandFlags(rawArgs, stillPaintArgs);
    const set = flagValues('set', args.set);
    return withPaintSourceStack(async () => {
      const { paintingProblemText, paintingErrors } = await import('#lib/paint/document/models/painting-problem.ts');
      const { paintPaintingSourceStill, paintingSourceStem, writePaintingStillPng } = await import('#lib/paint/document/engine/painting-still.ts');
      const { problems, still, refused } = await paintPaintingSourceStill(args.source, set, { films: false });
      for (const problem of problems) console.log(paintingProblemText(problem));
      if (!still) {
        const errors = paintingErrors(problems).length;
        console.error(`paint still: ${refused ?? `${errors} ${errors === 1 ? 'error' : 'errors'}`}; nothing painted`);
        process.exitCode = 1;
        return;
      }
      const out = args.out ?? `${paintingSourceStem(args.source)}.png`;
      writePaintingStillPng(out, still.png);
      console.error(`paint still: wrote ${out}; ${still.costs}`);
    });
  },
});

const diffPaintArgs = {
  source: { type: 'positional', required: true, description: 'The *.painting.ts module' },
  edited: { type: 'positional', required: false, description: 'An edited copy to compare it with; the source again when left out' },
  set: { type: 'string', valueHint: 'hillTopPx=200,dusk=true', description: 'Property values both sides take' },
  to: { type: 'string', valueHint: 'hillTopPx=210', description: 'Property values the second side takes over --set' },
} as const satisfies ArgsDef;

const diffPaintCommand = defineCommand({
  meta: {
    name: 'diff',
    description: "What a solve would redo between two evaluations: a source at --set and at --set with --to on top, or a source and an edited copy (--set on both, --to on the second). Prints the document's fields that differ (paper colour among them, which re-solves nothing), then each wash in its sheet's order: `same`, `content` at the first path that differs in it, or `upstream` after the first change earlier on its sheet. Keys never count. A side with an error prints its problems instead; then it fails.",
  },
  args: diffPaintArgs,
  run: ({ args, rawArgs }) => {
    refuseUnknownCommandFlags(rawArgs, diffPaintArgs);
    const set = flagValues('set', args.set), to = flagValues('to', args.to);
    return withPaintSourceStack(async () => {
      const { diffPaintingSourceFiles } = await import('#lib/paint/document/engine/painting-source-load.ts');
      const { paintingProblemText, paintingErrors } = await import('#lib/paint/document/models/painting-problem.ts');
      const { paintingEvaluationDiffLines } = await import('#lib/paint/document/models/painting-evaluation-diff.ts');
      const { before, after, diff } = await diffPaintingSourceFiles({ file: args.source, texts: set }, { file: args.edited ?? args.source, texts: { ...set, ...to } });
      if (!diff) {
        for (const [side, { problems }] of [['before', before], ['after', after]] as const) {
          for (const problem of paintingErrors(problems)) console.error(`${side}: ${paintingProblemText(problem)}`);
        }
        process.exitCode = 1;
        return;
      }
      for (const line of paintingEvaluationDiffLines(diff)) console.log(line);
    });
  },
});

export default defineCommand({
  meta: { name: 'paint', description: 'Painting sources: pure TS factories returning a PaintingDocument (docs/painting-authoring.md)' },
  subCommands: { check: checkPaintCommand, diff: diffPaintCommand, still: stillPaintCommand },
});
