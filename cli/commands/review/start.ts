// studio review start: the agent says it has started on notes, so the reviewer's page marks each as being worked on
// until the agent's next reply on it.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../../command-flags.ts';
import { studioProjectArg } from '../../project-arg.ts';

const reviewStartArgs = {
  project: studioProjectArg,
  ids: { type: 'positional', required: true, description: 'The notes\' ids, as notes and watch print them: 12, or 12,14, or 12 14' },
} as const satisfies ArgsDef;

export const reviewStartCommand = defineCommand({
  meta: {
    name: 'start',
    description: 'Tell the reviewer you have started on notes: each shows as being worked on until you reply to it.',
    about: "Run it as you start on a note or hand it to a subagent, before the work, so the reviewer's page shows a spinner on it within a second. Your next reply on the note (studio review reply, with or without --addressed or --question) clears it. A mark with no reply for 30 minutes clears itself, so a long fix runs start again to keep it. Prints the review's revision.",
  },
  args: reviewStartArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, reviewStartArgs);
    // citty's `_` holds every positional, the project and the first ids among them: the rest are further ids.
    const words = [...args.ids.split(','), ...args._.slice(2).flatMap((s) => s.split(','))].map((s) => s.trim()).filter(Boolean);
    const ids = [...new Set(words.map((s) => Number(s.replace(/^#/, ''))))];
    const bad = ids.find((id) => !(Number.isInteger(id) && id > 0));
    if (!ids.length || bad !== undefined) throw new Error(`${args.ids} isn't a list of notes' ids: notes and watch print them as #12`);

    const { basename } = await import('node:path');
    const { resolveStudioProject } = await import('#lib/platform/project/engine/studio-project.ts');
    const { applyReviewOps } = await import('#lib/output/review/engine/review-file.ts');
    const dir = resolveStudioProject(args.project);
    const applied = applyReviewOps(dir, [{ op: 'thread.working', ids }], 'agent');
    if ('conflict' in applied) throw new Error(`#${applied.conflict.id} changed meanwhile: run it again`);
    console.log(`started on ${ids.map((id) => `#${id}`).join(', ')} in ${basename(dir)} (revision ${applied.file.revision})`);
  },
});
