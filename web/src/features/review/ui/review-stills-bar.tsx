import { Box, Group } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Grid3x3, LayoutGrid, Scan } from 'lucide-react';
import { nextReviewGuideSet, reviewGuidePlatformOf, type ReviewGuideSet } from '#lib/output/review/models/review-guides.ts';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ReviewProofGroundControl } from './review-proof-ground-control.tsx';
import { useReviewScreen } from './review-screen-context.tsx';

const styles = stylex.create({
  bar: {
    height: spacing.bar, paddingInline: spacing.tight, backgroundColor: colors.panel,
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line,
  },
  rule: { width: '1px', alignSelf: 'stretch', marginBlock: spacing.tight, backgroundColor: colors.line },
  push: { marginInlineStart: 'auto' },
});

/** The guide set on, as the bar names it: the platform set says which platform's chrome it draws. */
function reviewGuideSetLabel(set: ReviewGuideSet, frame: { w: number; h: number } | null): string {
  if (set !== 'platform') return set;
  const platform = frame && reviewGuidePlatformOf(frame);
  return platform ? `platform · ${platform}` : 'platform';
}

/**
 * How large the stage draws the still, against 1:1 (a still pixel to a device pixel). Fit never enlarges a still, so
 * a small one isn't judged soft for the stage's blowing it up.
 */
function reviewStillZoomOf(actual: boolean, frame: { w: number; h: number } | null, stage: { width: number; height: number }): string | null {
  if (actual) return '100%';
  if (!frame || !stage.width || !stage.height) return null;
  return `${Math.round(Math.min(stage.width / frame.w, stage.height / frame.h, 1 / window.devicePixelRatio) * window.devicePixelRatio * 100)}%`;
}

type ReviewStillsBarProps = {
  /** Where the open still stands in its folder, and how many there are; null for a still alone. */
  readonly position: { at: number; of: number } | null;
  readonly grid: boolean;
  /** Whether any still shown lets the ground through: only then are the grounds offered. */
  readonly clear: boolean;
  /** The open still's pixels, once decoded. */
  readonly frame: { w: number; h: number } | null;
  /** The stage's box, for the fitted zoom. */
  readonly stage: { width: number; height: number };
};

/**
 * `▦ 3/25 │ ⌗ platform · story  ⊡ 34% │ ▢▢▢▢▢`: the stills' row under the stage, in the transport's place. Each toggle
 * says what it's set to beside it, the guide set and the zoom; the grounds show only for a still with clear pixels.
 */
export function ReviewStillsBar({ position, grid, clear, frame, stage }: ReviewStillsBarProps) {
  const { search, setSearch, guides, setGuides } = useReviewScreen();
  const zoom = reviewStillZoomOf(search.z === 1, frame, stage);
  return (
    <Group gap="tight" wrap="nowrap" {...stylex.props(styles.bar)}>
      {position && (
        <>
          <IconButton name="Grid" active={grid} onClick={() => setSearch({ view: grid ? 'stage' : 'grid' })}><LayoutGrid size={14} /></IconButton>
          <Readout chars={`${position.of}/${position.of}`.length}>{`${position.at + 1}/${position.of}`}</Readout>
        </>
      )}
      {!grid && (
        <>
          {position && <Box {...stylex.props(styles.rule)} />}
          <IconButton name="Guides" active={guides !== null} onClick={() => setGuides(nextReviewGuideSet)}><Grid3x3 size={14} /></IconButton>
          {guides && <Readout bright>{reviewGuideSetLabel(guides, frame)}</Readout>}
          <IconButton name="Fit / 1:1" active={search.z === 1} onClick={() => setSearch({ z: search.z === 1 ? undefined : 1 })}><Scan size={14} /></IconButton>
          {zoom && <Readout bright={search.z === 1}>{zoom}</Readout>}
        </>
      )}
      {clear && <Box {...stylex.props(styles.push)}><ReviewProofGroundControl /></Box>}
    </Group>
  );
}
