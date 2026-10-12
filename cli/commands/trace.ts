// studio trace: a render's trace as text (lib/output/render/engine/render-trace-report.ts), for deciding what to make faster.
import { defineCommand } from 'citty';

export default defineCommand({
  meta: {
    name: 'trace',
    description: "Summarise a render's trace: time by span name and each chunk's startup, or two renders side by side.",
    about: "Reads a trace `studio render` or `studio profile` wrote. Lists time by span name, most self time (outside its children) first, and each chunk's startup, from the chunk's start to its first frame, step by step, with the solves its steps ran and the time no step covers. With --against, the two renders' self time by name and their startups' steps side by side, biggest change first.",
  },
  args: {
    trace: { type: 'positional', required: true, description: 'A trace file a render wrote, or latest (the newest render in the history), latest~1 the one before' },
    against: { type: 'string', valueHint: 'latest~1', description: 'Another trace to compare with: the before, the positional the after' },
    top: { type: 'string', default: '30', description: 'Names listed in each table' },
  },
  async run({ args }) {
    const top = Number(args.top);
    if (!(Number.isInteger(top) && top > 0)) throw new Error(`trace: --top is ${args.top}: give a whole number above 0`);
    const { renderTraceReportLines } = await import('#lib/output/render/engine/render-trace-report.ts');
    console.log(renderTraceReportLines(args.trace, { against: args.against, top }).join('\n'));
  },
});
