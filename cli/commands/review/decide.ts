// studio review decide: the agent posts a choice for the reviewer: a question and two or more candidates (renders,
// stills, music beds, voices, lines of text), which they survey, pick from and sign off in the studio app.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../../command-flags.ts';
import { studioProjectArg } from '../../project-arg.ts';

const reviewDecideArgs = {
  project: studioProjectArg,
  topic: { type: 'positional', required: false, description: 'A short name for the choice, music-bed say; posting on an open topic again replaces its candidates' },
  question: { type: 'string', valueHint: 'Which bed under the VO?', description: 'What the reviewer is choosing' },
  candidate: { type: 'string', valueHint: 'out/decisions/music-bed/warm.mp3=Warm', description: 'A candidate, once per candidate: a file in the project (a video, image or audio file; put new ones in out/decisions/<topic>/), or text:<the text>, each optionally =<label>' },
  many: { type: 'boolean', description: 'The reviewer may pick several, not one' },
  spec: { type: 'string', valueHint: 'decision.json', description: 'The whole decision as JSON, a file or - for stdin: { topic, question, choose?: "one"|"many", candidates: [{ path? | text?, label?, meta?: { model, seed, cost… } }] }, in place of the other flags' },
} as const satisfies ArgsDef;

/** Every value given to a flag repeated on the command line: citty keeps only the last. */
function repeatedFlagValues(rawArgs: readonly string[], flag: string): string[] {
  return rawArgs.flatMap((arg, i) => {
    if (arg === `--${flag}`) return rawArgs[i + 1] === undefined ? [] : [rawArgs[i + 1]];
    return arg.startsWith(`--${flag}=`) ? [arg.slice(flag.length + 3)] : [];
  });
}

/** `<path or text:…>[=label]`, the label after the last `=`. */
function candidateFlagOf(value: string) {
  const split = value.lastIndexOf('=');
  const [what, label] = split > 0 ? [value.slice(0, split), value.slice(split + 1)] : [value, undefined];
  return { ...(what.startsWith('text:') ? { text: what.slice('text:'.length) } : { path: what }), ...(label && { label }) };
}

type DecisionSpec = { topic: string; question: string; choose?: 'one' | 'many'; candidates: { path?: string; text?: string; label?: string; meta?: Record<string, string | number> }[] };

/** A --spec file, held to the shape its flag names: it's written by hand or by another tool. */
function decisionSpecOf(text: string, from: string): DecisionSpec {
  // SAFETY: each field the decision needs is checked below before it's used.
  const spec = JSON.parse(text) as Partial<DecisionSpec>;
  if (typeof spec.topic !== 'string' || typeof spec.question !== 'string' || !Array.isArray(spec.candidates)) {
    throw new Error(`${from} needs a topic, a question and candidates`);
  }
  if (spec.choose !== undefined && spec.choose !== 'one' && spec.choose !== 'many') throw new Error(`${from}: choose is "one" or "many"`);
  return { topic: spec.topic, question: spec.question, candidates: spec.candidates, ...(spec.choose && { choose: spec.choose }) };
}

export const reviewDecideCommand = defineCommand({
  meta: {
    name: 'decide',
    description: "Post a choice for the reviewer: a question and two or more candidates, keyed a, b, c… in order. Each file is checked to be media in the project and recorded by its hash, so one changed later shows as stale; text candidates are shown as written. The reviewer surveys them in the studio app at /projects/<p>/decisions/<topic>, compares any two on one transport, picks or rejects each, comments on any, and signs off; watch wakes on each verdict and on the sign-off, and decisions prints them. Posting an open topic again replaces its candidates, keeping verdicts on those that come back unchanged. Prints the decision's id.",
  },
  args: reviewDecideArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, reviewDecideArgs);
    const flags = repeatedFlagValues(rawArgs, 'candidate');
    let spec: DecisionSpec;
    if (args.spec !== undefined) {
      if (args.topic !== undefined || args.question !== undefined || flags.length || args.many) throw new Error('--spec is the whole decision: leave out the topic, --question, --candidate and --many');
      const { readFileSync } = await import('node:fs');
      spec = decisionSpecOf(readFileSync(args.spec === '-' ? 0 : args.spec, 'utf8'), args.spec === '-' ? 'stdin' : args.spec);
    } else {
      if (args.topic === undefined || args.question === undefined) throw new Error('give a topic and --question, with a --candidate each, or the whole decision as --spec');
      spec = { topic: args.topic, question: args.question, choose: args.many ? 'many' : 'one', candidates: flags.map(candidateFlagOf) };
    }
    if (!/^[\w-]+$/.test(spec.topic)) throw new Error(`a topic is a name of letters, digits, - and _ (it's in the page's URL), not ${spec.topic}`);

    const { basename } = await import('node:path');
    const { resolveStudioProject } = await import('#lib/platform/project/engine/studio-project.ts');
    const { applyReviewOps } = await import('#lib/output/review/engine/review-file.ts');
    const { reviewCandidateOf } = await import('#lib/output/review/engine/review-handoff.ts');
    const dir = resolveStudioProject(args.project), project = basename(dir);
    const candidates = spec.candidates.map((c, i) => reviewCandidateOf(project, String.fromCharCode(97 + i), c));
    const applied = applyReviewOps(dir, [{ op: 'decision.put', decision: { topic: spec.topic, question: spec.question, choose: spec.choose ?? 'one', candidates } }], 'agent');
    if ('conflict' in applied) throw new Error('posting a decision never conflicts');
    console.log(`posted #${applied.changed[0]} ${spec.topic}: ${candidates.map((c) => `${c.key} ${c.label}`).join(', ')} (revision ${applied.file.revision})`);
  },
});
