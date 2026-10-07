// node harness/trace.ts <trace|latest> [--against <trace|latest~1>] (npm run trace -- …): a render's trace as text
// (lib/platform/trace/models/trace-summary.ts), for deciding what to make faster: time by span name with self time,
// each chunk's startup step by step, and with --against, each name's time in two renders side by side. A trace is a
// file `studio render` wrote (render-traces/), or `latest` for the newest render in the history, `latest~1` the one
// before it.
import { defineCommand } from 'citty';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHistoryFile, type RenderHistoryRecord } from '#lib/output/render/engine/render-history.ts';
import { traceOfChromeTrace, type ChromeTrace } from '#lib/platform/trace/models/chrome-trace.ts';
import { traceChunkStartups, traceTimeByName, traceTimeByNameChange, type TraceChunkStartup, type TraceNameTime } from '#lib/platform/trace/models/trace-summary.ts';
import type { TraceSpan } from '#lib/platform/trace/models/trace-model.ts';
import { runHarnessCommand } from './run-harness-command.ts';

/** The trace `which` names, and the history line it was written with, when it's found there. */
function readRenderTrace(which: string): { file: string; spans: readonly TraceSpan[]; render: RenderHistoryRecord | null } {
  // SAFETY: every history line is a RenderHistoryRecord; one from before traces has no `trace`, which is checked.
  const history = readFileSync(renderHistoryFile(), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as RenderHistoryRecord);
  const back = /^latest(?:~(\d+))?$/.exec(which);
  const render = back ? history.at(-1 - Number(back[1] ?? 0)) : history.findLast((r) => r.trace === resolve(which));
  if (back && !render) throw new Error(`trace: the history (${renderHistoryFile()}) has no render ${which}`);
  const file = back ? render!.trace : resolve(which);
  if (!file) throw new Error(`trace: the render ${which} (${render!.args.join(' ')}) wrote no trace`);
  // SAFETY: a render trace is written by encodeChromeTrace (lib/platform/trace/engine/trace-files.ts).
  const { spans } = traceOfChromeTrace(JSON.parse(readFileSync(file, 'utf8')) as ChromeTrace);
  return { file, spans, render: render ?? null };
}

const s = (seconds: number) => seconds.toFixed(2).padStart(8);

/** A render as a heading names it. */
function renderHeading({ file, render }: ReturnType<typeof readRenderTrace>): string {
  return render ? `${file}\n  studio ${render.args.join(' ')} · ${render.at} · ${render.seconds.toFixed(1)} s${render.ok ? '' : ` · failed: ${render.error}`}` : file;
}

function nameTimeLines(times: readonly TraceNameTime[], top: number): string[] {
  return [
    `${'self s'.padStart(8)}${'total s'.padStart(8)}${'max s'.padStart(8)}${'count'.padStart(7)}  name`,
    ...times.slice(0, top).map((t) => `${s(t.selfSeconds)}${s(t.seconds)}${s(t.maxSeconds)}${String(t.count).padStart(7)}  ${t.name}`),
    ...(times.length > top ? [`  … ${times.length - top} more names (--top)`] : []),
  ];
}

function startupLines(startup: TraceChunkStartup): string[] {
  return [
    `startup of ${startup.chunk}: ${startup.seconds.toFixed(2)} s`,
    `${'at s'.padStart(8)}${'took s'.padStart(8)}  step`,
    ...startup.phases.map((p) => `${s(p.at)}${s(p.seconds)}  ${'  '.repeat(p.depth)}${p.name}${p.status === 'ok' ? '' : ` (${p.status})`}`),
    ...startup.solves.map((v) => `  ${v.count} solves under ${v.under}, ${v.seconds.toFixed(2)} s; longest ${v.longest.map((l) => `${l.name} ${l.seconds.toFixed(2)} s`).join(', ')}`),
    `  no step: ${startup.unexplained.toFixed(2)} s`,
  ];
}

/** Each startup step's seconds over every chunk, by name, for comparing two renders that chunk alike or not. */
function startupStepTimes(startups: readonly TraceChunkStartup[]): TraceNameTime[] {
  const byName = new Map<string, number>();
  for (const { phases, unexplained, seconds } of startups) {
    for (const p of phases.filter((x) => x.depth === 0)) byName.set(p.name, (byName.get(p.name) ?? 0) + p.seconds);
    byName.set('(no step)', (byName.get('(no step)') ?? 0) + unexplained);
    byName.set('(whole startup)', (byName.get('(whole startup)') ?? 0) + seconds);
  }
  return [...byName].map(([name, total]) => ({ name, count: 1, seconds: total, selfSeconds: total, maxSeconds: total }));
}

function changeLines(before: readonly TraceNameTime[], after: readonly TraceNameTime[], top: number, what: string): string[] {
  const changes = traceTimeByNameChange(before, after);
  return [
    `${'before'.padStart(8)}${'after'.padStart(8)}${'change'.padStart(8)}  ${what}`,
    ...changes.slice(0, top).map((c) => `${s(c.before?.selfSeconds ?? 0)}${s(c.after?.selfSeconds ?? 0)}${`${c.selfChange < 0 ? '-' : '+'}${Math.abs(c.selfChange).toFixed(2)}`.padStart(8)}  ${c.name}`),
    ...(changes.length > top ? [`  … ${changes.length - top} more names (--top)`] : []),
  ];
}

const traceCommand = defineCommand({
  meta: {
    name: 'trace',
    description: "A render's trace as text: time by span name, most self time (outside its children) first; each chunk's startup, from the chunk's start to its first frame, step by step, with the solves its steps ran and the time no step covers. With --against, the two renders' self time by name and their startups' steps side by side, biggest change first.",
  },
  args: {
    trace: { type: 'positional', required: true, description: 'A trace file studio render wrote, or latest (the newest render in the history), latest~1 the one before' },
    against: { type: 'string', valueHint: 'latest~1', description: 'Another trace to compare with: the before, the positional the after' },
    top: { type: 'string', valueHint: '30', description: 'Names listed in each table (30)' },
  },
  run({ args }) {
    const top = args.top === undefined ? 30 : Number(args.top);
    if (!(Number.isInteger(top) && top > 0)) throw new Error(`trace: --top is ${args.top}: give a whole number above 0`);
    const after = readRenderTrace(args.trace);
    if (args.against === undefined) {
      const lines = [renderHeading(after), '', 'time by span name:', ...nameTimeLines(traceTimeByName(after.spans), top)];
      for (const startup of traceChunkStartups(after.spans)) lines.push('', ...startupLines(startup));
      console.log(lines.join('\n'));
      return;
    }
    const before = readRenderTrace(args.against);
    console.log([
      `before: ${renderHeading(before)}`, `after:  ${renderHeading(after)}`, '',
      'self time by span name:', ...changeLines(traceTimeByName(before.spans), traceTimeByName(after.spans), top, 'name'), '',
      'startup steps, over every chunk:', ...changeLines(startupStepTimes(traceChunkStartups(before.spans)), startupStepTimes(traceChunkStartups(after.spans)), top, 'step'),
    ].join('\n'));
  },
});

await runHarnessCommand(traceCommand, 'interactive');
