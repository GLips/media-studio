// file-sha256.ts: a file's SHA-256, read a block at a time, so a file of gigabytes (a slice's lossless frames, a brush
// pack's archive) never sits in memory whole. Node only.

import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';

/** `file`'s SHA-256, as hex. */
export function sha256OfFile(file: string): string {
  const hash = createHash('sha256'), block = Buffer.alloc(8 * 2 ** 20), fd = openSync(file, 'r');
  try {
    for (let read; (read = readSync(fd, block)) > 0;) hash.update(block.subarray(0, read));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}
