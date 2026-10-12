// studio review notes: the project's notes as an agent reads them, placed on one render, as markdown or JSON.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../../command-flags.ts';
import { studioProjectArg } from '../../project-arg.ts';

const REVIEW_THREAD_STATES = ['open', 'addressed', 'resolved', 'reopened'] as const;
const REVIEW_ANCHOR_KINDS = ['video', 'still', 'script', 'decision', 'project'] as const;

const reviewNotesArgs = {
  project: studioProjectArg,
  all: { type: 'boolean', description: 'Every note, resolved and addressed ones too' },
  state: { type: 'string', valueHint: 'open,reopened', description: `The states to list, of ${REVIEW_THREAD_STATES.join(', ')}; open and reopened by default` },
  on: { type: 'string', valueHint: 'video', description: `Only notes on one kind of thing: ${REVIEW_ANCHOR_KINDS.join(', ')}` },
  render: { type: 'string', valueHint: 'out/video.mp4', description: 'The render or still (its path in the project) to place notes on; the newest full render by default, with the reply slices laid into it' },
  since: { type: 'string', valueHint: 'revision', description: 'Only notes changed after this review revision' },
  json: { type: 'boolean', description: 'Print { revision, threads, decisions } as JSON, each thread with its placement, instead of markdown' },
} as const satisfies ArgsDef;

/** A comma list of `allowed` values, each checked. */
function listFlagOf<T extends string>(flag: string, value: string, allowed: readonly T[]): T[] {
  return value.split(',').map((v) => {
    const found = allowed.find((a) => a === v.trim());
    if (!found) throw new Error(`--${flag} takes ${allowed.join(', ')}, not ${v}`);
    return found;
  });
}

export const reviewNotesCommand = defineCommand({
  meta: {
    name: 'notes',
    description: "The project's notes from review/review.json, placed on a render (the newest full render unless --render): open and reopened by default, each with its moment, the render it was written on and its commits, the point in pixels and what's under it, its scene with its source file and frames, the frame the reviewer saw (review/frames/), a ready studio look line, a fix's render --scene and reply line, its replies, and the standing `keep` notes. Paths are from the repo root. A note whose moment isn't on this render is listed as unplaced, saying why. Open decisions follow.",
  },
  args: reviewNotesArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, reviewNotesArgs);
    if (args.all && args.state) throw new Error('--all lists every state: leave out --state');
    const states = args.all ? [...REVIEW_THREAD_STATES] : listFlagOf('state', args.state ?? 'open,reopened', REVIEW_THREAD_STATES);
    const on = args.on === undefined ? undefined : listFlagOf('on', args.on, REVIEW_ANCHOR_KINDS);
    const since = args.since === undefined ? 0 : Number(args.since);
    if (!(Number.isInteger(since) && since >= 0)) throw new Error(`--since is a review revision, a whole number, not ${args.since}`);

    const { basename } = await import('node:path');
    const { resolveStudioProject } = await import('#lib/platform/project/engine/studio-project.ts');
    const { readReviewFile } = await import('#lib/output/review/engine/review-file.ts');
    const handoffs = await import('#lib/output/review/engine/review-handoff.ts');
    const dir = resolveStudioProject(args.project), project = basename(dir);
    const file = readReviewFile(dir);
    const handoff = handoffs.openReviewHandoff(project, handoffs.reviewHandoffRenderOf(project, args.render));
    const threads = handoffs.placeReviewHandoff(handoff, file.threads.filter((t) => t.rev > since && (!on || on.includes(t.anchor.on))));
    const decisions = file.decisions.filter((d) => d.rev > since && (since > 0 || d.state === 'open'));
    if (args.json) {
      console.log(JSON.stringify({ revision: file.revision, threads: threads.filter((t) => t.kind === 'keep' || states.includes(t.state)), decisions }, null, 2));
      return;
    }
    process.stdout.write(handoffs.formatReviewHandoff(handoff, threads, decisions, states));
    console.log(`\nrevision ${file.revision}`);
  },
});
