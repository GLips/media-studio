// studio review watch: what an agent leaves running in the background: it blocks until the reviewer adds or changes
// notes, prints them once the burst settles, and exits so the agent is woken to act and runs it again.
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
  timeout: { type: 'string', valueHint: '30m', description: `Give up after this long with no change, exiting ${REVIEW_WATCH_TIMEOUT_EXIT}; waits for good by default` },
  render: { type: 'string', valueHint: 'out/video.mp4', description: 'The render or still to place notes on; the newest full render by default, with the reply slices laid into it' },
  json: { type: 'boolean', description: 'Print { revision, changed, decisions } as JSON instead of markdown' },
} as const satisfies ArgsDef;

export const reviewWatchCommand = defineCommand({
  meta: {
    name: 'watch',
    description: "Block until the reviewer changes a note or decision, print what changed, and exit.",
    about: "Wakes on a note added, edited, replied to, resolved or reopened, or a decision picked or signed off, past the project's watch cursor (one watcher a project); waits --settle for the burst to end; prints every note and decision changed, as `studio review notes` does, saves the cursor past them and exits 0. Each fix on a video names its scene and the frames it's on screen, and a fix: line: the `studio render --scene` that re-renders that scene and the reply that hands the slice over. Run it in the background, act on what it prints, then run it again: it never repeats what a run showed nor misses what landed while you worked. A first run prints the whole backlog. The agent's own replies and `keep` notes never wake it. On --timeout with no change, prints `no change since rN` and exits 2.",
  },
  args: reviewWatchArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, reviewWatchArgs);
    const settleMs = durationFlagMs('settle', args.settle);
    const timeoutMs = args.timeout === undefined ? undefined : durationFlagMs('timeout', args.timeout);

    const { basename } = await import('node:path');
    const { resolveStudioProject } = await import('#lib/platform/project/engine/studio-project.ts');
    const { waitForReviewChange } = await import('#lib/output/review/engine/review-watch.ts');
    const handoffs = await import('#lib/output/review/engine/review-handoff.ts');
    const dir = resolveStudioProject(args.project), project = basename(dir);
    // Found before blocking, so a missing render fails now, and read after: it may be rendered again meanwhile.
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
    const changed = handoffs.placeReviewHandoff(handoff, change.changed);
    if (args.json) {
      console.log(JSON.stringify({ revision: change.revision, changed, decisions: change.decisions }, null, 2));
      return;
    }
    process.stdout.write(handoffs.formatReviewHandoff(handoff, changed, change.decisions, ['open', 'addressed', 'resolved', 'reopened']));
    console.log(`\nrevision ${change.revision}\nnext: fix each note (its fix: line), then studio review watch ${project}`);
  },
});
