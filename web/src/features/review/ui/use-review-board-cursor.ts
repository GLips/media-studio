// use-review-board-cursor.ts: the Board's cursor, where it starts, how the arrows move it, and keeping it in view.
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ReviewBoardRow } from '#lib/output/review/models/review-storyboard.ts';
import type { ReviewTileStep } from './use-review-board-hotkeys.ts';

/** Marks each Board still with its frame, for the Board to find the cursor's still, caption and all. */
export const REVIEW_BOARD_STILL_ATTRIBUTE = 'data-review-board-still';

/** The Board's cursor: a row, and a still in it. */
export type ReviewBoardCursor = { row: number; still: number };

/** Where the cursor starts: on the still at or before the playhead, in the scene the playhead is in. */
function reviewBoardCursorAt(rows: readonly ReviewBoardRow[], frame: number): ReviewBoardCursor {
  const row = Math.max(0, rows.findIndex((r) => r.from <= frame && frame < r.to));
  const still = rows[row] ? Math.max(0, rows[row].stills.findLastIndex((s) => s.frame <= frame)) : 0;
  return { row, still };
}

/** The cursor moved: along the reading order across rows, or a row up or down keeping its column where it can. */
export function reviewBoardCursorStep(rows: readonly ReviewBoardRow[], at: ReviewBoardCursor, { along, rows: down }: ReviewTileStep): ReviewBoardCursor {
  if (down) {
    const row = Math.min(Math.max(at.row + down, 0), rows.length - 1);
    return { row, still: Math.min(at.still, rows[row].stills.length - 1) };
  }
  const flat = rows.flatMap((r, row) => r.stills.map((_, still) => ({ row, still })));
  const i = flat.findIndex((c) => c.row === at.row && c.still === at.still);
  return flat[Math.min(Math.max(i + along, 0), flat.length - 1)] ?? at;
}

type ReviewBoardCursorState = {
  cursor: ReviewBoardCursor;
  setCursor: (change: (at: ReviewBoardCursor) => ReviewBoardCursor) => void;
  /** The Board's scrolled viewport, in which the cursor's still is kept in view. */
  viewport: RefObject<HTMLDivElement | null>;
};

/**
 * The cursor, begun at the playhead, and its still kept in view with its caption and a margin clear of the faded edges.
 * The tile brings only its picture into view; this runs after it (a child's effect runs first) and takes the rest.
 */
export function useReviewBoardCursor(rows: readonly ReviewBoardRow[], frame: number): ReviewBoardCursorState {
  const [cursor, setCursor] = useState(() => reviewBoardCursorAt(rows, frame));
  const viewport = useRef<HTMLDivElement>(null);
  const at = rows[cursor.row]?.stills[cursor.still]?.frame;
  useEffect(() => {
    if (at !== undefined) viewport.current?.querySelector(`[${REVIEW_BOARD_STILL_ATTRIBUTE}="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);
  return { cursor, setCursor, viewport };
}
