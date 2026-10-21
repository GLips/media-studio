// studio review watch: what an agent leaves running to be woken by the reviewer. With --follow it never exits and
// prints a line per reviewer act, for a harness that wakes the agent on each line (Claude Code's Monitor); without, it
// blocks until the reviewer changes something, prints it in full once the burst settles, and exits, for a harness that
// wakes the agent only when a background command ends, so the agent runs it again.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../../command-flags.ts';
import { studioProjectArg } from '../../project-arg.ts';

/** The exit code of a watch that timed out with nothing new: a shell loop tells it from a change (0) and a failure (1). */
const REVIEW_WATCH_TIMEOUT_EXIT = 2;

const DURATION_UNITS_MS: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** `3s`, `500ms`, `30m`, `1h` in milliseconds. */
function durationFlagMs(flag: string, value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim());
  if (!match) throw new Error(`--${flag} is a duration like 3s, 500ms or 30m, not ${value}`);
  return Number(match[1]) * DURATION_UNITS_MS[match[2]];
}

const reviewWatchArgs = {
  project: studioProjectArg,
  settle: { type: 'string', default: '3s', description: 'Quiet to wait for after the first change, so a burst of notes comes as one' },
  follow: { type: 'boolean', description: 'Keep running, a line per reviewer act: run it under Claude Code\'s Monitor tool' },
  timeout: { type: 'string', valueHint: '30m', description: `Give up after this long with no change, exiting ${REVIEW_WATCH_TIMEOUT_EXIT}; waits for good by default` },
  render: { type: 'string', valueHint: 'out/video.mp4', description: 'The render or still to place notes on; the newest full render by default, with the reply slices laid into it. Plan notes are placed on storyboard.ts' },
  json: { type: 'boolean', description: 'Print JSON instead of markdown; with --follow, a JSON object a line' },
} as const satisfies ArgsDef;

export const reviewWatchCommand = defineCommand({
  meta: {
    name: 'watch',
    description: "Wake on the reviewer's changes: a line per act for good (--follow), or the next change in full, then exit.",
    about: "One watcher a project; its cursor means nothing is repeated or missed across runs, and a first run reports the whole backlog. The agent's own replies and `keep` notes never wake it. --follow never exits: each line names a note or decision and the command that prints it whole; run it under Claude Code's Monitor tool, which wakes you on each line. Without it, prints the change as `studio review notes` does and exits 0, so run it in the background and again after each wake; on --timeout with no change, exits 2.",
  },
  args: reviewWatchArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, reviewWatchArgs);
    if (args.follow && args.timeout !== undefined) throw new Error('--follow runs for good: leave out --timeout');
    if (args.follow && args.render !== undefined) throw new Error('--follow prints a line per act, placed on no render: leave out --render, and give it to notes');
    const settleMs = durationFlagMs('settle', args.settle);
    const timeoutMs = args.timeout === undefined ? undefined : durationFlagMs('timeout', args.timeout);

    const { basename } = await import('node:path');
    const { resolveStudioProject } = await import('#lib/platform/project/engine/studio-project.ts');
    const { waitForReviewChange, watchReviewChanges } = await import('#lib/output/review/engine/review-watch.ts');
    const handoffs = await import('#lib/output/review/engine/review-handoff.ts');
    const dir = resolveStudioProject(args.project), project = basename(dir);
    if (args.follow) {
      const { reviewWatchEventsOf, formatReviewWatchEvent } = await import('#lib/output/review/models/review-watch-events.ts');
      process.stderr.write(`following ${project}'s review: a line per reviewer act\n`);
      for await (const change of watchReviewChanges({ projectDir: dir, settleMs })) {
        if ('timeout' in change) throw new Error('a watch with no --timeout timed out');
        const events = reviewWatchEventsOf({ threads: change.changed, decisions: change.decisions, signoffs: change.signoffs }, change.cursor);
        for (const event of events) console.log(args.json ? JSON.stringify(event) : formatReviewWatchEvent(project, event));
      }
    }
    // Found before blocking, so a missing --render fails now, and read after: it may be rendered again meanwhile. Before
    // the first render there is none, and the plan's notes are placed on the storyboard alone.
    const renderPath = handoffs.reviewHandoffRenderOf(project, args.render);
    process.stderr.write(`watching ${project}'s review${timeoutMs === undefined ? '' : ` for ${args.timeout}`}\n`);
    const change = await waitForReviewChange({ projectDir: dir, settleMs, ...(timeoutMs !== undefined && { timeoutMs }) });
    if ('timeout' in change) {
      console.error(`no change since r${change.timeout}`);
      process.exitCode = REVIEW_WATCH_TIMEOUT_EXIT;
      return;
    }
    // The watch hands threads back as stored; placed here on the render, as `notes` places them.
    const handoff = handoffs.openReviewHandoff(project, renderPath);
    const changed = await handoffs.placeReviewHandoff(handoff, change.changed);
    if (args.json) {
      console.log(JSON.stringify({ revision: change.revision, changed, decisions: change.decisions, signoffs: change.signoffs }, null, 2));
      return;
    }
    process.stdout.write(handoffs.formatReviewHandoff(handoff, changed, change.decisions, ['open', 'addressed', 'resolved', 'reopened']));
    for (const s of change.signoffs) console.log(`signed off: ${s.on === 'plan' ? `plan scene ${s.scene}` : `render ${s.path}`}`);
    console.log(`\nrevision ${change.revision}\nnext: fix each note (its fix: line) or reply to it, then run this watch again (under --follow it runs on)`);
  },
});
