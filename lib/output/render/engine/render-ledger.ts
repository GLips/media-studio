// render-ledger.ts: what a render command keeps of its project apart from any page: the project's clock and whether
// it's silent, read once, and the trace its work is timed in (lib/platform/trace/), which it reports at the end and the
// render history keeps (render-history.ts). A render session (render-session.ts) opens one and bundles; a command whose
// frames are drawn elsewhere (remote-render) opens only this, and never a browser.
import { readProjectDeclaration } from '#lib/platform/project/engine/studio-project.ts';
import { NODE_TRACE_PRODUCER, openTraceCollector, type TraceCollector, type TraceSpanHandle } from '#lib/platform/trace/engine/trace-collector.ts';
import type { TraceSpan } from '#lib/platform/trace/models/trace-model.ts';
import { readProjectClock } from './project-clock.ts';

/**
 * What a render span is to the report, by its `kind`: a wait for the GPU lease, never a render's own time; one attempt
 * at drawing a chunk of frames, in a browser of its own; or the packing of a chunk's frames, beside the next chunk.
 */
export const RENDER_SPAN_KINDS = { gpuWait: 'gpu-wait', chunk: 'chunk', packing: 'packing' } as const;

/** The producer a render command's own spans are recorded under, apart from its pages'. */
export const RENDER_TRACE_PRODUCER = NODE_TRACE_PRODUCER.id;

/** A wait for the GPU lease shorter than this is the lease's own bookkeeping, not a queue, and isn't recorded. */
const GPU_WAIT_RECORDED_SECONDS = 0.1;

export type RenderLedger = Awaited<ReturnType<typeof openRenderLedger>>;

/**
 * The ledger of a render command on `project`, timing its work in `trace` (one of its own, kept in memory, unless
 * given). Its clock is read now, so every snapshot the command writes holds the clock its renders were made on.
 */
export async function openRenderLedger(project: string, trace: TraceCollector = openTraceCollector()) {
  const clock = (await readProjectClock(project)) ?? null;
  const declaration = await readProjectDeclaration(project);
  // A silent video delivers with no mix and no audio track (render-pipeline.ts).
  const silent = declaration?.capability === 'silent', paints = Boolean(declaration?.styles?.length);

  const recordGpuWait = (waited: number, at: { start: number; parent: TraceSpanHandle | null }) => recordRenderGpuWait(trace, waited, at);
  return { project, clock, silent, paints, trace, recordGpuWait };
}

/** Records `waited` seconds for the GPU lease in `trace`, from `start`, under `parent`, when it queued. */
export function recordRenderGpuWait(trace: TraceCollector, waited: number, { start, parent, track }: { start: number; parent: TraceSpanHandle | null; track?: string }): void {
  if (waited >= GPU_WAIT_RECORDED_SECONDS) trace.record('waiting for the GPU', { start, end: start + waited, parent, ...(track && { track }), kind: RENDER_SPAN_KINDS.gpuWait });
}

/** Seconds the command waited for the GPU lease, over all its spans. */
export const renderGpuWaitSeconds = (spans: readonly TraceSpan[]) =>
  spans.filter((s) => s.kind === RENDER_SPAN_KINDS.gpuWait).reduce((sum, s) => sum + s.end - s.start, 0);
