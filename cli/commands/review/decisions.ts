// studio review decisions: the choices posted in a project's review, with the reviewer's verdicts and picks.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../../command-flags.ts';
import { studioProjectArg } from '../../project-arg.ts';

const reviewDecisionsArgs = {
  project: studioProjectArg,
  open: { type: 'boolean', description: 'Only those still open' },
  json: { type: 'boolean', description: 'Print { revision, decisions } as JSON instead of markdown' },
} as const satisfies ArgsDef;

export const reviewDecisionsCommand = defineCommand({
  meta: {
    name: 'decisions',
    description: "Print the project's decisions with their candidates, the reviewer's verdicts and the picks.",
    about: "Newest last: each one's question and state, every candidate with its file from the studio root, its meta and the reviewer's pick or reject, and once signed off, the picks. Comments on a candidate are notes on it, which `notes --on decision` lists.",
  },
  args: reviewDecisionsArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, reviewDecisionsArgs);
    const { basename } = await import('node:path');
    const { resolveStudioProject } = await import('#lib/platform/project/engine/studio-project.ts');
    const { readReviewFile } = await import('#lib/output/review/engine/review-file.ts');
    const { formatReviewDecisionsMarkdown } = await import('#lib/output/review/models/review-decision-markdown.ts');
    const dir = resolveStudioProject(args.project), project = basename(dir);
    const file = readReviewFile(dir);
    const decisions = file.decisions.filter((d) => !args.open || d.state === 'open');
    if (args.json) console.log(JSON.stringify({ revision: file.revision, decisions }, null, 2));
    else console.log(decisions.length ? formatReviewDecisionsMarkdown(project, decisions) : `(no ${args.open ? 'open ' : ''}decisions in ${project})`);
  },
});
