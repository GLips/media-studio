// studio paint: painting sources (`*.painting.ts`, docs/painting-authoring.md): checked, compared, and solved on the
// GPU to be seen.
import { defineCommand, type ArgsDef } from 'citty';
import { paintingValueTextPairs } from '#lib/paint/document/models/painting-properties.ts';
import { refuseUnknownCommandFlags } from '../command-flags.ts';

/** `--at`'s scene second, null when it's left out. */
function sceneSecondFlag(text: string | undefined): number | null {
  if (text === undefined) return null;
  const at = Number(text);
  if (text.trim() === '' || !Number.isFinite(at)) throw new Error(`--at takes a scene second, not "${text}"`);
  return at;
}

/** `--<flag>`'s `a=1,b=true` by name, as text: the source's schema reads each value. */
const flagValues = (flag: 'set' | 'to', list: string | undefined): Record<string, string> => Object.fromEntries(paintingValueTextPairs(flag, list ?? ''));

/**
 * Runs a paint verb, a throw printed whole and failing the run: a throw from a source's import or factory is the
 * author's bug, and its stack says where. The studio would print only its message. The render's tsx hooks come first:
 * a source timed by its project's timeline imports the track's audio.
 */
async function withPaintSourceStack(verb: () => Promise<void>): Promise<void> {
  try {
    await import('#lib/output/render/engine/tsx-test-hooks.ts');
    await verb();
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}

const checkPaintArgs = {
  source: { type: 'positional', required: true, description: 'The *.painting.ts module' },
  set: { type: 'string', valueHint: 'hillTopPx=210,dusk=true', description: 'Property values, held to their schema like any other (an off-step value is an error)' },
  solve: { type: 'boolean', description: 'With no error, solve every sheet on the GPU: print each wash\'s start, damp window and set time, each application\'s landing time and each bloom\'s span damp again, sheet by sheet, and write the painting, and each film on its sheet\'s paper and edge, as PNGs' },
  out: { type: 'string', valueHint: 'meadow.solve', description: 'Where --solve writes painting.png and films/<layer>.png (default: <source>.solve in the current directory)' },
  at: { type: 'string', valueHint: '3.5', description: 'With --solve, solve only what lands by this scene second: the unclocked run and each clocked application landing by it (default: everything)' },
} as const satisfies ArgsDef;

const checkPaintCommand = defineCommand({
  meta: {
    name: 'check',
    description: "Evaluate a painting source at its default property values (or those --set gives) and print every problem found: the schema and values, the factory's purity (called twice, its documents compared), the document's shape and keys, its papers, brushes and assets against work/styles/, its geometry, charges and media, washes, clocks and `on`s that can never hold. Each problem prints as `<path>: <message> [x0,y0 → x1,y1]`, the box in document px; warnings say so. Then, if it has no error, the document's size and medium and each layer's medium, sheet, washes and applications, and how many `on` gates only a solve decides; with --solve, every sheet solved (an application that can't land fails the check, naming where its rule failed). Fails on any error.",
  },
  args: checkPaintArgs,
  run: ({ args, rawArgs }) => {
    // Read before the verb runs: a malformed flag is the command's to refuse in a line, not a source's stack.
    refuseUnknownCommandFlags(rawArgs, checkPaintArgs);
    const set = flagValues('set', args.set), at = sceneSecondFlag(args.at);
    if (at !== null && !args.solve) throw new Error('--at picks the prefix a solve paints: give --solve too');
    return withPaintSourceStack(async () => {
      const { paintingProblemText, paintingErrors } = await import('#lib/paint/document/models/painting-problem.ts');
      const { paintingCheckLeftToSolve, paintingEvaluationSummary } = await import('#lib/paint/document/models/painting-summary.ts');
      const { checkPaintingSourceFile } = await import('#lib/paint/document/engine/painting-source-load.ts');
      const { problems, evaluation } = await checkPaintingSourceFile(args.source, set);
      for (const problem of problems) console.log(paintingProblemText(problem));
      if (evaluation) for (const line of paintingEvaluationSummary(evaluation)) console.log(line);
      const errors = paintingErrors(problems).length, warnings = problems.length - errors;
      // A solve that follows decides what the check left; without one, the summary says what went unexamined.
      const leftToSolve = evaluation && !args.solve ? paintingCheckLeftToSolve(evaluation) : null;
      console.error(`paint check: ${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}${leftToSolve ? `; ${leftToSolve}` : ''}`);
      if (errors > 0) {
        process.exitCode = 1;
        return;
      }
      if (!args.solve) return;
      const { paintPaintingSourceStill, paintingSourceStem, writePaintingSolveImages } = await import('#lib/paint/document/engine/painting-still.ts');
      const { still, refused } = await paintPaintingSourceStill(args.source, set, { films: true, at, dampWindows: true });
      if (!still) {
        console.error(`paint check: ${refused}`);
        process.exitCode = 1;
        return;
      }
      for (const problem of still.problems) console.log(paintingProblemText(problem));
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
  at: { type: 'string', valueHint: '3.5', description: 'Paint only what lands by this scene second: the unclocked run and each clocked application landing by it, finished (default: everything)' },
} as const satisfies ArgsDef;

const stillPaintCommand = defineCommand({
  meta: {
    name: 'still',
    description: "Paint a painting source at its default property values (or those --set gives): checked as `paint check` checks it, then its sheets solved on the GPU and laid as one PNG the document's size, each own sheet a cut-out of its paper. Prints its problems and the solve's warnings, and fails on any error, or on an application that can't land.",
  },
  args: stillPaintArgs,
  run: ({ args, rawArgs }) => {
    refuseUnknownCommandFlags(rawArgs, stillPaintArgs);
    const set = flagValues('set', args.set), at = sceneSecondFlag(args.at);
    return withPaintSourceStack(async () => {
      const { paintingProblemText, paintingErrors } = await import('#lib/paint/document/models/painting-problem.ts');
      const { paintPaintingSourceStill, paintingSourceStem, writePaintingStillPng } = await import('#lib/paint/document/engine/painting-still.ts');
      const { problems, still, refused } = await paintPaintingSourceStill(args.source, set, { films: false, at, dampWindows: false });
      for (const problem of problems) console.log(paintingProblemText(problem));
      if (!still) {
        const errors = paintingErrors(problems).length;
        console.error(`paint still: ${refused ?? `${errors} ${errors === 1 ? 'error' : 'errors'}`}; nothing painted`);
        process.exitCode = 1;
        return;
      }
      for (const problem of still.problems) console.log(paintingProblemText(problem));
      for (const warning of still.warnings) console.log(`warning: ${warning}`);
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
    description: "What a solve would redo between two evaluations: a source at --set and at --set with --to on top, or a source and an edited copy (--set on both, --to on the second). Prints the document's fields that differ (paper colour among them, which re-solves nothing), then each wash in its sheet's order: `same`, `content` at the first path that differs in it, or `upstream` after the first change earlier on its sheet; on a wrapped document, a sheet whose margin moves past its power of two reads `upstream` from its start. Keys never count. A side with an error prints its problems instead; then it fails.",
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
