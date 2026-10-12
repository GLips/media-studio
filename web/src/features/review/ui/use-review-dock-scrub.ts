import { useRef, useState, type PointerEvent } from 'react';
import { reviewTimelineFrameAt, type ReviewTimelineView } from '#lib/output/review/models/review-timeline-geometry.ts';
import type { ReviewLoopRange } from './review-playback-store.ts';
import { useReviewScreen } from './review-screen-context.tsx';

/** How far a press must travel, in frames, before a drag that can sketch a range does. */
const REVIEW_SKETCH_FRAMES = 2;

/** A press in the dock: where it began, and whether it may become, or has become, a range sketch. */
type ReviewDockPress = { from: number; canSketch: boolean; sketching: boolean };

/** What a press on the dock ignores: a mark's own click, a gutter glyph, the overview strip's own drag. */
const REVIEW_DOCK_OWN_PRESS = 'button, [data-review-overview]';

export type ReviewDockScrub = {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  /** The range being sketched, until the press lets go and it becomes the draft's. */
  sketch: ReviewLoopRange | null;
};

/**
 * The dock as one scrubber: a press anywhere but the gutter seeks and a drag scrubs. A drag in the notes lane, or any
 * Shift-drag, sketches a range instead, which becomes the draft's anchor on release.
 */
export function useReviewDockScrub(view: ReviewTimelineView, lanes: HTMLElement | null): ReviewDockScrub {
  const { artifact, playback, draft } = useReviewScreen();
  const press = useRef<ReviewDockPress | null>(null);
  const [sketch, setSketch] = useState<ReviewLoopRange | null>(null);

  const frameAt = (event: PointerEvent<HTMLElement>) => reviewTimelineFrameAt(view, event.clientX - (lanes?.getBoundingClientRect().left ?? 0));
  const end = () => {
    press.current = null;
    setSketch(null);
  };

  return {
    onPointerDown(event) {
      if (event.button !== 0 || !lanes || !(event.target instanceof Element) || event.target.closest(REVIEW_DOCK_OWN_PRESS)) return;
      if (event.clientX < lanes.getBoundingClientRect().left) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const from = frameAt(event);
      press.current = { from, canSketch: event.shiftKey || event.target.closest('[data-review-lane="notes"]') !== null, sketching: false };
      playback.seek(from);
    },
    onPointerMove(event) {
      const current = press.current;
      if (!current) return;
      const frame = frameAt(event);
      if (current.canSketch && !current.sketching && Math.abs(frame - current.from) >= REVIEW_SKETCH_FRAMES) {
        current.sketching = true;
        playback.pause();
      }
      if (current.sketching) setSketch({ from: Math.min(current.from, frame), to: Math.max(current.from, frame) });
      else playback.seek(frame);
    },
    onPointerUp(event) {
      const current = press.current;
      end();
      if (!current?.sketching) return;
      const frame = frameAt(event), from = Math.min(current.from, frame), to = Math.max(current.from, frame);
      const writtenOn = { path: artifact.path, hash: artifact.render.hash };
      draft.setAnchor((anchor) => ({ ...(anchor.on === 'video' ? anchor : {}), on: 'video', frame: from, end: to, writtenOn }));
      playback.seek(from);
    },
    onPointerCancel: end,
    sketch,
  };
}
