// studio review notes: the project's notes as an agent reads them, placed on one render and plan notes on the
// storyboard, as markdown or JSON.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../../command-flags.ts';
import { studioProjectArg } from '../../project-arg.ts';

const REVIEW_THREAD_STATES = ['open', 'addressed', 'resolved', 'reopened'] as const;
const REVIEW_ANCHOR_KINDS = ['video', 'still', 'plan', 'decision', 'project'] as const;

const reviewNotesArgs = {
  project: studioProjectArg,
  all: { type: 'boolean', description: 'Every note, resolved and addressed ones too' },
  state: { type: 'string', valueHint: 'open,reopened', description: `The states to list, of ${REVIEW_THREAD_STATES.join(', ')}; open and reopened by default` },
  on: { type: 'string', valueHint: 'video', description: `Only notes on one kind of thing: ${REVIEW_ANCHOR_KINDS.join(', ')}` },
  render: { type: 'string', valueHint: 'out/video.mp4', description: 'The render or still (its path in the project) to place notes on; the newest full render by default, with the reply slices laid into it' },
  since: { type: 'string', valueHint: 'revision', description: 'Only notes changed after this review revision' },
  json: { type: 'boolean', description: 'Print { revision, threads, decisions, stale } as JSON, each thread with its placement and each stale plan scene with its changed fields, instead of markdown' },
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
    description: "Print the project's notes, placed on a render or the plan, each with how to fix and hand it back.",
    about: "Open and reopened notes by default, placed on the newest full render unless --render: each with its moment, the render it was written on and its commits, the point in pixels and what's under it, its scene with its source file and frames, the frame the reviewer saw (review/frames/), a ready studio look line, a fix's render --scene and reply line, its replies, and the standing `keep` notes. Paths are from the studio root, but for a scene's source, which is in the project. A plan note (--on plan) names its scene, what it's on (a line, a cell, a brief section, the left-out list) and the words it quotes, found again in storyboard.ts as it is now, with the nearest cue and its frame on the plan's clock, and, once its field has changed since, `was:` the old text and `now:` the new with [-removed-] and {+added+} words; it needs no render. The plan's scenes changed since they were signed off follow, each reworded field with its diff. A note whose moment isn't on this render, or whose quote the plan no longer says, is listed as unplaced, saying why. Open decisions follow.",
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
    const threads = await handoffs.placeReviewHandoff(handoff, file.threads.filter((t) => t.rev > since && (!on || on.includes(t.anchor.on))));
    const decisions = file.decisions.filter((d) => d.rev > since && (since > 0 || d.state === 'open'));
    const stale = !on || on.includes('plan') ? await handoffs.reviewHandoffStalePlan(project, file.signoffs) : [];
    if (args.json) {
      console.log(JSON.stringify({ revision: file.revision, threads: threads.filter((t) => t.kind === 'keep' || states.includes(t.state)), decisions, stale }, null, 2));
      return;
    }
    const { formatReviewPlanStaleMarkdown } = await import('#lib/output/review/models/review-markdown.ts');
    process.stdout.write(handoffs.formatReviewHandoff(handoff, threads, decisions, states));
    const staleMarkdown = formatReviewPlanStaleMarkdown(stale);
    if (staleMarkdown) process.stdout.write(`\n${staleMarkdown}`);
    console.log(`\nrevision ${file.revision}`);
  },
});
