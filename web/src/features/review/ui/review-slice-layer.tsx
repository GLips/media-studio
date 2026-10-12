// review-slice-layer.tsx: the reply slices laid into the cut on the stage. Each is a muted follower of the review's
// clock, shown only over the frames it wins, so the cut's sound plays on under it; the server has already said which
// slices fit and which frames each wins (review-splices.ts). The compare view sits above this layer, so `\` on "as
// rendered" shows the cut bare.
import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useReducer, useState } from 'react';
import type { ReviewLaidSlice } from '#lib/output/review/models/review-placement.ts';
import { reviewMediaUrl } from '#web/shared/media-urls.ts';
import { useLinkedMediaFollower, useLinkedMediaTick } from '#web/shared/ui/linked-media-clock.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { REVIEW_MEDIA_ATTRIBUTE } from './review-mark-paint.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { useReviewSplices } from './use-review-threads.ts';

const styles = stylex.create({
  layer: { position: 'absolute', inset: 0, pointerEvents: 'none' },
  media: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  hidden: { opacity: 0 },
  tag: {
    position: 'absolute', bottom: spacing.tight, right: spacing.tight, paddingInline: spacing.tight,
    backgroundColor: colors.ground, borderRadius: radius.control, whiteSpace: 'nowrap',
  },
});

/** Marks a laid slice's video with `<hash>:<from>`, so a new note can tell which slice is the picture on screen. */
const REVIEW_SLICE_ATTRIBUTE = 'data-review-slice';
const sliceKeyOf = (slice: ReviewLaidSlice) => `${slice.hash}:${slice.from}`;

/**
 * The laid slices whose picture is on screen now: inside their frames, past their first presented frame, and not
 * hidden by `\`. A note is written on a slice only when the reviewer was looking at it.
 */
export function shownReviewSlicesOf(laid: readonly ReviewLaidSlice[]): ReviewLaidSlice[] {
  return laid.filter((slice) => document.querySelector(`video[${REVIEW_SLICE_ATTRIBUTE}="${sliceKeyOf(slice)}"]`)?.checkVisibility({ opacityProperty: true }));
}

/** The laid slice over `frame` and the one after it: the two the stage loads, the rest wait for the playhead. */
function reviewSlicesNear(laid: readonly ReviewLaidSlice[], frame: number): { over: ReviewLaidSlice | undefined; next: ReviewLaidSlice | undefined } {
  return { over: laid.find((s) => s.from <= frame && frame < s.end), next: laid.find((s) => s.from > frame) };
}

/**
 * One slice over the cut. It carries the review-media attribute, so a note's frame image is cut from it while it's
 * the picture shown. Only the slice over the playhead and the next load ahead (`near`).
 */
function ReviewSliceVideo({ slice, near }: { readonly slice: ReviewLaidSlice; readonly near: boolean }) {
  const { project, playback, timing } = useReviewScreen();
  const [video, attachVideo] = useState<HTMLVideoElement | null>(null);
  const { from, end, startsAt } = slice;
  useLinkedMediaFollower(playback, video, { fps: timing.fps, span: { from, end }, frameOf: (frame) => frame - startsAt });
  return (
    <Box component="video" ref={attachVideo} src={reviewMediaUrl({ project, path: slice.path, render: { hash: slice.hash } })}
      muted playsInline preload={near ? 'auto' : 'metadata'} {...{ [REVIEW_MEDIA_ATTRIBUTE]: true, [REVIEW_SLICE_ATTRIBUTE]: sliceKeyOf(slice) }}
      {...stylex.props(styles.media)} />
  );
}

/**
 * Every slice laid into the open cut, each over the frames it wins, and `#12` at the frame's foot while one shows (the
 * thread whose reply brought it). Hidden while `\` flips to a compared version.
 */
export function ReviewSliceLayer({ hidden }: { readonly hidden: boolean }) {
  const { playback } = useReviewScreen();
  const { laid } = useReviewSplices();
  // Read live rather than kept in state: a tick re-renders only when the slice over the playhead, or the next, changes.
  const { over, next } = reviewSlicesNear(laid, playback.frameNow());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useLinkedMediaTick(playback, (frame) => {
    const now = reviewSlicesNear(laid, frame);
    if (now.over !== over || now.next !== next) rerender();
  }, laid.length > 0);
  if (laid.length === 0) return null;
  return (
    <Box {...stylex.props(styles.layer, hidden && styles.hidden)}>
      {laid.map((slice) => <ReviewSliceVideo key={sliceKeyOf(slice)} slice={slice} near={slice === over || slice === next} />)}
      {over && (
        <Box {...stylex.props(styles.tag)}>
          <Readout bright>#{over.thread}{over.pictureOnly && ' picture only'}</Readout>
        </Box>
      )}
    </Box>
  );
}
