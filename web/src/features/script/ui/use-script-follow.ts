import { useEffect, useRef, type RefObject } from 'react';

/** How long after the reader scrolls the lines themselves the read-along leaves the scroll alone. */
const SCRIPT_FOLLOW_PAUSE_MS = 3000;

/**
 * Keeps `lineId`'s row in view of `viewport` as it changes (the read moving on, the arrows), unless the reader scrolled
 * in the last 3 s. Returns the handlers that mark a scroll as the reader's: a scroll event can't tell.
 */
export function useScriptFollow(viewport: RefObject<HTMLElement | null>, lineId: string | undefined) {
  const readerScrolledAt = useRef(0);
  useEffect(() => {
    if (lineId === undefined || performance.now() - readerScrolledAt.current < SCRIPT_FOLLOW_PAUSE_MS) return;
    viewport.current?.querySelector(`[data-line="${CSS.escape(lineId)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [viewport, lineId]);
  const markReaderScroll = () => {
    readerScrolledAt.current = performance.now();
  };
  return { onWheel: markReaderScroll, onTouchMove: markReaderScroll };
}
