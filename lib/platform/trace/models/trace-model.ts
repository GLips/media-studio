// trace-model.ts: what a trace holds, and the records it is written as. A trace is the work of several producers (a Node
// process, each page it opens) on one clock, seconds since the Node process started: spans, counter samples of levels,
// and flows. A producer writes a record as work begins and another as it ends, so one that freezes or dies still shows
// where it was. Pure.
//
// Parentage is ownership (a chunk's startup is part of the chunk); a flow is causality (a chunk's frames, packed while
// the next chunk draws, are its own work but not part of it).

/** How a span ended: done, thrown out of, stopped before it finished, or never ended (its producer vanished). */
export const TRACE_SPAN_STATUSES = ['ok', 'failed', 'cancelled', 'incomplete'] as const;
export type TraceSpanStatus = (typeof TRACE_SPAN_STATUSES)[number];

/** An additive count a span carries, in a unit: frames drawn, bytes uploaded, solves, cache hits. */
export type TraceQuantity = { readonly value: number; readonly unit: string };

/** What a span says beyond its name, place and times: a label (the GPU it drew on) or a quantity. */
export type TraceAttributes = Readonly<Record<string, string | TraceQuantity>>;

/**
 * One stretch of work. `id`, minted at begin, is namespaced by its producer (`node:4`, `page-2:17`); `parent` owns it.
 * Work that overlaps its siblings (packing beside drawing) has a `track` of its own. A reader picks spans out by `kind`.
 */
export type TraceSpan = {
  readonly id: string; readonly producer: string; readonly parent: string | null; readonly name: string; readonly track: string;
  readonly start: number; readonly end: number; readonly status: TraceSpanStatus; readonly error?: string;
  readonly kind?: string; readonly attributes?: TraceAttributes;
};

/**
 * The kind of a span that marks a stretch of its parent measured over other work (a chunk's startup: its start to its
 * first frame) rather than work of its own: it owns nothing, so it has no self time.
 */
export const TRACE_WINDOW_KIND = 'window';

/** A level at a moment (bytes a cache holds), in `unit`, on its producer's counter `name`. */
export type TraceSample = { readonly producer: string; readonly name: string; readonly at: number; readonly value: number; readonly unit: string };

/** Span `from` caused span `to`. */
export type TraceFlow = { readonly from: string; readonly to: string };

/**
 * How a producer's times were put on the trace's clock: `method`, and `lagMs`, how long its first batch took to arrive
 * by the converted times, which bounds the conversion's error from above (a negative lag is an error that size).
 */
export type TraceProducerClock = { readonly method: string; readonly lagMs: number };

/** One producer of a trace: `id` namespaces its spans, `name` is how a viewer labels it (`node`, `page frames 0–299`). */
export type TraceProducer = { readonly id: string; readonly name: string; readonly clock?: TraceProducerClock };

/** A trace folded from its records. */
export type Trace = {
  readonly producers: readonly TraceProducer[]; readonly spans: readonly TraceSpan[];
  readonly samples: readonly TraceSample[]; readonly flows: readonly TraceFlow[];
};

/** What a span is begun with: what it knows from the start (its frame) in `attributes`, so even one never ended has it. */
export type TraceSpanBegin = Pick<TraceSpan, 'id' | 'producer' | 'parent' | 'name' | 'track' | 'start' | 'kind' | 'attributes'>;

/** What a span is ended with. */
export type TraceSpanEnd = Pick<TraceSpan, 'id' | 'end' | 'status' | 'error' | 'attributes'>;

/** One line of a trace as its producers write it, in the order they did. */
export type TraceRecord =
  | ({ readonly record: 'producer' } & TraceProducer)
  | ({ readonly record: 'begin' } & TraceSpanBegin)
  | ({ readonly record: 'end' } & TraceSpanEnd)
  | ({ readonly record: 'sample' } & TraceSample)
  | ({ readonly record: 'flow' } & TraceFlow);

/**
 * The trace `records` hold. A span begun and never ended is `incomplete`, ending at the last moment any record names;
 * an end with no begin is dropped, as is a second end of the same span.
 */
export function traceOfRecords(records: Iterable<TraceRecord>): Trace {
  const producers: TraceProducer[] = [], begun = new Map<string, TraceSpanBegin>(), spans: TraceSpan[] = [];
  const samples: TraceSample[] = [], flows: TraceFlow[] = [];
  let last = 0;
  for (const r of records) {
    if (r.record === 'producer') producers.push({ id: r.id, name: r.name, ...(r.clock && { clock: r.clock }) });
    else if (r.record === 'begin') {
      begun.set(r.id, r);
      last = Math.max(last, r.start);
    } else if (r.record === 'end') {
      const begin = begun.get(r.id);
      if (!begin) continue;
      begun.delete(r.id);
      spans.push(traceSpanOf(begin, r));
      last = Math.max(last, r.end);
    } else if (r.record === 'sample') {
      samples.push({ producer: r.producer, name: r.name, at: r.at, value: r.value, unit: r.unit });
      last = Math.max(last, r.at);
    } else flows.push({ from: r.from, to: r.to });
  }
  for (const begin of begun.values()) spans.push(traceSpanOf(begin, { id: begin.id, end: Math.max(last, begin.start), status: 'incomplete' }));
  return { producers, spans, samples, flows };
}

/** The span `begin` and `end` make. */
export function traceSpanOf(begin: TraceSpanBegin, end: TraceSpanEnd): TraceSpan {
  return {
    id: begin.id, producer: begin.producer, parent: begin.parent, name: begin.name, track: begin.track, start: begin.start, end: end.end, status: end.status,
    ...(end.error !== undefined && { error: end.error }), ...(begin.kind !== undefined && { kind: begin.kind }),
    ...((begin.attributes ?? end.attributes) && { attributes: { ...begin.attributes, ...end.attributes } }),
  };
}

/** A quantity's value on `span`, or undefined when it carries none by that name. */
export function traceQuantity(span: Pick<TraceSpan, 'attributes'>, name: string): number | undefined {
  const value = span.attributes?.[name];
  return typeof value === 'object' ? value.value : undefined;
}

/** A label on `span`, or undefined when it carries none by that name. */
export function traceLabel(span: Pick<TraceSpan, 'attributes'>, name: string): string | undefined {
  const value = span.attributes?.[name];
  return typeof value === 'string' ? value : undefined;
}
