// studio review decide: the agent posts a choice for the reviewer: a question and two or more candidates (renders,
// stills, music beds, voices, lines of text), which they survey, pick from and sign off in the studio app.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../../command-flags.ts';
import type { ReviewCandidateSpec } from '#lib/output/review/engine/review-handoff.ts';
import { studioProjectArg } from '../../project-arg.ts';

const reviewDecideArgs = {
  project: studioProjectArg,
  topic: { type: 'positional', required: false, description: 'A short name for the choice, music-bed say; posting on an open topic again replaces its candidates' },
  question: { type: 'string', valueHint: 'Which bed under the VO?', description: 'What the reviewer is choosing' },
  candidate: { type: 'string', valueHint: 'out/decisions/music-bed/warm.wav=Warm', description: 'A candidate, once per candidate: a file in the project (a video, image or audio file; put new ones in out/decisions/<topic>/), text:<the text>, or library:<item>@<from>-<to> for a range of a library item (item time, seconds or m:ss, as `studio library search` prints it), each optionally =<label>' },
  many: { type: 'boolean', description: 'The reviewer may pick several, not one' },
  scene: { type: 'string', valueHint: 'hook', description: "The storyboard scene it's for: the reviewer walks open decisions in story order, each beside its scene" },
  line: { type: 'string', valueHint: 'intro', description: "The line it's for (a take, a read), its text shown beside the candidates; its scene is found when --scene is left out" },
  spec: { type: 'string', valueHint: 'decision.json', description: 'The whole decision as JSON, a file or - for stdin: { topic, question, choose?: "one"|"many", scene?, line?, candidates: [{ path? | text? | library?: { item, from, to }, label?, meta?: { model, seed, cost… } }] }, in place of the other flags' },
} as const satisfies ArgsDef;

/** Every value given to a flag repeated on the command line: citty keeps only the last. */
function repeatedFlagValues(rawArgs: readonly string[], flag: string): string[] {
  return rawArgs.flatMap((arg, i) => {
    if (arg === `--${flag}`) return rawArgs[i + 1] === undefined ? [] : [rawArgs[i + 1]];
    return arg.startsWith(`--${flag}=`) ? [arg.slice(flag.length + 3)] : [];
  });
}

/** A library range as given: the item by its id or a part of it, the times in seconds or m:ss. */
type DecisionLibraryRangeSpec = { item: string; from: number | string; to: number | string };

/** A candidate as given: a file or a text as `reviewCandidateOf` takes it, or a library range still to be checked. */
type DecisionCandidateSpec = Omit<ReviewCandidateSpec, 'library'> | (Pick<ReviewCandidateSpec, 'label' | 'meta'> & { library: DecisionLibraryRangeSpec });

/** `library:<item>@<from>-<to>`, its times left as written. */
function libraryCandidateFlagOf(what: string): DecisionLibraryRangeSpec {
  const at = what.lastIndexOf('@'), [from, to] = what.slice(at + 1).split('-');
  if (at <= 0 || from === undefined || to === undefined) throw new Error(`a library candidate is library:<item>@<from>-<to>, not ${what}`);
  return { item: what.slice(0, at), from, to };
}

/** `<path, text:… or library:…>[=label]`, the label after the last `=`. */
function candidateFlagOf(value: string): DecisionCandidateSpec {
  const split = value.lastIndexOf('=');
  const [what, label] = split > 0 ? [value.slice(0, split), value.slice(split + 1)] : [value, undefined];
  const labelled = label ? { label } : {};
  if (what.startsWith('text:')) return { text: what.slice('text:'.length), ...labelled };
  if (what.startsWith('library:')) return { library: libraryCandidateFlagOf(what.slice('library:'.length)), ...labelled };
  return { path: what, ...labelled };
}

type DecisionSpec = { topic: string; question: string; choose?: 'one' | 'many'; scene?: string; line?: string; candidates: DecisionCandidateSpec[] };

/**
 * Each library range checked against its item, which is named by its full id, with what's said in it as its text:
 * the reviewer reads it beside the picture, and a re-post with the same words keeps its verdict.
 */
async function resolveLibraryCandidates(candidates: readonly DecisionCandidateSpec[]): Promise<ReviewCandidateSpec[]> {
  // The library's services load only for a decision that has a range.
  const plain = candidates.flatMap((c) => ('library' in c ? [] : [c]));
  if (plain.length === candidates.length) return plain;
  const [{ Effect }, { runStudioEffect }, { libraryLayer }, { readLibraryRangeEffect }, { libraryClockSecondsOf }] = await Promise.all([
    import('effect'),
    import('#lib/platform/process/engine/studio-effect-runtime.ts'),
    import('#lib/footage/library/engine/library-layer.ts'),
    import('#lib/footage/library/engine/library-app.ts'),
    import('#lib/footage/library/models/library-range.ts'),
  ]);
  const seconds = (time: number | string) => (typeof time === 'number' ? Effect.succeed(time) : Effect.fromResult(libraryClockSecondsOf(time)));
  return runStudioEffect(Effect.forEach(candidates, (candidate) => Effect.gen(function* () {
    if (!('library' in candidate)) return candidate;
    const { library, ...rest } = candidate;
    const range = yield* readLibraryRangeEffect(library.item, yield* seconds(library.from), yield* seconds(library.to));
    const resolved: ReviewCandidateSpec = { ...rest, library: { item: range.item, from: range.from, to: range.to }, ...(range.said && { text: range.said }) };
    return resolved;
  })), libraryLayer);
}

