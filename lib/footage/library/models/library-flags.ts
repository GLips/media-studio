// library-flags.ts: a library item's flags, the library's review scope: marked ranges of the item, each with an
// optional note, set by Graham or an agent. A flag is a selection, not a task: it has no kind and no state to work
// through, so it shares review's store (review-store.ts) and clock, not its threads. Pure.
import { Result, Schema } from 'effect';
import type { ReviewAuthor } from '#lib/output/review/models/review-threads.ts';
import { LibraryFlagRefused } from './library-errors.ts';

export const LIBRARY_FLAGS_VERSION = 1;

/** Who set a flag: review's authors. */
export const LibraryFlagAuthor = Schema.Literals(['reviewer', 'agent'] satisfies readonly ReviewAuthor[]);

/** A marked range in item time, `start` ≤ `end` (equal marks an instant). */
export const LibraryFlag = Schema.Struct({
  id: Schema.Finite,
  start: Schema.Finite,
  end: Schema.Finite,
  note: Schema.optionalKey(Schema.String),
  by: LibraryFlagAuthor,
  at: Schema.String,
  rev: Schema.Finite,
});
export type LibraryFlag = typeof LibraryFlag.Type;

export const LibraryFlagsFile = Schema.Struct({
  version: Schema.Literal(LIBRARY_FLAGS_VERSION),
  /** +1 per change, as a project's review file counts. */
  revision: Schema.Finite,
  nextId: Schema.Finite,
  flags: Schema.Array(LibraryFlag),
});
export type LibraryFlagsFile = typeof LibraryFlagsFile.Type;

export const emptyLibraryFlagsFile = (): LibraryFlagsFile => ({ version: LIBRARY_FLAGS_VERSION, revision: 0, nextId: 1, flags: [] });

/** A change to an item's flags. `note: ''` clears a note. */
export type LibraryFlagOp =
  | { op: 'flag.add'; start: number; end: number; note?: string }
  | { op: 'flag.note'; id: number; note: string }
  | { op: 'flag.remove'; id: number };

/** A flags file with a change applied, and the flag it touched. */
export type LibraryFlagChange = { file: LibraryFlagsFile; flag: LibraryFlag };

/** `file` with `op` applied as `by` at `now`, for an item `durationSeconds` long; refused, nothing changes. */
export function applyLibraryFlagOp(file: LibraryFlagsFile, op: LibraryFlagOp, { by, now, durationSeconds }: { by: ReviewAuthor; now: string; durationSeconds: number }): Result.Result<LibraryFlagChange, LibraryFlagRefused> {
  const rev = file.revision + 1;
  if (op.op === 'flag.add') {
    if (!(op.start >= 0 && op.end >= op.start && op.end <= durationSeconds + 1e-6)) {
      return Result.fail(new LibraryFlagRefused({ reason: `a flag runs from 0 to the item's end, ${durationSeconds.toFixed(2)} s, start before end: ${op.start}–${op.end} isn't` }));
    }
    const note = op.note?.trim();
    const flag: LibraryFlag = { id: file.nextId, start: op.start, end: op.end, ...(note && { note }), by, at: now, rev };
    return Result.succeed({ file: { ...file, revision: rev, nextId: file.nextId + 1, flags: [...file.flags, flag] }, flag });
  }
  const flag = file.flags.find((f) => f.id === op.id);
  if (!flag) return Result.fail(new LibraryFlagRefused({ reason: `there's no flag #${op.id}; ${file.flags.length ? `the flags are ${file.flags.map((f) => `#${f.id}`).join(', ')}` : 'the item has none'}` }));
  if (op.op === 'flag.remove') return Result.succeed({ file: { ...file, revision: rev, flags: file.flags.filter((f) => f !== flag) }, flag });
  const { note: _, ...rest } = flag, note = op.note.trim();
  const changed: LibraryFlag = { ...rest, ...(note && { note }), rev };
  return Result.succeed({ file: { ...file, revision: rev, flags: file.flags.map((f) => (f === flag ? changed : f)) }, flag: changed });
}

/** Whose flags a reader steps through: everyone's, or one author's. */
export type LibraryFlagFilter = 'all' | ReviewAuthor;

/** The flags `filter` keeps, in the order they're stepped through: by start, then as set. */
export const libraryFlagsInOrder = (flags: readonly LibraryFlag[], filter: LibraryFlagFilter): LibraryFlag[] =>
  flags.filter((f) => filter === 'all' || f.by === filter).toSorted((a, b) => a.start - b.start || a.id - b.id);

/**
 * The flag a step lands on from flag `from` (or from `seconds` when no flag is on show): the next in order, or with
 * `direction` -1 the one before. Undefined past either end.
 */
export function libraryFlagBeside(ordered: readonly LibraryFlag[], from: { flag?: number; seconds: number }, direction: -1 | 1): LibraryFlag | undefined {
  const at = from.flag === undefined ? -1 : ordered.findIndex((f) => f.id === from.flag);
  if (at >= 0) return ordered[at + direction];
  return direction > 0 ? ordered.find((f) => f.start > from.seconds + 1e-3) : ordered.findLast((f) => f.start < from.seconds - 1e-3);
}
