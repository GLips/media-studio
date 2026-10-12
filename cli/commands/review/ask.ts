// studio review ask: a question the agent opens on its own, on frames of a render, a script line, a still or the
// whole project, which waits on the reviewer until they answer.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../../command-flags.ts';
import { studioProjectArg } from '../../project-arg.ts';

const reviewAskArgs = {
  project: studioProjectArg,
  text: { type: 'positional', required: true, description: 'The question, in markdown' },
  at: { type: 'string', valueHint: 'f120:140', description: 'On these frames of the render (one, or a first and last), on the render\'s own clock' },
  render: { type: 'string', valueHint: 'out/video.mp4', description: 'The render --at counts on; the newest full render by default' },
  line: { type: 'string', valueHint: 'intro:3', description: 'On a script line by its id, and optionally a word in it, counted from 0' },
  still: { type: 'string', valueHint: 'out/stills/og.png', description: 'On a still, by its path in the project' },
} as const satisfies ArgsDef;

/** `f120` or `f120:140` (the f optional) as a first frame and, for a range, its last. */
function framesFlagOf(value: string): { frame: number; end?: number } {
  const match = /^f?(\d+)(?::f?(\d+))?$/.exec(value.trim());
  const [frame, end] = [match?.[1], match?.[2]].map((n) => (n === undefined ? undefined : Number(n)));
  if (frame === undefined || (end !== undefined && end < frame)) throw new Error(`--at is a frame or a first and last frame, like f120 or f120:140, not ${value}`);
  return { frame, ...(end !== undefined && end !== frame && { end }) };
}

/** `intro` or `intro:3`: a line id, and a word of it. */
function lineFlagOf(value: string): { line: string; word?: number } {
  const [line, word] = value.split(':');
  if (!line || (word !== undefined && !/^\d+$/.test(word))) throw new Error(`--line is a line id and optionally a word, like intro or intro:3, not ${value}`);
  return { line, ...(word !== undefined && { word: Number(word) }) };
}

export const reviewAskCommand = defineCommand({
  meta: {
    name: 'ask',
    description: "Open a question to the reviewer on frames of a render, a script line, a still, or the project.",
    about: "It waits on the reviewer, marked in their page, until they reply; watch wakes on the answer. A question --at frames is carried to later renders by its moment like any note. To ask about an existing note, reply --question to it instead. Prints the question's id.",
  },
  args: reviewAskArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, reviewAskArgs);
    if ([args.at, args.line, args.still].filter((v) => v !== undefined).length > 1) throw new Error('a question is on one thing: give one of --at, --line and --still');
    if (args.render !== undefined && args.at === undefined) throw new Error('--render is the render --at counts frames on: give --at too');

    const { basename } = await import('node:path');
    const { resolveStudioProject } = await import('#lib/platform/project/engine/studio-project.ts');
    const { applyReviewOps } = await import('#lib/output/review/engine/review-file.ts');
    const handoffs = await import('#lib/output/review/engine/review-handoff.ts');
    const dir = resolveStudioProject(args.project), project = basename(dir);
    const placeOfFlags = (): Parameters<typeof handoffs.reviewAskAnchorOf>[1] => {
      if (args.at !== undefined) return { on: 'video', render: handoffs.reviewHandoffRenderOf(project, args.render), ...framesFlagOf(args.at) };
      if (args.line !== undefined) return { on: 'script', ...lineFlagOf(args.line) };
      return args.still === undefined ? { on: 'project' } : { on: 'still', still: args.still };
    };
    const anchor = handoffs.reviewAskAnchorOf(project, placeOfFlags());
    const applied = applyReviewOps(dir, [{ op: 'thread.add', kind: 'question', anchor, text: args.text }], 'agent');
    if ('conflict' in applied) throw new Error('a new question never conflicts');
    console.log(`asked #${applied.changed[0]} (revision ${applied.file.revision})`);
  },
});
