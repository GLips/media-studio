// render-trace-report.ts: a render's trace as text (trace-summary.ts's tables), for deciding what to make faster: time
// by span name with self time, each chunk's startup step by step, and two renders side by side. `studio trace` prints it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { traceOfChromeTrace, type ChromeTrace } from '#lib/platform/trace/models/chrome-trace.ts';
import type { TraceSpan } from '#lib/platform/trace/models/trace-model.ts';
import {
  TRACE_MS_QUANTITIES, traceChunkStartups, traceQuantitiesByName, traceTimeByName, traceTimeByNameChange, type TraceChunkStartup, type TraceNameTime,
} from '#lib/platform/trace/models/trace-summary.ts';
import { renderHistoryFile, type RenderHistoryRecord } from './render-history.ts';

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

/** Each span name's ms quantities (GPU, encode, submit, readback wait, digest), in seconds; none when no span has one. */
function quantityLines(spans: readonly TraceSpan[], top: number): string[] {
  const rows = traceQuantitiesByName(spans);
  if (!rows.length) return [];
  return [
    '', 'GPU, encoding and waits by span name, s (gpu from timestamp queries, on --trace detail steps):',
    `${TRACE_MS_QUANTITIES.map((q) => q.padStart(14)).join('')}${'count'.padStart(7)}  name`,
    ...rows.slice(0, top).map((r) => `${r.ms.map((ms) => (ms / 1000).toFixed(3).padStart(14)).join('')}${String(r.count).padStart(7)}  ${r.name}${r.untimed ? ` (${r.untimed} untimed)` : ''}`),
    ...(rows.length > top ? [`  … ${rows.length - top} more names (--top)`] : []),
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

/**
 * The report on the trace `which` names (a trace file, or `latest`, `latest~N` from the render history), each table
 * cut to `top` names; with `against`, that trace as the before and `which` the after, biggest change first.
 */
export function renderTraceReportLines(which: string, { against, top }: { against?: string; top: number }): string[] {
  const after = readRenderTrace(which);
  if (against === undefined) {
    const lines = [renderHeading(after), '', 'time by span name:', ...nameTimeLines(traceTimeByName(after.spans), top), ...quantityLines(after.spans, top)];
    for (const startup of traceChunkStartups(after.spans)) lines.push('', ...startupLines(startup));
    return lines;
  }
  const before = readRenderTrace(against);
  return [
    `before: ${renderHeading(before)}`, `after:  ${renderHeading(after)}`, '',
    'self time by span name:', ...changeLines(traceTimeByName(before.spans), traceTimeByName(after.spans), top, 'name'), '',
    'startup steps, over every chunk:', ...changeLines(startupStepTimes(traceChunkStartups(before.spans)), startupStepTimes(traceChunkStartups(after.spans)), top, 'step'),
  ];
}
