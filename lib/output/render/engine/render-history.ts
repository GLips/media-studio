// render-history.ts: every `studio render` appends one line to a JSONL file in the studio's user cache, shared by every
// checkout on the machine: its arguments, both repos' commits, whether it delivered, its time with the GPU lease wait
// apart, the command's own spans (render-ledger.ts), and its trace (lib/platform/trace/), kept in render-traces/ beside
// the history for Perfetto to open. Traces are pruned; a line outlives its trace. Node only.
//
// Negative space: nothing here reads the history back or compares runs; a bench is a shell loop over `studio render`
// and a look at the lines it appended (docs/render-bench.md).
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { cpus, hostname } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { gitState } from '#lib/platform/host/engine/hosts.ts';
import { STUDIO_ROOT, STUDIO_WORKSPACE_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { isStudioWorkspaceRepo } from '#lib/platform/project/engine/studio-workspace.ts';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';
import { openTraceCollector, traceClock, type TraceCollector } from '#lib/platform/trace/engine/trace-collector.ts';
import { openTraceFile, pruneTraceFiles, traceFileStamp } from '#lib/platform/trace/engine/trace-files.ts';
import type { TraceSpan } from '#lib/platform/trace/models/trace-model.ts';
import { renderGpuWaitSeconds, RENDER_TRACE_PRODUCER, type RenderLedger } from './render-ledger.ts';

/** Bumped whenever a record's shape changes, so a reader can tell lines apart. */
export const RENDER_HISTORY_VERSION = 2;

/** Render traces kept, newest first, and the bytes they may hold between them. */
const RENDER_TRACES_KEPT = { keep: 100, bytes: 2 * 1024 ** 3 };

/** The history file: STUDIO_RENDER_HISTORY when set (a test's own), else the studio's user cache. */
export const renderHistoryFile = () => process.env.STUDIO_RENDER_HISTORY || studioUserCacheDir('render-history.jsonl');

/** Where render traces are kept: beside the history file. */
export const renderTraceDir = () => join(dirname(renderHistoryFile()), 'render-traces');

/**
 * One `studio render`, as its line holds it. Seconds throughout; `seconds` is the whole process, delivery checks
 * included. `spans` are the command's own, Node's; `trace` is the file holding them with every page's, or null when it
 * couldn't be written, and may since have been pruned.
 */
export type RenderHistoryRecord = {
  readonly version: number;
  readonly at: string;
  readonly machine: { readonly host: string; readonly cpu: string };
  readonly engine: { readonly commit: string; readonly dirty: boolean };
  readonly workspace: { readonly commit: string; readonly dirty: boolean } | null;
  readonly project: string | null;
  readonly args: readonly string[];
  readonly ok: boolean;
  readonly error?: string;
  readonly seconds: number;
  readonly gpuWaitSeconds: number;
  readonly spans: readonly TraceSpan[];
  readonly trace: string | null;
};

/**
 * Runs a render command, `run`, tracing it in `trace`, and appends its record to the history, delivered or failed.
 * `run` hands the ledger it opens (on `trace`) to `keep`, which names the project; a command that fails before opening
 * one is recorded with no project.
 */
export async function withRenderHistory<T>(args: readonly string[], run: (opened: { trace: TraceCollector; keep: (ledger: RenderLedger) => RenderLedger }) => Promise<T>): Promise<T> {
  const dir = renderTraceDir(), file = openTraceFile(dir, traceFileStamp(randomBytes(3).toString('hex')));
  const trace = openTraceCollector({ sink: file.write });
  let kept: RenderLedger | null = null;
  const keep = (ledger: RenderLedger) => (kept = ledger);
  const finish = (error: Error | null) => {
    const spans = trace.trace().spans.filter((s) => s.producer === RENDER_TRACE_PRODUCER), path = file.finish();
    try {
      pruneTraceFiles(dir, RENDER_TRACES_KEPT);
    } catch (pruning) {
      process.stderr.write(`render traces in ${dir} not pruned: ${pruning instanceof Error ? pruning.message : String(pruning)}\n`);
    }
    appendRenderHistory(renderHistoryRecord(args, kept, spans, path, error));
    if (path) process.stderr.write(`trace: ${path} (ui.perfetto.dev opens it)\n`);
  };
  try {
    const result = await run({ trace, keep });
    finish(null);
    return result;
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

function renderHistoryRecord(args: readonly string[], ledger: RenderLedger | null, spans: readonly TraceSpan[], trace: string | null, error: Error | null): RenderHistoryRecord {
  return {
    version: RENDER_HISTORY_VERSION, at: new Date().toISOString(), machine: { host: hostname(), cpu: cpus()[0]?.model ?? 'unknown' },
    engine: gitState(STUDIO_ROOT), workspace: isStudioWorkspaceRepo() ? gitState(STUDIO_WORKSPACE_DIR) : null,
    project: ledger ? relative(STUDIO_ROOT, ledger.project) : null, args, ok: error === null, ...(error && { error: error.message.split('\n')[0] }),
    seconds: traceClock(), gpuWaitSeconds: renderGpuWaitSeconds(spans), spans, trace,
  };
}
function appendRenderHistory(record: RenderHistoryRecord): void {
  const file = renderHistoryFile();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}
