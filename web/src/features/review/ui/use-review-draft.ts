import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NewAnchor } from '#lib/output/review/models/review-ops.ts';
import type { ReviewMark, ReviewThreadKind } from '#lib/output/review/models/review-threads.ts';
import { REVIEW_THREAD_KINDS } from './review-thread-kind.tsx';

/** The note being written: what it's about, where it's pinned, its words and its strokes, until it saves. */
export type ReviewDraftFields = {
  kind: ReviewThreadKind;
  anchor: Partial<NewAnchor>;
  text: string;
  /** Strokes drawn in draw mode, kept apart from the anchor until the save folds them in. */
  marks: ReviewMark[];
};

export type ReviewDraft = ReviewDraftFields & {
  /** True from the first pin, word or stroke until a save or a discard. */
  isOpen: boolean;
  setAnchor: (anchor: Partial<NewAnchor> | ((current: Partial<NewAnchor>) => Partial<NewAnchor>)) => void;
  setText: (text: string) => void;
  /** A kind picked in the composer, which the next note starts as too. */
  setKind: (kind: ReviewThreadKind) => void;
  /** `Tab` in the composer: fix → question → keep. */
  cycleKind: () => void;
  addMark: (mark: ReviewMark) => void;
  /** `Backspace` in draw mode: the last stroke. */
  popMark: () => void;
  discard: () => void;
};

/** The kind the reviewer last picked, in this browser: every file's next note starts as it. */
const REVIEW_NOTE_KIND_KEY = 'review-note-kind';

function readStickyReviewKind(): ReviewThreadKind {
  const saved = localStorage.getItem(REVIEW_NOTE_KIND_KEY);
  return REVIEW_THREAD_KINDS.find((kind) => kind === saved) ?? 'fix';
}

const emptyReviewDraft = (): ReviewDraftFields => ({ kind: readStickyReviewKind(), anchor: {}, text: '', marks: [] });

const reviewDraftKeyOf = (file: string) => `review-draft:${file}`;

function readReviewDraft(file: string): ReviewDraftFields | null {
  const saved = sessionStorage.getItem(reviewDraftKeyOf(file));
  // SAFETY: only this hook writes the key, always a JSON ReviewDraftFields, and the tab's storage dies with the tab.
  return saved ? (JSON.parse(saved) as ReviewDraftFields) : null;
}

/**
 * The draft of one file, kept in sessionStorage under the file: switching files, a render auto-loading under it and a
 * reload all leave it in place. Only a save or an explicit discard ends it; `Escape` never does. A new draft starts as
 * the kind last picked in this browser.
 */
export function useReviewDraft(file: string): ReviewDraft {
  const [fields, setFields] = useState<ReviewDraftFields | null>(() => readReviewDraft(file));
  useEffect(() => {
    if (fields) sessionStorage.setItem(reviewDraftKeyOf(file), JSON.stringify(fields));
    else sessionStorage.removeItem(reviewDraftKeyOf(file));
  }, [file, fields]);

  const update = useCallback((change: (draft: ReviewDraftFields) => ReviewDraftFields) =>
    setFields((current) => change(current ?? emptyReviewDraft())), []);

  return useMemo(() => {
    const shown = fields ?? emptyReviewDraft();
    const pickKind = (kind: ReviewThreadKind) => {
      localStorage.setItem(REVIEW_NOTE_KIND_KEY, kind);
      update((d) => ({ ...d, kind }));
    };
    return {
      ...shown,
      isOpen: fields !== null,
      setAnchor: (anchor) => update((d) => ({ ...d, anchor: typeof anchor === 'function' ? anchor(d.anchor) : anchor })),
      setText: (text) => update((d) => ({ ...d, text })),
      setKind: pickKind,
      cycleKind: () => pickKind(REVIEW_THREAD_KINDS[(REVIEW_THREAD_KINDS.indexOf(shown.kind) + 1) % REVIEW_THREAD_KINDS.length]),
      addMark: (mark) => update((d) => ({ ...d, marks: [...d.marks, mark] })),
      popMark: () => update((d) => ({ ...d, marks: d.marks.slice(0, -1) })),
      discard: () => setFields(null),
    };
  }, [fields, update]);
}
