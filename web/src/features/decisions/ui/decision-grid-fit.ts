import { useEffect, useState, type RefObject } from 'react';
import type { ReviewCandidate } from '#lib/output/review/models/review-threads.ts';

/** The shape candidates are fitted as: video and stills are mostly 16:9, and a 9:16 one letterboxes inside. */
const DECISION_FITTED_ASPECT = 16 / 9;
/** A frame's label and meta rows, which take height from its media. */
const DECISION_FRAME_CHROME_PX = 48;

/** How candidates lay out: columns of frames fitted to the space; sound, one column of full-width strips. */
export type DecisionGridFit = { columns: number };

/**
 * The columns that show `count` frames largest in a `w`×`h` space: each tries every column count and keeps the one
 * whose frames' fitted media is widest, so three 16:9 candidates in a tall space go two over one, not three thin
 * portrait boxes. Sound has no picture to fit: one column of strips.
 */
export function decisionGridFitFor(candidates: readonly ReviewCandidate[], { w, h }: { w: number; h: number }): DecisionGridFit {
  const count = Math.max(candidates.length, 1);
  if (candidates.length && candidates.every((c) => c.media?.kind === 'audio')) return { columns: 1 };
  let best = { columns: Math.min(count, 3), width: 0 };
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const width = Math.min(w / columns, Math.max(0, h / rows - DECISION_FRAME_CHROME_PX) * DECISION_FITTED_ASPECT);
    if (width > best.width) best = { columns, width };
  }
  return { columns: best.columns };
}

/** The fit for the box `ref` is, kept current as it resizes. */
export function useDecisionGridFit(ref: RefObject<HTMLElement | null>, candidates: readonly ReviewCandidate[]): DecisionGridFit {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(box);
    return () => observer.disconnect();
  }, [ref]);
  return decisionGridFitFor(candidates, size ?? { w: 16, h: 9 });
}
