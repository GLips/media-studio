// review-check-queue.ts: the check queue's walk through a render's addressed notes (`Shift+V`), apart from the keys
// and the clock so its order and steps can be tested. The queue is taken once, on entering, so "3 of 12" holds still
// while notes leave it; a note leaves by any resolve or reopen, from the queue's keys or the thread's own.

/** What the queue reads of a placed thread: its state, and its frame on the open render (absent when unplaced). */
export type ReviewCheckCandidate = { readonly id: number; readonly state: string; readonly frame: number | undefined };

/** The addressed notes in moment order, as taken on entering, and the index of the one on show. */
export type ReviewCheckQueue = { readonly ids: readonly number[]; readonly at: number };

/**
 * The render's addressed notes in moment order, ties by id, starting at the first; null with none. Negative space: an
 * unplaced note has no moment on this render to seek to, so it stays out.
 */
export function startReviewCheckQueue(threads: readonly ReviewCheckCandidate[]): ReviewCheckQueue | null {
  const ids = threads
    .filter((t): t is ReviewCheckCandidate & { frame: number } => t.state === 'addressed' && t.frame !== undefined)
    .toSorted((a, b) => a.frame - b.frame || a.id - b.id)
    .map((t) => t.id);
  return ids.length ? { ids, at: 0 } : null;
}

/**
 * Where the queue stands once states have moved: on the same note while it's still addressed, else on the next one
 * that is, else an earlier one still waiting, else done (null).
 */
export function reviewCheckQueueAfter(queue: ReviewCheckQueue, addressed: ReadonlySet<number>): ReviewCheckQueue | null {
  if (addressed.has(queue.ids[queue.at])) return queue;
  const later = queue.ids.findIndex((id, i) => i > queue.at && addressed.has(id));
  const at = later >= 0 ? later : queue.ids.findIndex((id) => addressed.has(id));
  return at >= 0 ? { ids: queue.ids, at } : null;
}

/** Past the note on show, left addressed, to the next later one still addressed; past the last, done (null). */
export function reviewCheckQueueSkip(queue: ReviewCheckQueue, addressed: ReadonlySet<number>): ReviewCheckQueue | null {
  const at = queue.ids.findIndex((id, i) => i > queue.at && addressed.has(id));
  return at >= 0 ? { ids: queue.ids, at } : null;
}
