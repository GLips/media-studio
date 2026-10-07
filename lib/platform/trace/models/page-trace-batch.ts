// page-trace-batch.ts: how a render page's trace (studio/page-trace.ts) reaches Node: batches of records, each a console
// line behind PAGE_TRACE_PREFIX on the page-log channel (lib/platform/browser/models/render-page-log.ts). A trace line
// is never progress to the render's watch: a page could trace while stuck. Pure.
//
// A page's times are its own clock's, ms of `performance.now()`. Node puts them on its own once per page, through the
// two processes' `performance.timeOrigin`, both read from the machine's wall clock: the console is one-way, so there's no
// round trip to measure an offset by. The lag of the first batch, by the converted times, is recorded as the bound.
import type { TraceProducer, TraceRecord } from './trace-model.ts';

/** Marks a console line as a batch of a render page's trace, its JSON following. */
export const PAGE_TRACE_PREFIX = '[studio trace] ';

/** Records as a page writes them: TraceRecords whose times are ms on its own clock. */
export type PageTraceRecord = Exclude<TraceRecord, { record: 'producer' }>;

/**
 * One batch: the page's producer and clock origin (ms since the epoch), its place in the page's sequence, records the
 * page's bounded buffer dropped since the last, whether it's the page's last, when it was sent (page ms), its records.
 */
export type PageTraceBatch = {
  readonly producer: TraceProducer; readonly timeOrigin: number; readonly seq: number; readonly dropped: number;
  readonly final: boolean; readonly sentAt: number; readonly records: readonly PageTraceRecord[];
};

/** The batch console line `text` holds, or null when it holds none. */
export function pageTraceBatchOf(text: string): PageTraceBatch | null {
  if (!text.startsWith(PAGE_TRACE_PREFIX)) return null;
  // SAFETY: a line behind PAGE_TRACE_PREFIX is written only by page-trace.ts, from a PageTraceBatch.
  return JSON.parse(text.slice(PAGE_TRACE_PREFIX.length)) as PageTraceBatch;
}

/** The method page times are converted by, as a producer's clock records it. */
export const PAGE_TRACE_CLOCK_METHOD = 'performance.timeOrigin';

/**
 * `batch`'s records on a trace's clock, seconds since the Node process began at `nodeTimeOrigin` (ms since the epoch);
 * a span the page began at its top is put under `parent`.
 */
export function pageTraceRecordsOnClock(batch: PageTraceBatch, nodeTimeOrigin: number, parent: string | null): TraceRecord[] {
  const at = (pageMs: number) => pageTraceSeconds(batch.timeOrigin, pageMs, nodeTimeOrigin);
  return batch.records.map((r): TraceRecord => {
    if (r.record === 'begin') return { ...r, start: at(r.start), parent: r.parent ?? parent };
    if (r.record === 'end') return { ...r, end: at(r.end) };
    if (r.record === 'sample') return { ...r, at: at(r.at) };
    return r;
  });
}

/** Page time `pageMs`, on a clock begun at `pageTimeOrigin`, as seconds on Node's begun at `nodeTimeOrigin` (both epoch ms). */
export const pageTraceSeconds = (pageTimeOrigin: number, pageMs: number, nodeTimeOrigin: number) => (pageTimeOrigin + pageMs - nodeTimeOrigin) / 1000;
