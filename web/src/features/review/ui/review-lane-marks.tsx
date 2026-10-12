import { Box, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import type { ReviewTimingMarks } from '#lib/output/review/models/review-storyboard.ts';
import { formatReviewTimecode, REVIEW_READOUT_CHAR_PX, reviewTimelineXOf, type ReviewTimelineView } from '#lib/output/review/models/review-timeline-geometry.ts';
import { colors, fonts, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { useReviewScreen } from './review-screen-context.tsx';

/** A moment the marks lane draws: a voiced line is the voice lane's. */
type ReviewMarkMoment = ReviewTimingMarks['moments'][number] & { kind: 'cue' | 'replay' | 'landmark' };

/** Each kind's glyph, hollow at rest and filled under the pointer. */
const REVIEW_MARK_GLYPHS: Readonly<Record<ReviewMarkMoment['kind'], readonly [string, string]>> = {
  cue: ['▽', '▼'],
  replay: ['◁', '◀'],
  landmark: ['△', '▲'],
};

/** The glyph's own width, centred on its frame (the mark's -5px margin). */
const REVIEW_MARK_GLYPH_PX = 10;

const styles = stylex.create({
  lane: { position: 'relative', height: '100%', overflow: 'hidden' },
  mark: {
    position: 'absolute', top: 0, height: '100%', display: 'flex', alignItems: 'center', gap: spacing.hairline,
    marginLeft: '-5px', paddingRight: spacing.tight, cursor: 'pointer',
    fontFamily: fonts.mono, lineHeight: typography.lineHeight, whiteSpace: 'nowrap',
    color: { default: colors.mark, ':hover': colors.cream },
    outlineColor: colors.cream, outlineWidth: { default: 0, ':focus-visible': '1px' }, outlineStyle: 'solid',
  },
  name: { color: colors.dim },
  at: (left: string) => ({ left }),
});

/**
 * Marks drawn closer than a glyph apart, as one: they'd stack, and only the top one could be reached. A cluster's
 * `×N` count takes room too, so it swallows any mark that would land on its count.
 */
type ReviewMarkCluster = { x: number; moments: ReviewMarkMoment[] };

const reviewMarkClusterLabelOf = (moments: readonly ReviewMarkMoment[]) => moments.length > 1 ? `×${moments.length}` : moments[0].name;

/** How far right of its frame a cluster draws: the glyph, and its count when it has one. */
const reviewMarkClusterReach = (cluster: ReviewMarkCluster) =>
  REVIEW_MARK_GLYPH_PX + (cluster.moments.length > 1 ? (reviewMarkClusterLabelOf(cluster.moments).length + 1) * REVIEW_READOUT_CHAR_PX : 0);

function reviewMarkClustersOf(moments: readonly ReviewMarkMoment[], view: ReviewTimelineView): ReviewMarkCluster[] {
  const clusters: ReviewMarkCluster[] = [];
  for (const moment of moments) {
    const x = reviewTimelineXOf(view, moment.frame + 0.5);
    if (x < -REVIEW_MARK_GLYPH_PX || x > view.width) continue;
    const last = clusters.at(-1);
    if (last && x - last.x < reviewMarkClusterReach(last)) last.moments.push(moment);
    else clusters.push({ x, moments: [moment] });
  }
  return clusters;
}

/**
 * The timeline's named moments: ▽ cues, ◁ replays, △ landmarks, in structure grey. A name is drawn while it fits
 * before the next mark and the next cut, else it's on hover; marks too close to tell apart are one glyph with a count, every name in
 * its tooltip. A click seeks to the (first) mark.
 */
export function ReviewLaneMarks({ view }: { readonly view: ReviewTimelineView }) {
  const { artifact, timing, playback } = useReviewScreen();
  const [hot, setHot] = useState<string | null>(null);
  const moments = (artifact.marks?.moments ?? []).filter((m): m is ReviewMarkMoment => m.kind !== 'line').toSorted((a, b) => a.frame - b.frame);
  const clusters = reviewMarkClustersOf(moments, view);
  const cuts = (artifact.scenes ?? []).slice(1).map((scene) => reviewTimelineXOf(view, scene.from));
  const describe = (m: ReviewMarkMoment) => `${m.scene}.${m.name} · ${m.kind} · ${formatReviewTimecode(m.frame, timing.fps)}`;
  return (
    <Box {...stylex.props(styles.lane)}>
      {clusters.map(({ x, moments: here }, i) => {
        const [moment] = here;
        // A name stops at the next mark or the next cut, whichever comes first: past a cut it'd read as the next scene's.
        const cut = cuts.find((c) => c > x + REVIEW_MARK_GLYPH_PX / 2) ?? view.width;
        const room = Math.min(clusters[i + 1]?.x ?? view.width, cut) - x - 2 * REVIEW_MARK_GLYPH_PX;
        // A cue can be marked twice on one frame, once per kind (a hit and a hold).
        const key = `${moment.kind}:${moment.scene}.${moment.name}@${moment.frame}`;
        const [hollow, filled] = REVIEW_MARK_GLYPHS[moment.kind];
        const label = reviewMarkClusterLabelOf(here);
        return (
          <Tooltip key={key} label={<Stack gap={0}>{here.map((m) => <Text key={describe(m)} component="span" size="sm">{describe(m)}</Text>)}</Stack>} openDelay={400} withinPortal>
            <UnstyledButton aria-label={here.map((m) => `${m.kind} ${m.name}`).join(', ')} onClick={() => playback.seek(moment.frame)}
              onPointerEnter={() => setHot(key)} onPointerLeave={() => setHot(null)} fz="xs" {...stylex.props(styles.mark, styles.at(`${x}px`))}>
              {hot === key ? filled : hollow}
              {(here.length > 1 || room >= label.length * REVIEW_READOUT_CHAR_PX) && <Text component="span" inherit {...stylex.props(styles.name)}>{label}</Text>}
            </UnstyledButton>
          </Tooltip>
        );
      })}
    </Box>
  );
}
