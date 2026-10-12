import { Box, Text, Tooltip } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useQuery } from '@tanstack/react-query';
import type { ReviewArtifact } from '#lib/output/review/models/review-artifact.ts';
import {
  formatReviewTimecode, reviewTimelineSpan, reviewTimelineXOf, type ReviewTimelineView,
} from '#lib/output/review/models/review-timeline-geometry.ts';
import { colors, fonts, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { reviewArtifactQueryOptions } from '../controllers/review-queries.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { useReviewRenderVersions } from './use-review-render-versions.ts';
import { useReviewSplices } from './use-review-threads.ts';

/** The scene name's inset from its band's left edge: `spacing.tight`. */
const REVIEW_SCENE_NAME_INSET_PX = 4;

const pulse = stylex.keyframes({ from: { opacity: 1 }, to: { opacity: 0.4 } });

const styles = stylex.create({
  lane: { position: 'relative', height: '100%', overflow: 'hidden' },
  scene: {
    position: 'absolute', top: 0, bottom: 0, overflow: 'hidden', cursor: 'pointer',
    paddingInline: spacing.tight, fontFamily: fonts.mono, lineHeight: typography.lineHeight,
    paddingTop: spacing.hairline, whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: { default: colors.dim, ':hover': colors.cream },
  },
  bandA: { backgroundColor: { default: colors.laneA, ':hover': colors.raised } },
  bandB: { backgroundColor: { default: colors.laneB, ':hover': colors.raised } },
  // The blocking rung: 45° stripes over the band, so a scene still blocking reads at a glance without a pill.
  blocking: {
    backgroundImage: `repeating-linear-gradient(45deg, ${colors.hatch} 0 2px, transparent 2px 6px)`,
  },
  // A slice laid in: the other diagonal from blocking's, under a cream hairline, so both can show on one band.
  spliced: {
    position: 'absolute', top: 0, bottom: 0, pointerEvents: 'none', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.cream,
    backgroundImage: `repeating-linear-gradient(-45deg, ${colors.hatch} 0 2px, transparent 2px 6px)`,
  },
  rerendering: {
    // ⟳ at the span's end, clear of the scene's name at its start.
    position: 'absolute', top: 0, bottom: 0, pointerEvents: 'none', paddingInline: spacing.tight, paddingTop: spacing.hairline, textAlign: 'end',
    fontFamily: fonts.mono, lineHeight: typography.lineHeight, color: colors.cream, backgroundColor: colors.rangeWash,
    animationName: pulse, animationDuration: '1.2s', animationIterationCount: 'infinite', animationDirection: 'alternate',
  },
  span: (left: string, width: string) => ({ left, width }),
  // A band begun off the lanes' left edge writes its name from the edge, so a zoomed lane still says where you are.
  pinnedName: (inset: number) => ({ paddingInlineStart: `${inset}px` }),
  // A hairline at the lane's foot, over the bands.
  movedCut: { position: 'absolute', bottom: 0, height: spacing.tight, width: '1px', backgroundColor: colors.dim, pointerEvents: 'none' },
  at: (left: string) => ({ left }),
});

type ReviewScenes = NonNullable<ReviewArtifact['scenes']>;

/**
 * The compared render's cuts that aren't where this render cuts the same scene: retimed, or a scene this render
 * dropped. A cut at 0 never moves.
 */
function reviewMovedCutsOf(shown: ReviewScenes, other: ReviewScenes): number[] {
  const cuts = new Map(shown.map((scene) => [scene.id, scene.from]));
  return other.filter((scene) => scene.from > 0 && cuts.get(scene.id) !== scene.from).map((scene) => scene.from);
}

/** While a version is compared (`vs`), where its cuts were. Its artifact is the one the stage's compare view loads. */
function useReviewComparedCuts(): number[] {
  const { project, artifact, search } = useReviewScreen();
  const { other } = useReviewRenderVersions();
  const compared = search.vs === undefined ? undefined : other;
  const { data } = useQuery({ ...reviewArtifactQueryOptions(project, compared?.file ?? ''), enabled: compared !== undefined });
  return data ? reviewMovedCutsOf(artifact.scenes ?? [], data.scenes ?? []) : [];
}

/**
 * The scenes as alternating bands, named in full until a band cuts the name short. Blocking scenes are hatched, the
 * rung's word on hover; a double-click loops the scene. Comparing, the other render's moved cuts tick the foot. A laid
 * slice cross-hatches its frames; a slice rendering now pulses there with ⟳.
 */
export function ReviewLaneScenes({ view }: { readonly view: ReviewTimelineView }) {
  const { artifact, timing, playback, pulse: { rendering } } = useReviewScreen();
  const movedCuts = useReviewComparedCuts();
  const { laid } = useReviewSplices();
  // The marker's frames are the composition's; the open render's own begin at its startsAt.
  const startsAt = artifact.timing?.startsAt ?? 0;
  const rerendering = artifact.kind === 'video' && rendering?.frames
    && reviewTimelineSpan(view, rendering.frames.from - startsAt, rendering.frames.end - startsAt);
  const loopScene = (from: number, to: number) => {
    playback.setLoop({ from, to: to - 1 });
    playback.seek(from);
    playback.play();
  };
  return (
    <Box {...stylex.props(styles.lane)}>
      {(artifact.scenes ?? []).map((scene, i) => {
        const span = reviewTimelineSpan(view, scene.from, scene.to);
        if (!span) return null;
        const label = [scene.id, scene.rung, `${formatReviewTimecode(scene.from, timing.fps)}–${formatReviewTimecode(scene.to, timing.fps)}`].filter(Boolean).join(' · ');
        return (
          <Tooltip key={scene.id} label={label} openDelay={400} withinPortal position="bottom">
            <Text component="span" fz="xs" onDoubleClick={() => loopScene(scene.from, scene.to)}
              {...stylex.props(styles.scene, i % 2 ? styles.bandB : styles.bandA, scene.rung === 'blocking' && styles.blocking, styles.span(`${span.x}px`, `${span.w}px`),
                span.x < 0 && styles.pinnedName(REVIEW_SCENE_NAME_INSET_PX - span.x))}>
              {scene.id}
            </Text>
          </Tooltip>
        );
      })}
      {laid.map((slice) => {
        const span = reviewTimelineSpan(view, slice.from - startsAt, slice.end - startsAt);
        return span && <Box key={`${slice.hash}:${slice.from}`} aria-hidden {...stylex.props(styles.spliced, styles.span(`${span.x}px`, `${span.w}px`))} />;
      })}
      {rerendering && (
        <Text component="span" fz="xs" aria-label="rendering" {...stylex.props(styles.rerendering, styles.span(`${rerendering.x}px`, `${rerendering.w}px`))}>⟳</Text>
      )}
      {movedCuts.map((frame) => {
        const x = reviewTimelineXOf(view, frame);
        return x >= 0 && x <= view.width && <Box key={frame} aria-hidden {...stylex.props(styles.movedCut, styles.at(`${x}px`))} />;
      })}
    </Box>
  );
}
