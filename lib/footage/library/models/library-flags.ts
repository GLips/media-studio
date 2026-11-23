// library-flags.ts: a library item's flags, the library's review scope: marked ranges of the item, each with an
// optional note, set by Graham or an agent. A flag is a selection, not a task: it has no kind and no state to work
// through, so it shares review's store (review-store.ts) and clock, not its threads. Pure.
import type { ReviewAuthor } from '#lib/output/review/models/review-threads.ts';

export const LIBRARY_FLAGS_VERSION = 1;

/** A marked range in item time, `start` ≤ `end` (equal marks an instant). */
export type LibraryFlag = { id: number; start: number; end: number; note?: string; by: ReviewAuthor; at: string; rev: number };

export type LibraryFlagsFile = {
  version: typeof LIBRARY_FLAGS_VERSION;
  /** +1 per change, as a project's review file counts. */
  revision: number;
  nextId: number;
  flags: LibraryFlag[];
};

export const emptyLibraryFlagsFile = (): LibraryFlagsFile => ({ version: LIBRARY_FLAGS_VERSION, revision: 0, nextId: 1, flags: [] });

/** A change to an item's flags. `note: ''` clears a note. */
export type LibraryFlagOp =
  | { op: 'flag.add'; start: number; end: number; note?: string }
  | { op: 'flag.note'; id: number; note: string }
  | { op: 'flag.remove'; id: number };

/** A change the flags refuse: a range off the item, an unknown flag. Nothing is written. */
export class LibraryFlagRefused extends Error {}

/** `file` with `op` applied as `by` at `now`, for an item `durationSeconds` long; the flag it touched. */
export function applyLibraryFlagOp(file: LibraryFlagsFile, op: LibraryFlagOp, { by, now, durationSeconds }: { by: ReviewAuthor; now: string; durationSeconds: number }): { file: LibraryFlagsFile; flag: LibraryFlag } {
  const rev = file.revision + 1;
  if (op.op === 'flag.add') {
    if (!(op.start >= 0 && op.end >= op.start && op.end <= durationSeconds + 1e-6)) {
      throw new LibraryFlagRefused(`a flag runs from 0 to the item's end, ${durationSeconds.toFixed(2)} s, start before end: ${op.start}–${op.end} isn't`);
    }
    const note = op.note?.trim();
    const flag: LibraryFlag = { id: file.nextId, start: op.start, end: op.end, ...(note && { note }), by, at: now, rev };
    return { file: { ...file, revision: rev, nextId: file.nextId + 1, flags: [...file.flags, flag] }, flag };
  }
  const flag = file.flags.find((f) => f.id === op.id);
  if (!flag) throw new LibraryFlagRefused(`there's no flag #${op.id}; ${file.flags.length ? `the flags are ${file.flags.map((f) => `#${f.id}`).join(', ')}` : 'the item has none'}`);
  if (op.op === 'flag.remove') return { file: { ...file, revision: rev, flags: file.flags.filter((f) => f !== flag) }, flag };
  const { note: _, ...rest } = flag, note = op.note.trim();
  const changed: LibraryFlag = { ...rest, ...(note && { note }), rev };
  return { file: { ...file, revision: rev, flags: file.flags.map((f) => (f === flag ? changed : f)) }, flag: changed };
}
