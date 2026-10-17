import { Box, Image, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { formatReviewTimecode, REVIEW_READOUT_CHAR_PX, reviewTimelineFrameAt, reviewTimelineXOf, type ReviewTimelineView } from '#lib/output/review/models/review-timeline-geometry.ts';
import { colors, fonts, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { reviewStillUrl } from '#web/shared/media-urls.ts';
import { reviewPlayheadFlagSpanOf } from './review-lane-playhead.tsx';
import { useReviewPlaybackState } from './review-playback-store.ts';
import { useReviewFrame, useReviewScreen } from './review-screen-context.tsx';

/** The preview's width; its height follows the render's aspect. */
const REVIEW_PREVIEW_PX = 160;
/** How long the pointer rests before its frame is cut, so a sweep across the dock doesn't queue a cut per pixel. */
const REVIEW_PREVIEW_REST_MS = 80;
/** Previews snap to this many frames a second, so nearby hovers share their cuts. */
const REVIEW_PREVIEW_PER_SECOND = 4;

/** Where the pointer rests over the lanes, in px from their left; null when it's off them or dragging. */
export type ReviewDockHover = {
  get: () => number | null;
  subscribe: (listener: () => void) => () => void;
};

/**
 * The pointer's place over `lanes`, kept outside React state: only what draws it (the ghost, the ruler hiding a
 * label under the ghost's time) re-renders as it moves, never the whole dock.
 */
export function useReviewDockHover(lanes: HTMLElement | null): ReviewDockHover {
  const [hover] = useState(() => {
    let x: number | null = null;
    const listeners = new Set<() => void>();
    return {
      get: () => x,
      set: (next: number | null) => {
        if (next === x) return;
        x = next;
        for (const listener of listeners) listener();
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    };
  });
  useEffect(() => {
    // The dock is the lanes' parent: the pointer counts from where the lanes start, and leaving the dock ends it.
    const dock = lanes?.parentElement;
    if (!lanes || !dock) return undefined;
    const onMove = (event: PointerEvent) => {
      const at = event.clientX - lanes.getBoundingClientRect().left;
      hover.set(at >= 0 && event.buttons === 0 ? at : null);
    };
    const onLeave = () => hover.set(null);
    dock.addEventListener('pointermove', onMove);
    dock.addEventListener('pointerleave', onLeave);
    return () => {
      dock.removeEventListener('pointermove', onMove);
      dock.removeEventListener('pointerleave', onLeave);
    };
  }, [lanes, hover]);
  return hover;
}

/** The frame under the pointer, re-rendering only as it moves. */
export function useReviewHoverFrame(view: ReviewTimelineView, hover: ReviewDockHover): number | null {
  const x = useSyncExternalStore(hover.subscribe, hover.get, hover.get);
  return x === null ? null : reviewTimelineFrameAt(view, x);
}

/** The ghost's time in the ruler: its words and the span they take, 2px right of the ghost line. */
export function reviewGhostTimeOf(view: ReviewTimelineView, frame: number, fps: number) {
  const text = formatReviewTimecode(frame, fps);
  const x = reviewTimelineXOf(view, frame + 0.5) + 2;
  return { text, x, end: x + (text.length + 1) * REVIEW_READOUT_CHAR_PX };
}

const styles = stylex.create({
  layer: { position: 'absolute', inset: 0, pointerEvents: 'none' },
  ghost: { position: 'absolute', top: 0, bottom: 0, width: '1px', backgroundColor: colors.dim },
  time: {
    position: 'absolute', top: 0, paddingInline: spacing.hairline, fontFamily: fonts.mono, lineHeight: typography.lineHeight, color: colors.dim, backgroundColor: colors.ground, whiteSpace: 'nowrap',
  },
  // Above the dock and the transport, over the stage's foot.
  preview: {
    position: 'absolute', bottom: `calc(100% + ${spacing.bar} + ${spacing.gap})`, width: `${REVIEW_PREVIEW_PX}px`,
    backgroundColor: colors.skeleton, borderRadius: radius.control, overflow: 'hidden', zIndex: 2,
    borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line,
  },
  at: (left: string) => ({ left }),
  sized: (aspect: number) => ({ aspectRatio: aspect }),
});

/**
 * Under the pointer: a dim ghost line through the lanes, its time in the ruler (unless by the resting playhead's
 * flag), and above the dock a 160px frame from the render's own stills.
 */
export function ReviewHoverPreview({ view, hover }: { readonly view: ReviewTimelineView; readonly hover: ReviewDockHover }) {
  const { artifact, timing, playback } = useReviewScreen();
  const resting = useReviewFrame();
  const playing = useReviewPlaybackState(playback, (s) => s.playing);
  const [shown, setShown] = useState<number | null>(null);
  const frame = useReviewHoverFrame(view, hover);
  const step = Math.max(1, Math.round(timing.fps / REVIEW_PREVIEW_PER_SECOND));
  const snapped = frame === null ? null : Math.min(timing.durationInFrames - 1, Math.round(frame / step) * step);
  useEffect(() => {
    const timer = setTimeout(() => setShown(snapped), REVIEW_PREVIEW_REST_MS);
    return () => clearTimeout(timer);
  }, [snapped]);

  if (frame === null) return null;
  const aspect = artifact.frameSize ? artifact.frameSize.w / artifact.frameSize.h : 16 / 9;
  const ghost = reviewTimelineXOf(view, frame + 0.5);
  const ghostTime = reviewGhostTimeOf(view, frame, timing.fps);
  // Within its own width of the resting playhead's flag, the flag already says where the pointer is.
  const flag = playing ? null : reviewPlayheadFlagSpanOf(view, artifact, resting, timing.fps);
  const time = flag && ghostTime.x < flag.end + (ghostTime.end - ghostTime.x) && ghostTime.end > flag.x - (ghostTime.end - ghostTime.x) ? null : ghostTime;
  const previewLeft = Math.max(0, Math.min(view.width - REVIEW_PREVIEW_PX, ghost - REVIEW_PREVIEW_PX / 2));
  return (
    <Box {...stylex.props(styles.layer)}>
      <Box {...stylex.props(styles.ghost, styles.at(`${ghost}px`))} />
      {time && <Text component="span" fz="xs" {...stylex.props(styles.time, styles.at(`${time.x}px`))}>{time.text}</Text>}
      {/* A render with no snapshot has no frame size to cut a preview at. */}
      {artifact.kind === 'video' && artifact.frameSize !== null && (
        <Box {...stylex.props(styles.preview, styles.sized(aspect), styles.at(`${previewLeft}px`))}>
          {shown !== null && <Image src={reviewStillUrl(artifact, shown, timing.fps)} alt="" fit="cover" h="100%" />}
        </Box>
      )}
    </Box>
  );
}
