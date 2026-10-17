// studio review ask: a question the agent opens on its own, on frames of a render, the plan (a scene, a line, a cell,
// a brief section, the left-out list, or words quoted in one), a still or the whole project, which waits on the
// reviewer until they answer.
import { defineCommand, type ArgsDef } from 'citty';
import { refuseUnknownCommandFlags } from '../../command-flags.ts';
import { studioProjectArg } from '../../project-arg.ts';

/** The cells of a scene's row a question can be on. */
const PLAN_CELLS = ['onScreen', 'motion', 'reads'] as const;

const reviewAskArgs = {
  project: studioProjectArg,
  text: { type: 'positional', required: true, description: 'The question, in markdown' },
  at: { type: 'string', valueHint: 'f120:140', description: 'On these frames of the render (one, or a first and last), on the render\'s own clock' },
  render: { type: 'string', valueHint: 'out/video.mp4', description: 'The render --at counts on; the newest full render by default' },
  scene: { type: 'string', valueHint: 'plate', description: "On a scene of the plan (storyboard.ts), by its id: its row, or with --cell one of its cells" },
  line: { type: 'string', valueHint: 'verdict', description: "On a line of the plan, by its id; its scene is found from the storyboard" },
  cell: { type: 'string', valueHint: 'motion', description: `On a cell of --scene's row: ${PLAN_CELLS.join(', ')}` },
  section: { type: 'string', valueHint: 'Pacing', description: "On a section of the plan's brief, by its heading" },
  'left-out': { type: 'boolean', description: "On the plan's left-out list" },
  quote: { type: 'string', valueHint: 'FODMAPs', description: 'Words the question is about, quoted from the line, cell, section or left-out item it is on' },
  still: { type: 'string', valueHint: 'out/stills/og.png', description: 'On a still, by its path in the project' },
} as const satisfies ArgsDef;

/** `f120` or `f120:140` (the f optional) as a first frame and, for a range, its last. */
function framesFlagOf(value: string): { frame: number; end?: number } {
  const match = /^f?(\d+)(?::f?(\d+))?$/.exec(value.trim());
  const [frame, end] = [match?.[1], match?.[2]].map((n) => (n === undefined ? undefined : Number(n)));
  if (frame === undefined || (end !== undefined && end < frame)) throw new Error(`--at is a frame or a first and last frame, like f120 or f120:140, not ${value}`);
  return { frame, ...(end !== undefined && end !== frame && { end }) };
}

type ReviewAskArgs = { scene?: string; line?: string; cell?: string; section?: string; 'left-out'?: boolean; quote?: string };

/** The plan place the flags name, or undefined when they name none: one of --line, --cell, --section, --left-out or a bare --scene. */
function planPlaceOf(args: ReviewAskArgs) {
  const named = [args.line !== undefined && '--line', args.cell !== undefined && '--cell', args.section !== undefined && '--section', args['left-out'] && '--left-out'].filter(Boolean);
  if (named.length > 1) throw new Error(`a plan question is on one thing: give one of ${named.join(', ')}`);
  if (args.cell !== undefined && args.scene === undefined) throw new Error('--cell is a cell of a scene: give --scene too');
  if ((args.section !== undefined || args['left-out']) && args.scene !== undefined) throw new Error('the brief and the left-out list belong to no scene: leave out --scene');
  const cell = args.cell === undefined ? undefined : PLAN_CELLS.find((c) => c === args.cell);
  if (args.cell !== undefined && !cell) throw new Error(`--cell is one of ${PLAN_CELLS.join(', ')}, not ${args.cell}`);
  // The most specific flag names the field: a line or a cell, else the brief, the left-out list or the bare scene.
  const field = [args.line !== undefined && 'line' as const, cell, args.section !== undefined && 'brief' as const, args['left-out'] && 'leftOut' as const, args.scene !== undefined && 'scene' as const]
    .find((f) => typeof f === 'string');
  if (field === undefined) {
    if (args.quote !== undefined) throw new Error('--quote quotes words from the plan: give the --line, --cell, --section or --left-out they are in');
    return undefined;
  }
  return { on: 'plan' as const, field, scene: args.scene, line: args.line, section: args.section, quote: args.quote };
}

export const reviewAskCommand = defineCommand({
  meta: {
    name: 'ask',
    description: "Open a question to the reviewer on frames of a render, the plan, a still, or the project.",
    about: "It waits on the reviewer, marked in their page, until they reply; watch wakes on the answer. A question --at frames is carried to later renders by its moment like any note. On the plan, it's on a scene (--scene), a line (--line), a cell of a scene (--scene with --cell), a brief section (--section) or the left-out list (--left-out), and --quote narrows it to words there; it's found again by those words after the plan is edited, and the scene, line and quote are checked against storyboard.ts now. To ask about an existing note, reply --question to it instead. Prints the question's id.",
  },
  args: reviewAskArgs,
  async run({ args, rawArgs }) {
    refuseUnknownCommandFlags(rawArgs, reviewAskArgs);
    const plan = planPlaceOf(args);
    if ([args.at, plan, args.still].filter((v) => v !== undefined).length > 1) throw new Error('a question is on one thing: give one of --at, the plan flags and --still');
    if (args.render !== undefined && args.at === undefined) throw new Error('--render is the render --at counts frames on: give --at too');

    const { basename } = await import('node:path');
    const { resolveStudioProject } = await import('#lib/platform/project/engine/studio-project.ts');
    const { applyReviewOps } = await import('#lib/output/review/engine/review-file.ts');
    const handoffs = await import('#lib/output/review/engine/review-handoff.ts');
    const dir = resolveStudioProject(args.project), project = basename(dir);
    const placeOfFlags = (): Parameters<typeof handoffs.reviewAskAnchorOf>[1] => {
      if (args.at !== undefined) {
        const render = handoffs.reviewHandoffRenderOf(project, args.render);
        if (render === undefined) throw new Error(`${project} has no full render for --at to count on: render one, or name a file with --render`);
        return { on: 'video', render, ...framesFlagOf(args.at) };
      }
      if (plan) return plan;
      return args.still === undefined ? { on: 'project' } : { on: 'still', still: args.still };
    };
    const anchor = await handoffs.reviewAskAnchorOf(project, placeOfFlags());
    const applied = applyReviewOps(dir, [{ op: 'thread.add', kind: 'question', anchor, text: args.text }], 'agent');
    if ('conflict' in applied) throw new Error('a new question never conflicts');
    console.log(`asked #${applied.changed[0]} (revision ${applied.file.revision})`);
  },
});
