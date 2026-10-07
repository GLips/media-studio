// chrome-trace.ts: a trace (trace-model.ts) as Chrome's trace event JSON, which Perfetto (ui.perfetto.dev) opens. Each
// producer is a process; each of its tracks is a thread, split into lanes where its spans overlap without nesting, since
// a thread's slices must nest. Pure.
import type { Trace, TraceSpan } from './trace-model.ts';

/** A slice's arguments, as Perfetto lists them when it's selected. */
export type ChromeTraceArgs = Readonly<Record<string, string | number | null>>;

/**
 * One Chrome trace event, times in microseconds: metadata naming and ordering a process or thread (`M`), a slice
 * (`X`), a counter's value (`C`), or a flow's start and finish (`s`, `f`), bound to the slices they fall in.
 */
export type ChromeTraceEvent =
  | { readonly ph: 'M'; readonly name: 'process_name' | 'thread_name'; readonly pid: number; readonly tid?: number; readonly args: { readonly name: string } }
  | { readonly ph: 'M'; readonly name: 'process_sort_index' | 'thread_sort_index'; readonly pid: number; readonly tid?: number; readonly args: { readonly sort_index: number } }
  | { readonly ph: 'X'; readonly name: string; readonly cat: string; readonly pid: number; readonly tid: number; readonly ts: number; readonly dur: number; readonly args: ChromeTraceArgs }
  | { readonly ph: 'C'; readonly name: string; readonly pid: number; readonly ts: number; readonly args: { readonly value: number } }
  | { readonly ph: 's' | 'f'; readonly bp?: 'e'; readonly name: 'flow'; readonly cat: 'flow'; readonly id: number; readonly pid: number; readonly tid: number; readonly ts: number };

/** The JSON file Perfetto opens. */
export type ChromeTrace = { readonly traceEvents: readonly ChromeTraceEvent[]; readonly displayTimeUnit: 'ms' };

const microseconds = (seconds: number) => Math.round(seconds * 1e6);

/**
 * Lane per span of one track, lowest first: a span goes in the first lane whose open spans all contain it, so siblings
 * that overlap (a pass begun beside another) take lanes of their own and every lane nests.
 */
function traceLanes(spans: readonly TraceSpan[]): Map<TraceSpan, number> {
  const lanes: number[][] = [], laneOf = new Map<TraceSpan, number>();
  for (const span of spans.toSorted((a, b) => a.start - b.start || b.end - a.end)) {
    let lane = lanes.findIndex((open) => {
      while (open.length && open.at(-1)! <= span.start) open.pop();
      return !open.length || open.at(-1)! >= span.end;
    });
    if (lane < 0) lane = lanes.push([]) - 1;
    lanes[lane].push(span.end);
    laneOf.set(span, lane);
  }
  return laneOf;
}

/** `trace` as Chrome trace event JSON. */
export function encodeChromeTrace(trace: Trace): ChromeTrace {
  // A producer whose spans arrived without its record is labelled by its id.
  const producers = new Map(trace.spans.map((s) => [s.producer, s.producer]));
  for (const p of trace.producers) producers.set(p.id, p.name);
  const pidOf = new Map([...producers.keys()].map((id, i) => [id, i + 1]));
  const events: ChromeTraceEvent[] = [...producers.values()].flatMap((name, i) => [
    { ph: 'M', name: 'process_name', pid: i + 1, args: { name } },
    { ph: 'M', name: 'process_sort_index', pid: i + 1, args: { sort_index: i } },
  ]);
  const placed = new Map<string, { pid: number; tid: number; span: TraceSpan }>();
  let tid = 0;
  for (const [producer] of producers) {
    const ofProducer = trace.spans.filter((s) => s.producer === producer), pid = pidOf.get(producer)!;
    for (const track of new Set(ofProducer.toSorted((a, b) => a.start - b.start).map((s) => s.track))) {
      const laneOf = traceLanes(ofProducer.filter((s) => s.track === track)), firstTid = tid + 1;
      const laneCount = Math.max(...laneOf.values()) + 1;
      for (let lane = 0; lane < laneCount; lane++) {
        events.push({ ph: 'M', name: 'thread_name', pid, tid: firstTid + lane, args: { name: lane ? `${track} ${lane + 1}` : track } });
        events.push({ ph: 'M', name: 'thread_sort_index', pid, tid: firstTid + lane, args: { sort_index: firstTid + lane } });
      }
      tid += laneCount;
      for (const [span, lane] of laneOf) placed.set(span.id, { pid, tid: firstTid + lane, span });
    }
  }
  for (const { pid, tid: spanTid, span } of placed.values()) {
    const args: Record<string, string | number | null> = { id: span.id, parent: span.parent, status: span.status, ...(span.error !== undefined && { error: span.error }) };
    for (const [name, value] of Object.entries(span.attributes ?? {})) args[typeof value === 'string' ? name : `${name} (${value.unit})`] = typeof value === 'string' ? value : value.value;
    events.push({
      ph: 'X', name: span.status === 'ok' ? span.name : `${span.name} [${span.status}]`, cat: span.kind ?? 'span', pid, tid: spanTid,
      ts: microseconds(span.start), dur: microseconds(span.end) - microseconds(span.start), args,
    });
  }
  for (const sample of trace.samples) {
    events.push({ ph: 'C', name: `${sample.name} (${sample.unit})`, pid: pidOf.get(sample.producer) ?? 0, ts: microseconds(sample.at), args: { value: sample.value } });
  }
  // A flow's ends sit just inside its spans, so each binds to its own span and not one that ends or starts with it.
  for (const [i, { from, to }] of trace.flows.entries()) {
    const source = placed.get(from), target = placed.get(to);
    if (!source || !target) continue;
    const inside = (span: TraceSpan) => Math.min(1, (microseconds(span.end) - microseconds(span.start)) / 2);
    events.push({ ph: 's', name: 'flow', cat: 'flow', id: i + 1, pid: source.pid, tid: source.tid, ts: microseconds(source.span.end) - inside(source.span) });
    events.push({ ph: 'f', bp: 'e', name: 'flow', cat: 'flow', id: i + 1, pid: target.pid, tid: target.tid, ts: microseconds(target.span.start) + inside(target.span) });
  }
  return { traceEvents: events, displayTimeUnit: 'ms' };
}
