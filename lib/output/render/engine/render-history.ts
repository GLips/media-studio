// render-history.ts: every `studio render` appends one line to a JSONL file in the studio's user cache, which every
// checkout on the machine shares: what it rendered (its arguments, the studio's and the workspace's commits, dirty or
// not), whether it delivered, the whole command's time with the GPU lease wait kept apart, and every span its ledger
// recorded (render-ledger.ts). A render's speed is judged from these lines, before and after a change. Node only.
//
// Negative space: nothing here reads the history back or compares runs; a bench is a shell loop over `studio render`
// and a look at the lines it appended (docs/render-bench.md).
import { appendFileSync, mkdirSync } from 'node:fs';
import { cpus, hostname } from 'node:os';
import { dirname, relative } from 'node:path';
import { gitState } from '#lib/platform/host/engine/hosts.ts';
import { STUDIO_ROOT, STUDIO_WORKSPACE_DIR } from '#lib/platform/project/engine/studio-project.ts';
import { isStudioWorkspaceRepo } from '#lib/platform/project/engine/studio-workspace.ts';
import { studioUserCacheDir } from '#lib/platform/temp/engine/studio-user-cache.ts';
import { renderGpuWaitSeconds, renderSpanClock, type RenderLedger, type RenderSpan } from './render-ledger.ts';

/** Bumped whenever a record's shape changes, so a reader can tell lines apart. */
export const RENDER_HISTORY_VERSION = 1;

/** The history file: STUDIO_RENDER_HISTORY when set (a test's own), else the studio's user cache. */
export const renderHistoryFile = () => process.env.STUDIO_RENDER_HISTORY || studioUserCacheDir('render-history.jsonl');

/** One `studio render`, as its line holds it. Seconds throughout; `seconds` is the whole process, delivery checks included. */
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
  readonly spans: readonly RenderSpan[];
};

/**
 * Runs a render command, `run`, and appends its record to the history, delivered or failed. `run` hands the ledger it
 * opens to `keep`, whose spans the record holds; a command that fails before opening one is recorded with none.
 */
export async function withRenderHistory<T>(args: readonly string[], run: (keep: (ledger: RenderLedger) => RenderLedger) => Promise<T>): Promise<T> {
  let kept: RenderLedger | null = null;
  const keep = (ledger: RenderLedger) => (kept = ledger);
  try {
    const result = await run(keep);
    appendRenderHistory(renderHistoryRecord(args, kept, null));
    return result;
  } catch (error) {
    appendRenderHistory(renderHistoryRecord(args, kept, error instanceof Error ? error : new Error(String(error))));
    throw error;
  }
}

function renderHistoryRecord(args: readonly string[], ledger: RenderLedger | null, error: Error | null): RenderHistoryRecord {
  const spans = ledger?.spans ?? [];
  return {
    version: RENDER_HISTORY_VERSION, at: new Date().toISOString(), machine: { host: hostname(), cpu: cpus()[0]?.model ?? 'unknown' },
    engine: gitState(STUDIO_ROOT), workspace: isStudioWorkspaceRepo() ? gitState(STUDIO_WORKSPACE_DIR) : null,
    project: ledger ? relative(STUDIO_ROOT, ledger.project) : null, args, ok: error === null, ...(error && { error: error.message.split('\n')[0] }),
    seconds: renderSpanClock(), gpuWaitSeconds: renderGpuWaitSeconds(spans), spans,
  };
}

function appendRenderHistory(record: RenderHistoryRecord): void {
  const file = renderHistoryFile();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}
