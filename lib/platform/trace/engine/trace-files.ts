// trace-files.ts: a trace kept on disk. Its records are appended to `<name>.jsonl` as they're made, so a process that
// dies still leaves them; finishing folds them into `<name>.json`, Chrome trace JSON (chrome-trace.ts) that Perfetto
// opens, and removes the records. A folder of traces keeps the newest few under a byte budget. Writing a trace never
// fails the work it traces: a failed write warns once and the trace is missing. Node only.
//
// Negative space: records left by a process that died are neither finished nor read here; they count toward the
// folder's budget and are pruned like any trace.
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { encodeChromeTrace } from '../models/chrome-trace.ts';
import { traceOfRecords, type TraceRecord } from '../models/trace-model.ts';

/** A name for a trace made now that sorts by time and is safe in any filesystem: `2026-10-07T14-03-22-118Z-3f9a1c`. */
export const traceFileStamp = (id: string, now = new Date()) => `${now.toISOString().replaceAll(':', '-').replace('.', '-')}-${id}`;

/** A trace being written to `dir` as `name`. */
export function openTraceFile(dir: string, name: string) {
  const records = join(dir, `${name}.jsonl`), path = join(dir, `${name}.json`);
  let fd: number | null = null, broken = false;
  // String(error): an fs error reads `Error: ENOSPC: …`, which is all a warning needs.
  const warn = (cause: string) => {
    broken = true;
    process.stderr.write(`trace ${path} not written: ${cause}\n`);
  };
  try {
    mkdirSync(dir, { recursive: true });
    fd = openSync(records, 'w');
  } catch (error) {
    warn(String(error));
  }

  /** Appends `record`. */
  function write(record: TraceRecord): void {
    if (broken || fd === null) return;
    try {
      writeSync(fd, `${JSON.stringify(record)}\n`);
    } catch (error) {
      warn(String(error));
    }
  }

  /** Folds the records into the trace at `path`. Returns `path`, or null when the trace is missing. */
  function finish(): string | null {
    if (fd !== null) closeSync(fd);
    fd = null;
    if (broken) return null;
    try {
      // SAFETY: every line was written by `write` above, from a TraceRecord.
      const lines = readFileSync(records, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as TraceRecord);
      writeFileSync(path, JSON.stringify(encodeChromeTrace(traceOfRecords(lines))));
      rmSync(records);
      return path;
    } catch (error) {
      warn(String(error));
      return null;
    }
  }

  return { path, write, finish };
}

/** Removes the oldest traces in `dir` past the newest `keep`, then past `bytes` between them. */
export function pruneTraceFiles(dir: string, { keep, bytes }: { keep: number; bytes: number }): void {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') || f.endsWith('.jsonl'))
    .map((f) => ({ file: join(dir, f), size: statSync(join(dir, f)).size }))
    .toSorted((a, b) => (a.file < b.file ? 1 : -1));
  let total = 0;
  for (const [i, { file, size }] of files.entries()) {
    total += size;
    if (i >= keep || total > bytes) rmSync(file, { force: true });
  }
}