/** A --spec file, held to the shape its flag names: it's written by hand or by another tool. */
function decisionSpecOf(text: string, from: string): DecisionSpec {
  // SAFETY: each field the decision needs is checked below before it's used.
  const spec = JSON.parse(text) as Partial<DecisionSpec>;
  if (typeof spec.topic !== 'string' || typeof spec.question !== 'string' || !Array.isArray(spec.candidates)) {
    throw new Error(`${from} needs a topic, a question and candidates`);
  }
  if (spec.choose !== undefined && spec.choose !== 'one' && spec.choose !== 'many') throw new Error(`${from}: choose is "one" or "many"`);
  for (const key of ['scene', 'line'] as const) {
    if (spec[key] !== undefined && typeof spec[key] !== 'string') throw new Error(`${from}: ${key} is a storyboard id`);
  }
  return {
    topic: spec.topic, question: spec.question, candidates: spec.candidates,
    ...(spec.choose && { choose: spec.choose }), ...(spec.scene !== undefined && { scene: spec.scene }), ...(spec.line !== undefined && { line: spec.line }),
  };
}

export const reviewDecideCommand = defineCommand({
  meta: {
    name: 'decide',
    description: "Post a choice between two or more candidates for the reviewer to pick from and sign off.",
    about: "Candidates are keyed a, b, c… in order. Each file is checked to be media in the project and recorded by its hash, so one changed later shows as stale; text candidates are shown as written; a library range (library:<item>@<from>-<to>) is checked against its item and played from the library with sound and picture, never copied, with what's said in it beside it. The reviewer surveys them in the studio app at /projects/<p>/decisions/<topic>, walking every open decision in the project in one pass, in story order by --scene and --line (those without come last; a topic posted again without them keeps its place), compares any two on one transport, picks or rejects each, comments on any, and signs off; watch wakes on each verdict and on the sign-off, and decisions prints them. Posting an open topic again replaces its candidates, keeping verdicts on those that come back unchanged. Prints the decision's id.",
  },
  args: reviewDecideArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, reviewDecideArgs);
    const flags = repeatedFlagValues(rawArgs, 'candidate');
    let spec: DecisionSpec;
    if (args.spec !== undefined) {
      if (args.topic !== undefined || args.question !== undefined || flags.length || args.many || args.scene !== undefined || args.line !== undefined) {
        throw new Error('--spec is the whole decision: leave out the topic, --question, --candidate, --many, --scene and --line');
      }
      const { readFileSync } = await import('node:fs');
      spec = decisionSpecOf(readFileSync(args.spec === '-' ? 0 : args.spec, 'utf8'), args.spec === '-' ? 'stdin' : args.spec);
    } else {
      if (args.topic === undefined || args.question === undefined) throw new Error('give a topic and --question, with a --candidate each, or the whole decision as --spec');
      spec = {
        topic: args.topic, question: args.question, choose: args.many ? 'many' : 'one', candidates: flags.map(candidateFlagOf),
        ...(args.scene !== undefined && { scene: args.scene }), ...(args.line !== undefined && { line: args.line }),
      };
    }
    if (!/^[\w-]+$/.test(spec.topic)) throw new Error(`a topic is a name of letters, digits, - and _ (it's in the page's URL), not ${spec.topic}`);

    const { basename } = await import('node:path');
    const { resolveStudioProject } = await import('#lib/platform/project/engine/studio-project.ts');
    const { applyReviewOps } = await import('#lib/output/review/engine/review-file.ts');
    const { reviewCandidateOf, reviewDecisionAboutOf } = await import('#lib/output/review/engine/review-handoff.ts');
    const dir = resolveStudioProject(args.project), project = basename(dir);
    const resolved = await resolveLibraryCandidates(spec.candidates);
    const candidates = resolved.map((c, i) => reviewCandidateOf(project, String.fromCharCode(97 + i), c));
    const about = spec.scene === undefined && spec.line === undefined ? undefined : await reviewDecisionAboutOf(project, spec);
    const decision = { topic: spec.topic, question: spec.question, choose: spec.choose ?? 'one', ...(about && { about }), candidates };
    const applied = applyReviewOps(dir, [{ op: 'decision.put', decision }], 'agent');
    if ('conflict' in applied) throw new Error('posting a decision never conflicts');
    console.log(`posted #${applied.changed[0]} ${spec.topic}: ${candidates.map((c) => `${c.key} ${c.label}`).join(', ')} (revision ${applied.file.revision})`);
  },
});
