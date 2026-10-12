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
import { useReviewCompareTarget } from './use-review-compare-target.ts';

/** The scene name's inset from its band's left edge: `spacing.tight`. */
const REVIEW_SCENE_NAME_INSET_PX = 4;

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
  const { other } = useReviewCompareTarget();
  const compared = search.vs === undefined ? undefined : other;
  const { data } = useQuery({ ...reviewArtifactQueryOptions(project, compared?.file ?? ''), enabled: compared !== undefined });
  return data ? reviewMovedCutsOf(artifact.scenes ?? [], data.scenes ?? []) : [];
}

/**
 * The scenes as alternating bands, each named in full until its band cuts it short with an ellipsis. Blocking scenes are hatched, final ones
 * solid; the rung's word is on hover. A double-click loops the scene. Comparing, the other render's moved cuts are
 * faint ticks at the foot.
 */
export function ReviewLaneScenes({ view }: { readonly view: ReviewTimelineView }) {
  const { artifact, timing, playback } = useReviewScreen();
  const movedCuts = useReviewComparedCuts();
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
      {movedCuts.map((frame) => {
        const x = reviewTimelineXOf(view, frame);
        return x >= 0 && x <= view.width && <Box key={frame} aria-hidden {...stylex.props(styles.movedCut, styles.at(`${x}px`))} />;
      })}
    </Box>
  );
}
