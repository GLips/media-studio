import * as stylex from '@stylexjs/stylex';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { reviewThreadWorkingUntil, type ReviewThread } from '#lib/output/review/models/review-threads.ts';

const spin = stylex.keyframes({ from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } });

const styles = stylex.create({
  spinner: { animationName: spin, animationDuration: '1.2s', animationIterationCount: 'infinite', animationTimingFunction: 'linear', flexShrink: 0 },
});

/** The words every surface says over the spinner. */
export const REVIEW_THREAD_WORKING_WORD = 'Agent working on it';

/**
 * Whether the agent is on `thread` now. A mark lapses on the clock, not on a change to the file, so this renders
 * again the moment it goes stale.
 */
export function useReviewThreadWorking(thread: Pick<ReviewThread, 'state' | 'working'>): boolean {
  const [now, setNow] = useState(Date.now);
  const until = reviewThreadWorkingUntil(thread, now);
  useEffect(() => {
    const timer = until === null ? undefined : setTimeout(() => setNow(Date.now()), until - Date.now());
    return () => clearTimeout(timer);
  }, [until]);
  return until !== null;
}

/** A turning circle, in the colour of what holds it. */
export function ReviewThreadWorkingSpinner({ size = 12 }: { readonly size?: number }) {
  return <LoaderCircle size={size} aria-label={REVIEW_THREAD_WORKING_WORD} {...stylex.props(styles.spinner)} />;
}
