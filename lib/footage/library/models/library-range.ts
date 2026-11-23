// library-range.ts: a stretch of a library item as a person or an agent names it (`1:12.5`, `0:39-0:41`), checked
// against the item, and what's said in it. Times are item time, as search, show and flags print them.
import { Result } from 'effect';
import type { SpokenWord } from '#lib/footage/transcript/models/spoken-word.ts';
import { LibraryRequestRefused } from './library-errors.ts';
import type { LibraryItem } from './library-item.ts';

/** Seconds as `12.5`, `1:02.5` or `1:02:03`. */
export function libraryClockSecondsOf(text: string): Result.Result<number, LibraryRequestRefused> {
  const parts = text.trim().split(':');
  if (parts.length > 3 || parts.some((p) => p === '' || Number.isNaN(Number(p)))) {
    return Result.fail(new LibraryRequestRefused({ reason: `"${text}" isn't a time: give seconds (72.5) or m:ss (1:12.5)` }));
  }
  return Result.succeed(parts.reduce((total, part) => total * 60 + Number(part), 0));
}

/** `from` to `to` of `item`, refused when it's empty, backwards or runs past either end. */
export function libraryRangeOf(item: LibraryItem, from: number, to: number): Result.Result<{ from: number; to: number }, LibraryRequestRefused> {
  if (!(from >= 0 && to > from && to <= item.durationSeconds + 1e-3)) {
    return Result.fail(new LibraryRequestRefused({ reason: `${from}–${to} isn't a range of ${item.id}, which runs 0–${item.durationSeconds.toFixed(2)} s` }));
  }
  return Result.succeed({ from, to });
}

/** What's said from `from` to `to`: the words whose middle falls in it, run together. */
export const libraryWordsSaidIn = (words: readonly SpokenWord[], from: number, to: number): string =>
  words.filter((w) => from <= (w.start + w.end) / 2 && (w.start + w.end) / 2 <= to).map((w) => w.text).join(' ');
