// studio review reply: the agent's answer on a note: a reply, marking it addressed with the commit and render that
// show the fix, or a question back to the reviewer.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../../command-flags.ts';
import { studioProjectArg } from '../../project-arg.ts';

const reviewReplyArgs = {
  project: studioProjectArg,
  id: { type: 'positional', required: true, description: 'The note\'s id, as notes and watch print it (#12 is 12)' },
  text: { type: 'positional', required: true, description: 'The reply, in markdown; paragraphs are kept' },
  addressed: { type: 'boolean', description: 'Mark the note addressed: fixed, for the reviewer to verify and resolve' },
  question: { type: 'boolean', description: 'Ask the reviewer: the note waits on them until they answer' },
  commit: { type: 'string', valueHint: 'HEAD', description: 'The commit with the fix, resolved to hashes in the studio and the workspace now, so it stays meaningful after the branch moves' },
  render: { type: 'string', valueHint: 'out/video.mp4', description: 'The render (its path in the project) that shows the fix, recorded by its hash' },
} as const satisfies ArgsDef;

export const reviewReplyCommand = defineCommand({
  meta: {
    name: 'reply',
    description: "Reply to a note as the agent; the reviewer's page shows it within a second. --addressed marks it fixed, for the reviewer to verify: give --commit and --render so they can see where. --question asks them instead, and the note waits on them. Only the reviewer resolves or reopens a note, and a `keep` note has nothing to address. Prints the review's revision.",
  },
  args: reviewReplyArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, reviewReplyArgs);
    if (args.addressed && args.question) throw new Error('a reply either marks the note addressed or asks: give --addressed or --question');
    const id = Number(args.id.replace(/^#/, ''));
    if (!(Number.isInteger(id) && id > 0)) throw new Error(`${args.id} isn't a note's id: notes and watch print them as #12`);

    const { basename } = await import('node:path');
    const { resolveStudioProject } = await import('#lib/platform/project/engine/studio-project.ts');
    const { renderFileStamp } = await import('#lib/output/render/engine/render-snapshot.ts');
    const { resolveProjectMedia } = await import('#lib/output/review/engine/project-media.ts');
    const { applyReviewOps } = await import('#lib/output/review/engine/review-file.ts');
    const { resolveReviewCommit } = await import('#lib/output/review/engine/review-handoff.ts');
    const dir = resolveStudioProject(args.project), project = basename(dir);
    const commit = args.commit === undefined ? undefined : resolveReviewCommit(args.commit);
    const render = args.render === undefined ? undefined : renderFileStamp(resolveProjectMedia(project, args.render)).hash;
    const applied = applyReviewOps(dir, [{
      op: 'thread.reply', id, text: args.text,
      ...(args.addressed && { transition: 'addressed' as const }), ...(args.question && { asks: true as const }), ...(commit && { commit }), ...(render && { render }),
    }], 'agent');
    // A reply never conflicts; only an edit of a note changed since it was read does.
    if ('conflict' in applied) throw new Error(`#${id} changed while replying: run it again`);
    console.log(`replied to #${id}${args.addressed ? ', addressed' : ''}${args.question ? ', asking' : ''} (revision ${applied.file.revision})`);
  },
});
