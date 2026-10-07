// trace-collector.ts: a Node process's trace, recorded as its work happens (trace-model.ts), and the records any other
// producer sends it, each passed to a sink as it arrives (a trace file, trace-files.ts) and kept to be read back. Spans
// are begun and ended through handles: a parent is a handle passed explicitly, never a current span, since async work
// interleaves. Node only.
import { traceOfRecords, type Trace, type TraceAttributes, type TraceProducer, type TraceRecord, type TraceSpanStatus } from '../models/trace-model.ts';

/** The Node process's clock as a trace's: seconds since the process started. */
export const traceClock = (now = performance.now()) => now / 1000;

/** A span begun and not yet ended. Its first end, fail or cancel records it; any after are ignored. */
export type TraceSpanHandle = {
  readonly id: string;
  readonly end: (attributes?: TraceAttributes) => void;
  readonly fail: (error: Error, attributes?: TraceAttributes) => void;
  readonly cancel: (attributes?: TraceAttributes) => void;
};

/** Where a span sits: under `parent` (null: at the top), on `track` (`main` unless given), picked out by `kind`. */
export type TraceSpanPlace = { readonly parent?: TraceSpanHandle | string | null; readonly track?: string; readonly kind?: string };

export type TraceCollector = ReturnType<typeof openTraceCollector>;

/** The id of a span named by its handle or id. */
const traceSpanId = (span: TraceSpanHandle | string) => (typeof span === 'string' ? span : span.id);
const parentId = (parent: TraceSpanPlace['parent']) => (parent ? traceSpanId(parent) : null);

/** The Node process a collector records for, unless told another. */
export const NODE_TRACE_PRODUCER: TraceProducer = { id: 'node', name: 'node' };

/** A trace recorded by `producer`, each record handed to `sink` as it is made or accepted. */
export function openTraceCollector({ producer = NODE_TRACE_PRODUCER, sink }: { producer?: TraceProducer; sink?: (record: TraceRecord) => void } = {}) {
  const records: TraceRecord[] = [];
  let nextId = 0;
  const keep = (line: TraceRecord) => {
    records.push(line);
    sink?.(line);
  };
  keep({ record: 'producer', ...producer });

  /** Begins span `name` now, where `place` says. */
  function begin(name: string, { parent = null, track = 'main', kind }: TraceSpanPlace = {}): TraceSpanHandle {
    const id = `${producer.id}:${nextId++}`;
    keep({ record: 'begin', id, producer: producer.id, parent: parentId(parent), name, track, start: traceClock(), ...(kind !== undefined && { kind }) });
    let ended = false;
    const close = (status: TraceSpanStatus, attributes?: TraceAttributes, error?: string) => {
      if (ended) return;
      ended = true;
      keep({ record: 'end', id, end: traceClock(), status, ...(error !== undefined && { error }), ...(attributes && { attributes }) });
    };
    return { id, end: (attributes) => close('ok', attributes), fail: (error, attributes) => close('failed', attributes, error.message.split('\n')[0]), cancel: (attributes) => close('cancelled', attributes) };
  }

  /** Runs `work` as span `name`, handing it the span for its children; a throw fails the span and passes on. */
  async function run<T>(name: string, work: (span: TraceSpanHandle) => Promise<T> | T, { attributes, ...place }: TraceSpanPlace & { attributes?: TraceAttributes } = {}): Promise<T> {
    const span = begin(name, place);
    try {
      const result = await work(span);
      span.end(attributes);
      return result;
    } catch (error) {
      span.fail(error instanceof Error ? error : new Error(String(error)), attributes);
      throw error;
    }
  }

  /** Records span `name` from `start` to `end` (traceClock's seconds) after the fact. Returns its id. */
  function record(name: string, { start, end, status = 'ok', attributes, parent = null, track = 'main', kind }: TraceSpanPlace & {
    start: number; end: number; status?: TraceSpanStatus; attributes?: TraceAttributes;
  }): string {
    const id = `${producer.id}:${nextId++}`;
    keep({ record: 'begin', id, producer: producer.id, parent: parentId(parent), name, track, start, ...(kind !== undefined && { kind }) });
    keep({ record: 'end', id, end, status, ...(attributes && { attributes }) });
    return id;
  }

  /** Records that span `from` caused span `to`. */
  const flow = (from: TraceSpanHandle | string, to: TraceSpanHandle | string) => keep({ record: 'flow', from: traceSpanId(from), to: traceSpanId(to) });

  /** Records level `value` in `unit` on counter `name`, now. */
  const sample = (name: string, value: number, unit: string) => keep({ record: 'sample', producer: producer.id, name, at: traceClock(), value, unit });

  /** Takes records another producer made, already on this trace's clock. */
  const accept = (from: Iterable<TraceRecord>) => { for (const r of from) keep(r); };

  /** The trace so far, its open spans `incomplete`. */
  const trace = (): Trace => traceOfRecords(records);

  return { begin, run, record, flow, sample, accept, trace };
}
