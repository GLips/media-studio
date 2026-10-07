// render-ledger.ts: what a render command keeps of its project apart from any page: the project's clock and whether
// it's silent, read once, and the timed spans it reports at the end and keeps in the render history
// (render-history.ts). A render session (render-session.ts) opens one and bundles; a command whose frames are drawn
// elsewhere (remote-render) opens only this, and never a browser.
import { readProjectDeclaration } from '#lib/platform/project/engine/studio-project.ts';
import { readProjectClock } from './project-clock.ts';

/**
 * One timed stretch of a render command, in seconds since its process started, under the span `parent` names. Spans
 * overlap: a chunk's packing runs while the next chunk draws. `workers` and `gpu` where it rendered frames; `frames`
 * and `msPerFrame` where it drew them steadily (a chunk's drawing, past its first frame).
 */
export type RenderSpan = {
  readonly id: number; readonly parent: number | null; readonly name: string; readonly start: number; readonly end: number;
  readonly kind?: RenderSpanKind; readonly workers?: number; readonly gpu?: string; readonly frames?: number; readonly msPerFrame?: number;
};

/** A span the report reads by what it is: a wait for the GPU lease, never a render's own time, or one chunk's draw. */
export type RenderSpanKind = 'gpu-wait' | 'chunk';

/** What a span says beyond its name, place and times. */
export type RenderSpanDetail = Omit<RenderSpan, 'id' | 'parent' | 'name' | 'start' | 'end'>;

/** A span begun and not yet ended: its `id`, for its children's `parent`, and `end`, which records it. */
export type OpenRenderSpan = { readonly id: number; readonly end: (detail?: RenderSpanDetail) => void };

/** What records spans: a ledger, or anything a ledger is handed to. */
export type RenderSpanRecorder = Pick<RenderLedger, 'beginSpan' | 'addSpan' | 'timed' | 'recordGpuWait'>;

/** A wait for the GPU lease shorter than this is the lease's own bookkeeping, not a queue, and isn't recorded. */
const GPU_WAIT_RECORDED_SECONDS = 0.1;

/** `performance.now()` as a span's time: seconds since the process started, so a span can be placed in the whole command. */
export const renderSpanClock = (now = performance.now()) => now / 1000;

export type RenderLedger = Awaited<ReturnType<typeof openRenderLedger>>;

/**
 * The ledger of a render command on `project`. Its clock is read now, so every snapshot the command writes holds the
 * clock its renders were made on.
 */
export async function openRenderLedger(project: string) {
  const clock = (await readProjectClock(project)) ?? null;
  const declaration = await readProjectDeclaration(project);
  // A silent video delivers with no mix and no audio track (render-pipeline.ts).
  const silent = declaration?.capability === 'silent', paints = Boolean(declaration?.styles?.length);
  const spans: RenderSpan[] = [];
  let nextId = 0;

  /** Begins span `name` now, under `parent`. */
  function beginSpan(name: string, parent: number | null = null): OpenRenderSpan {
    const id = nextId++, start = renderSpanClock();
    return { id, end: (detail = {}) => { spans.push({ id, parent, name, start, end: renderSpanClock(), ...detail }); } };
  }

  /** Records span `name` from `start` to `end` (renderSpanClock's seconds), under `parent`, after the fact. */
  function addSpan(name: string, { start, end, parent = null, ...detail }: { start: number; end: number; parent?: number | null } & RenderSpanDetail): number {
    const id = nextId++;
    spans.push({ id, parent, name, start, end, ...detail });
    return id;
  }

  /** Runs `run` as span `name` under `parent`, handing it the span's id for its own children. */
  async function timed<T>(name: string, run: (id: number) => Promise<T> | T, { parent = null, ...detail }: { parent?: number | null } & RenderSpanDetail = {}): Promise<T> {
    const span = beginSpan(name, parent);
    const result = await run(span.id);
    span.end(detail);
    return result;
  }

  /** Records `waited` seconds for the GPU lease, from `start`, under `parent`, when it queued. */
  function recordGpuWait(waited: number, { start, parent }: { start: number; parent: number | null }) {
    if (waited >= GPU_WAIT_RECORDED_SECONDS) addSpan('waiting for the GPU', { start, end: start + waited, parent, kind: 'gpu-wait' });
  }

  return { project, clock, silent, paints, spans, beginSpan, addSpan, timed, recordGpuWait };
}

/** Seconds the command waited for the GPU lease, over all its spans. */
export const renderGpuWaitSeconds = (spans: readonly RenderSpan[]) =>
  spans.filter((s) => s.kind === 'gpu-wait').reduce((sum, s) => sum + s.end - s.start, 0);
