// replace-file-whole.ts: writing a file another process may read at any moment (a marker it polls, a file it parses).
// Node only.

import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Writes `bytes` beside `path` and renames it over, so a reader finds the old file or the new one, never half. */
export function replaceFileWhole(path: string, bytes: string | Uint8Array): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(temp, bytes);
  renameSync(temp, path);
}
