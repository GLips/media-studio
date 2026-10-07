// page-trace-intake.ts: the batches a render's pages send (models/page-trace-batch.ts) taken into its Node trace, each
// page a producer named by the work it was opened for, its times on Node's clock, its top spans under the span that
// opened it. A page's records it dropped and the batches that never arrived are sampled on its producer. Node only.
import { PAGE_TRACE_CLOCK_METHOD, pageTraceRecordsOnClock, pageTraceSeconds, type PageTraceBatch } from '../models/page-trace-batch.ts';
import { traceClock, type TraceCollector } from './trace-collector.ts';

/** Where a browser's pages trace into: `trace`, under span `parent`, each page named after `name`. */
export type PageTraceIntakeTarget = { readonly trace: TraceCollector; readonly parent: string; readonly name: string };

/** Takes each batch of the pages of one browser into `target`. */
export function createPageTraceIntake({ trace, parent, name }: PageTraceIntakeTarget): (batch: PageTraceBatch) => void {
  const seen = new Map<string, { next: number }>();
  return (batch) => {
    const { producer } = batch;
    let page = seen.get(producer.id);
    if (!page) {
      page = { next: 0 };
      seen.set(producer.id, page);
      const lagMs = (traceClock() - pageTraceSeconds(batch.timeOrigin, batch.sentAt, performance.timeOrigin)) * 1000;
      trace.accept([{ record: 'producer', id: producer.id, name: `${name}: ${producer.name} ${seen.size}`, clock: { method: PAGE_TRACE_CLOCK_METHOD, lagMs } }]);
    }
    const lost = batch.seq - page.next;
    page.next = batch.seq + 1;
    trace.accept(pageTraceRecordsOnClock(batch, performance.timeOrigin, parent));
    const at = pageTraceSeconds(batch.timeOrigin, batch.sentAt, performance.timeOrigin);
    if (batch.dropped) trace.accept([{ record: 'sample', producer: producer.id, name: 'trace records dropped', at, value: batch.dropped, unit: 'records' }]);
    if (lost > 0) trace.accept([{ record: 'sample', producer: producer.id, name: 'trace batches lost', at, value: lost, unit: 'batches' }]);
  };
}
