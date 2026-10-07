// trace-summary.ts: a trace read as text, for deciding what to make faster: time by span name with each span's self
// time (its own, outside its children), what each chunk's startup was spent on, and the same of two traces side by
// side. Chunks, startups and first draws are found by the names and kinds the render gives them
// (lib/output/render/engine/render-ledger.ts, render-chunks.ts), which this reads as plain strings. Pure.
import { TRACE_WINDOW_KIND, type TraceSpan } from './trace-model.ts';

/** Time spent in spans of one name: how many, their seconds, their self seconds, the longest. */
export type TraceNameTime = { readonly name: string; readonly count: number; readonly seconds: number; readonly selfSeconds: number; readonly maxSeconds: number };

/** A span's name with its numbers as `#`, so a chunk's or a frame's spans group under one name. */
export const traceGroupName = (name: string) => name.replace(/\d+(\.\d+)?/g, '#');

/** Seconds covered by `intervals`, overlaps counted once. */
function coveredSeconds(intervals: readonly (readonly [number, number])[]): number {
  let covered = 0, reach = -Infinity;
  for (const [start, end] of intervals.toSorted((a, b) => a[0] - b[0])) {
    if (end <= reach) continue;
    covered += end - Math.max(start, reach);
    reach = end;
  }
  return covered;
}

/** Each span's children, by its id. */
function traceChildren(spans: readonly TraceSpan[]): ReadonlyMap<string, readonly TraceSpan[]> {
  const children = new Map<string, TraceSpan[]>();
  for (const span of spans) if (span.parent !== null) children.set(span.parent, [...(children.get(span.parent) ?? []), span]);
  return children;
}

/** `span`'s seconds outside its `children`, each clipped to it; none for a window. */
const selfSeconds = (span: TraceSpan, children: readonly TraceSpan[]) => (span.kind === TRACE_WINDOW_KIND ? 0 : span.end - span.start - coveredSeconds(children.map((c) => [Math.max(c.start, span.start), Math.min(c.end, span.end)] as const).filter(([s, e]) => e > s)));

/** Time by span name (traceGroupName), most self time first. */
export function traceTimeByName(spans: readonly TraceSpan[]): TraceNameTime[] {
  const children = traceChildren(spans), byName = new Map<string, TraceNameTime>();
  for (const span of spans) {
    const name = traceGroupName(span.name), seconds = span.end - span.start, was = byName.get(name) ?? { name, count: 0, seconds: 0, selfSeconds: 0, maxSeconds: 0 };
    byName.set(name, {
      name, count: was.count + 1, seconds: was.seconds + seconds, selfSeconds: was.selfSeconds + selfSeconds(span, children.get(span.id) ?? []), maxSeconds: Math.max(was.maxSeconds, seconds),
    });
  }
  return [...byName.values()].toSorted((a, b) => b.selfSeconds - a.selfSeconds);
}

/** One step of a chunk's startup: when it began after the chunk did, how long it took, how deep it lies under the chunk. */
export type TraceStartupPhase = { readonly name: string; readonly at: number; readonly seconds: number; readonly depth: number; readonly status: TraceSpan['status'] };

/** The solves a startup phase ran: how many, their seconds, and the longest few. */
export type TraceStartupSolves = { readonly under: string; readonly count: number; readonly seconds: number; readonly longest: readonly { readonly name: string; readonly seconds: number }[] };

/**
 * One chunk's startup, from the chunk's start to its first frame: each step in it, the solves its steps ran, and the
 * seconds no step covers.
 */
export type TraceChunkStartup = {
  readonly chunk: string; readonly seconds: number; readonly phases: readonly TraceStartupPhase[];
  readonly solves: readonly TraceStartupSolves[]; readonly unexplained: number;
};

const STARTUP_SOLVES_LISTED = 5;

/** What each chunk's startup was spent on, chunk by chunk in order. */
export function traceChunkStartups(spans: readonly TraceSpan[]): TraceChunkStartup[] {
  const children = traceChildren(spans);
  return spans.filter((s) => s.kind === 'chunk').toSorted((a, b) => a.start - b.start).flatMap((chunk) => {
    const startup = (children.get(chunk.id) ?? []).find((s) => s.name === 'startup');
    if (!startup) return [];
    const until = startup.end, phases: TraceStartupPhase[] = [], solves: TraceStartupSolves[] = [];
    const walk = (span: TraceSpan, depth: number) => {
      const under = (children.get(span.id) ?? []).filter((s) => s.start < until).toSorted((a, b) => a.start - b.start);
      const solved = under.filter((s) => s.kind === 'solve');
      if (solved.length) {
        solves.push({
          under: span.name, count: solved.length, seconds: coveredSeconds(solved.map((s) => [s.start, s.end])),
          longest: solved.toSorted((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, STARTUP_SOLVES_LISTED).map((s) => ({ name: s.name, seconds: s.end - s.start })),
        });
      }
      // The startup span is the window itself, not a step in it.
      for (const child of under.filter((s) => s.kind !== 'solve' && s !== startup)) {
        phases.push({ name: child.name, at: child.start - chunk.start, seconds: child.end - child.start, depth, status: child.status });
        walk(child, depth + 1);
      }
    };
    walk(chunk, 0);
    const direct = (children.get(chunk.id) ?? []).filter((s) => s !== startup && s.start < until);
    const covered = coveredSeconds(direct.map((s) => [Math.max(s.start, chunk.start), Math.min(s.end, until)] as const).filter(([s, e]) => e > s));
    return [{ chunk: chunk.name, seconds: until - chunk.start, phases, solves, unexplained: until - chunk.start - covered }];
  });
}

/** One name's time in two traces, `before` and `after`, in seconds (0 where it ran in only one). */
export type TraceNameTimeChange = { readonly name: string; readonly before: TraceNameTime | null; readonly after: TraceNameTime | null; readonly selfChange: number };

/** Each name's time in `before` against `after`, the biggest change in self time first. */
export function traceTimeByNameChange(before: readonly TraceNameTime[], after: readonly TraceNameTime[]): TraceNameTimeChange[] {
  const names = new Set([...before, ...after].map((t) => t.name));
  return [...names].map((name) => {
    const was = before.find((t) => t.name === name) ?? null, now = after.find((t) => t.name === name) ?? null;
    return { name, before: was, after: now, selfChange: (now?.selfSeconds ?? 0) - (was?.selfSeconds ?? 0) };
  }).toSorted((a, b) => Math.abs(b.selfChange) - Math.abs(a.selfChange));
}
