// page-trace.ts: a render page's trace recorder. Drawing code begins spans through it, adds counts to them and ends
// them; it batches the records and sends each batch to Node (models/page-trace-batch.ts) by the page's log channel
// (platform/browser's render-page-log, handed in, as browser's Node side imports trace), which puts them on the
// render's trace. It's the one place a page's drawing code reaches a clock, which lint/structural/checks/
// frame-determinism.ts allows by name: no call returns a time, so nothing a frame shows can depend on one.
//
// Batches go every PAGE_TRACE_FLUSH_MS while records wait, at PAGE_TRACE_BATCH_RECORDS, on `sent`, and as the page
// hides. The buffer is bounded: past PAGE_TRACE_MAX_BUFFERED, records are dropped and counted in the next batch.
import { PAGE_TRACE_PREFIX, type PageTraceBatch, type PageTraceRecord } from '../models/page-trace-batch.ts';
import type { TraceAttributes, TraceQuantity } from '../models/trace-model.ts';

const PAGE_TRACE_FLUSH_MS = 250;
const PAGE_TRACE_BATCH_RECORDS = 500;
const PAGE_TRACE_MAX_BUFFERED = 20_000;

/** Where a span is begun: what it's picked out by, the track it's drawn on, and what it knows from the start. */
export type PageTraceBegin = { readonly kind?: string; readonly track?: string; readonly attributes?: TraceAttributes };

/** A span begun on a page. Its first end or fail records it; any after are ignored. */
export type PageTraceSpan = {
  /** Begins a span under this one. */
  readonly begin: (name: string, options?: PageTraceBegin) => PageTraceSpan;
  /** Adds `value` in `unit` to the span's quantity `name`. */
  readonly add: (name: string, value: number, unit: string) => void;
  /** Starts timing a wait; what's returned stops it, adding its ms to the span's quantity `name`. */
  readonly time: (name: string) => () => void;
  readonly end: (attributes?: TraceAttributes) => void;
  readonly fail: (error: Error, attributes?: TraceAttributes) => void;
};

/** A page's trace: a span begun at its top (Node puts it under the chunk drawing the page), and a level sampled now. */
export type PageTrace = {
  readonly begin: (name: string, options?: PageTraceBegin) => PageTraceSpan;
  readonly sample: (name: string, value: number, unit: string) => void;
  /**
   * Sends what's waiting, resolving once it's logged. Awaited before work that may freeze the page, so the span begun
   * for that work reaches Node first.
   */
  readonly sent: () => Promise<void>;
};

const NO_SPAN: PageTraceSpan = { begin: () => NO_SPAN, add: () => {}, time: () => () => {}, end: () => {}, fail: () => {} };

/** The trace outside a render (the Studio's preview, a test): records nothing. */
export const NO_PAGE_TRACE: PageTrace = { begin: () => NO_SPAN, sample: () => {}, sent: () => Promise.resolve() };

let pageTrace: PageTrace | null = null;

/** How a line reaches the render's Node side: behind `prefix`, `text`. */
export type PageTraceSend = (prefix: string, text: string) => void;

/** This render page's trace, made on first use to `send` its batches, its one producer for every frame and tab-wide work. */
export function renderPageTrace(send: PageTraceSend): PageTrace {
  pageTrace ??= createRenderPageTrace(send);
  return pageTrace;
}

function createRenderPageTrace(send: PageTraceSend): PageTrace {
  const producer = { id: `page-${crypto.randomUUID().slice(0, 8)}`, name: 'page' };
  let buffer: PageTraceRecord[] = [], dropped = 0, seq = 0, nextId = 0, timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (final = false) => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!buffer.length && !dropped && !final) return;
    const batch: PageTraceBatch = { producer, timeOrigin: performance.timeOrigin, seq: seq++, dropped, final, sentAt: performance.now(), records: buffer };
    buffer = [];
    dropped = 0;
    send(PAGE_TRACE_PREFIX, JSON.stringify(batch));
  };
  const keep = (record: PageTraceRecord) => {
    if (buffer.length >= PAGE_TRACE_MAX_BUFFERED) {
      dropped++;
      return;
    }
    buffer.push(record);
    if (buffer.length >= PAGE_TRACE_BATCH_RECORDS) flush();
    else timer ??= setTimeout(flush, PAGE_TRACE_FLUSH_MS);
  };

  const begin = (name: string, parent: string | null, { kind, track = 'main', attributes }: PageTraceBegin = {}): PageTraceSpan => {
    const id = `${producer.id}:${nextId++}`, quantities = new Map<string, TraceQuantity>();
    keep({ record: 'begin', id, producer: producer.id, parent, name, track, start: performance.now(), ...(kind !== undefined && { kind }), ...(attributes && { attributes }) });
    let ended = false;
    const add = (quantity: string, value: number, unit: string) => quantities.set(quantity, { value: (quantities.get(quantity)?.value ?? 0) + value, unit });
    const close = (status: 'ok' | 'failed', given?: TraceAttributes, error?: string) => {
      if (ended) return;
      ended = true;
      const all = { ...Object.fromEntries(quantities), ...given };
      keep({ record: 'end', id, end: performance.now(), status, ...(error !== undefined && { error }), ...(Object.keys(all).length && { attributes: all }) });
    };
    return {
      begin: (child, options) => begin(child, id, options),
      add,
      time: (quantity) => {
        const from = performance.now();
        return () => add(quantity, performance.now() - from, 'ms');
      },
      end: (given) => close('ok', given),
      fail: (error, given) => close('failed', given, error.message.split('\n')[0]),
    };
  };

  /** Records a top-level span of the page's own start, from `start` to `end` (page ms), after the fact. */
  const recordStart = (name: string, start: number, end: number) => {
    const id = `${producer.id}:${nextId++}`;
    keep({ record: 'begin', id, producer: producer.id, parent: null, name, track: 'main', start, kind: 'page-start' });
    keep({ record: 'end', id, end, status: 'ok' });
  };
  // How the page came to be traced: its navigation, from its time origin, then its scripts up to this trace's first use.
  const [navigation] = performance.getEntriesByType('navigation');
  if (navigation instanceof PerformanceNavigationTiming) {
    recordStart('navigation', 0, navigation.responseEnd);
    recordStart('page scripts', navigation.responseEnd, performance.now());
  }
  addEventListener('pagehide', () => flush(true));

  return {
    begin: (name, options) => begin(name, null, options),
    sample: (name, value, unit) => keep({ record: 'sample', producer: producer.id, name, at: performance.now(), value, unit }),
    sent: () => {
      flush();
      // The page's log channel logs in a microtask, queued before this one resolves.
      return Promise.resolve();
    },
  };
}
