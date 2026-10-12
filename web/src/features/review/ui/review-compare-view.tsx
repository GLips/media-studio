import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useQuery } from '@tanstack/react-query';
import { useState, type MouseEvent, type PointerEvent } from 'react';
import { placeReviewMoment, reviewMomentAt, type ReviewTiming } from '#lib/output/review/models/review-moment.ts';
import { reviewMediaUrl } from '#web/shared/media-urls.ts';
import { useLinkedMediaFollower } from '#web/shared/ui/linked-media-clock.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { reviewArtifactQueryOptions } from '../controllers/review-queries.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { reviewIsProofed, reviewProofGroundStyles, useReviewProofGround } from './use-review-proof-ground.ts';
import type { ReviewComparedVersion } from './use-review-render-versions.ts';

const REVIEW_WIPE_MIDDLE = 0.5;

const styles = stylex.create({
  layer: { position: 'absolute', inset: 0 },
  media: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  hidden: { opacity: 0 },
  wiped: (w: number) => ({ clipPath: `inset(0 ${(1 - w) * 100}% 0 0)` }),
  grip: (w: number) => ({ left: `${w * 100}%` }),
  // A 12px grip around a hairline: the line is what's seen, the grip (and the tag at its foot) what's grabbed.
  gripArea: {
    position: 'absolute', top: 0, bottom: 0, width: spacing.inset, transform: 'translateX(-50%)', cursor: 'ew-resize',
    display: 'flex', justifyContent: 'center', touchAction: 'none', backgroundColor: { default: 'transparent', ':hover': colors.rangeWash },
  },
  hairline: { width: '1px', height: '100%', backgroundColor: colors.cream },
  tag: {
    position: 'absolute', bottom: spacing.tight, paddingInline: spacing.tight, backgroundColor: colors.ground,
    borderRadius: radius.control, whiteSpace: 'nowrap', pointerEvents: 'none',
  },
  tagUnderGrip: { left: '50%', transform: 'translateX(-50%)', pointerEvents: 'auto' },
  tagLeft: { left: spacing.tight },
});

/** A pane's `r13` at its foot: side by side, each pane has its own. */
export function ReviewVersionTag({ label }: { readonly label: string }) {
  return <Box {...stylex.props(styles.tag, styles.tagLeft)}><Readout bright>{label}</Readout></Box>;
}

/**
 * The other render's frame for `frame` on this one: the same moment (scene, beat, word or cue) placed on its timing,
 * so a retimed cut still lines up. Without both timings, or off every scene, the same frame number.
 */
function reviewComparedFrameOf(frame: number, shown: ReviewTiming | undefined, other: ReviewTiming | undefined): number {
  if (!shown || !other) return frame;
  const moment = reviewMomentAt(frame + shown.startsAt, shown);
  if (!moment) return frame;
  const placed = placeReviewMoment(moment, other);
  return 'frame' in placed ? placed.frame - other.startsAt : frame;
}

type ReviewCompareViewProps = {
  readonly version: ReviewComparedVersion;
  /** `flip` sits over the frame, seen while `\` is held; `wipe` shows its left part; `side` fills its own pane. */
  readonly layer: 'flip' | 'wipe' | 'side';
  readonly held: boolean;
  /** `r13`, and the open render's `r14`, for the tags. */
  readonly labels: { readonly other: string; readonly shown: string };
};

/**
 * The version compared against, a follower of the review's clock over the whole render, kept in step by moment.
 * Muted: the open render is the one heard.
 * A wipe's hairline drags across the frame, `r13 | r14` at its foot.
 */
export function ReviewCompareView({ version, layer, held, labels }: ReviewCompareViewProps) {
  const { project, artifact, playback, timing, search, setSearch } = useReviewScreen();
  const { data: other } = useQuery(reviewArtifactQueryOptions(project, version.file));
  const [video, attachVideo] = useState<HTMLVideoElement | null>(null);
  const [proofGround] = useReviewProofGround();
  // Its own ground, not the frame box's: flipped or wiped over the open render, a transparent render's clear areas
  // would otherwise show that render through. Until it loads, a version of the same path is judged by the open one.
  const ground = reviewIsProofed(other ?? artifact) ? reviewProofGroundStyles[proofGround] : null;
  const [wipe, setWipe] = useState(search.w ?? REVIEW_WIPE_MIDDLE);
  const last = other?.durationInFrames ?? Infinity;
  const frameOf = (frame: number) => Math.max(0, Math.min(last - 1, reviewComparedFrameOf(frame, artifact.timing, other?.timing)));
  useLinkedMediaFollower(playback, video, { fps: other?.fps ?? timing.fps, span: null, frameOf });

  const dragWipe = (e: PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!box || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setWipe(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)));
  };
  // The frame box under the grip pins the draft on a press: the grip's press, release and click are its own.
  const grabWipe = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: dragWipe,
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      e.stopPropagation();
      setSearch({ w: wipe });
    },
    onClick: (e: MouseEvent<HTMLElement>) => e.stopPropagation(),
  };
  const shown = layer !== 'flip' || held;
  return (
    <Box {...stylex.props(styles.layer)}>
      <Box component="video" ref={attachVideo} src={reviewMediaUrl({ project, path: version.file, render: { hash: version.hash } })}
        muted playsInline preload="auto" {...stylex.props(styles.media, ground, !shown && styles.hidden, layer === 'wipe' && !held && styles.wiped(wipe))} />
      {layer === 'wipe' && !held && (
        <Box {...grabWipe} {...stylex.props(styles.gripArea, styles.grip(wipe))}>
          <Box {...stylex.props(styles.hairline)} />
          <Box {...stylex.props(styles.tag, styles.tagUnderGrip)}><Readout bright>{labels.other} | {labels.shown}</Readout></Box>
        </Box>
      )}
      {shown && (layer !== 'wipe' || held) && <ReviewVersionTag label={labels.other} />}
    </Box>
  );
}
