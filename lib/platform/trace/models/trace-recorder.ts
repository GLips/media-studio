// trace-recorder.ts: a span as code that's traced holds it, whoever records it (a render page's recorder,
// studio/page-trace.ts): begun under another, added to, ended. Code below the studio role (a painting's models, the
// sheet solver) takes one of these, or null when nothing is traced, and never sees a clock: the recorder reads it.
import type { TraceAttributes } from './trace-model.ts';

/** Where a span is begun: what it's picked out by, the track it's drawn on, and what it knows from the start. */
export type TraceRecorderBegin = { readonly kind?: string; readonly track?: string; readonly attributes?: TraceAttributes };

/** A span being recorded. Its first end or fail records it; any after are ignored. */
export type TraceRecorderSpan = {
  /** Begins a span under this one. */
  readonly begin: (name: string, options?: TraceRecorderBegin) => TraceRecorderSpan;
  /** Adds `value` in `unit` to the span's quantity `name`. */
  readonly add: (name: string, value: number, unit: string) => void;
  /** Starts timing a wait; what's returned stops it, adding its ms to the span's quantity `name`. */
  readonly time: (name: string) => () => void;
  readonly end: (attributes?: TraceAttributes) => void;
  readonly fail: (error: Error, attributes?: TraceAttributes) => void;
  /** Gives the span `attributes` learned later, ended or not (TraceSpanNote): what the GPU took for its work. */
  readonly note: (attributes: TraceAttributes) => void;
};

/**
 * Spans nested as work runs, from `root` (null traces nothing): `within` runs work as a span under the one open now,
 * which is `current` while it runs.
 *
 * Warning: for work that runs one task at a time (a solve under its device's lease). Two awaited at once would each
 * take the other's span as their parent.
 */
export function traceNesting(root: TraceRecorderSpan | null) {
  let current = root;
  return {
    current: () => current,
    async within<T>(name: string, work: () => Promise<T>, options?: TraceRecorderBegin): Promise<T> {
      const outer = current, span = outer?.begin(name, options);
      if (!span) return work();
      current = span;
      try {
        const result = await work();
        span.end();
        return result;
      } catch (error) {
        span.fail(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        current = outer;
      }
    },
  };
}

export type TraceNesting = ReturnType<typeof traceNesting>;

/** Nesting that traces nothing: work outside a traced solve, or under a maker that traces none. */
export const UNTRACED_NESTING: TraceNesting = traceNesting(null);
