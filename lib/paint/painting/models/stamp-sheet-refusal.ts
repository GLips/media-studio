// stamp-sheet-refusal.ts: what a sheet solve won't paint as written, as against an engine fault: the scheduler throws
// one for an `on` that can't hold, a fixed `at` it can't land at or a bloom with nothing to act on. Tools print its
// message alone, without a stack.

/** What a solve won't paint as written: the document's to change, not an engine fault. Its message is the author's. */
export class StampSheetRefusal extends Error {}
