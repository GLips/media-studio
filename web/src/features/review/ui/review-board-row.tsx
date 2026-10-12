import { Box, Group, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReviewBoardRow as ReviewBoardRowLayout, ReviewStoryboardStill } from '#lib/output/review/models/review-storyboard.ts';
import { formatReviewTimecode } from '#lib/output/review/models/review-timeline-geometry.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { reviewStillUrl } from '#web/shared/media-urls.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { ReviewStillTile } from './review-still-tile.tsx';
import { ReviewThreadDots } from './review-thread-dots.tsx';
import { REVIEW_BOARD_STILL_ATTRIBUTE } from './use-review-board-cursor.ts';
import type { ReviewProofGround } from './use-review-proof-ground.ts';

/**
 * A tile's least height: the narrowest column holds a still at least this tall, and taller on a taller screen, so a
 * wide Board has fewer, bigger columns rather than a row of one still and five empty tracks.
 */
const REVIEW_BOARD_TILE_MIN_HEIGHT = 'max(112px, 15vh)';
/** The shape a tile holds before the render's frame size is known: the common video frame. */
const REVIEW_BOARD_GUESSED_ASPECT = 16 / 9;

/** Between tiles: `spacing.tight`. */
const REVIEW_BOARD_TILE_GAP = '4px';

const reviewBoardTileMin = (aspect: number) => `calc(${REVIEW_BOARD_TILE_MIN_HEIGHT} * ${Math.max(1, aspect)})`;

const styles = stylex.create({
  row: { paddingBlock: spacing.tight, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line },
  head: {
    position: 'relative', width: '128px', flexShrink: 0, alignSelf: 'stretch',
    paddingBlock: spacing.tight, paddingInlineStart: spacing.inset, paddingInlineEnd: spacing.gap, borderRadius: radius.control,
    cursor: 'pointer', backgroundColor: { default: 'transparent', ':hover': colors.raised },
    outlineColor: colors.cream, outlineOffset: '-1px', outlineStyle: 'solid', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  // The rung, as the scenes lane draws it: a blocked scene's edge is hatched, a finished one's solid.
  rung: { position: 'absolute', insetBlock: 0, insetInlineStart: 0, width: spacing.tight },
  blocking: { backgroundImage: `repeating-linear-gradient(45deg, ${colors.mark} 0 2px, ${colors.hatch} 2px 5px)` },
  final: { backgroundColor: colors.mark },
  id: { color: colors.cream, overflowWrap: 'anywhere' },
  // Every row's tracks are the same, so stills line up in columns down the Board: as many as the fullest row has,
  // sharing the width, until a tile would be narrower than `min`, then as many as fit.
  tiles: (min: string, columns: number) => ({
    flexGrow: 1, minWidth: 0, display: 'grid', gap: REVIEW_BOARD_TILE_GAP,
    gridTemplateColumns: `repeat(auto-fill, minmax(max(${min}, calc((100% - ${columns - 1} * ${REVIEW_BOARD_TILE_GAP}) / ${columns})), 1fr))`,
  }),
  frame: (aspect: number) => ({ width: '100%', aspectRatio: aspect }),
  // Zero wide but stretched to the tile's width: a long caption is clipped to its still, never widening it.
  // The cursor's tile scrolls into view with its caption and a margin, clear of the Board's faded edges.
  still: { scrollMarginBlock: '16px' },
  caption: {
    width: 0, minWidth: '100%', fontFamily: fonts.mono,
    color: colors.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
});

/** What a still is named by under its tile: the scene's own moments first, then a voiced line's id. */
function reviewBoardCaptionOf(still: ReviewStoryboardStill): string {
  const rank = { landmark: 0, cue: 1, line: 2, replay: 3 };
  const names = still.moments.toSorted((a, b) => rank[a.kind] - rank[b.kind]).map((m) => m.name);
  return [...new Set([...names, ...(still.line ? [still.line.id] : [])])].join(' · ');
}

/** A still's tooltip: its frame, each moment with where it falls, and the line's words. */
const reviewBoardStillTitleOf = (still: ReviewStoryboardStill) =>
  [`f${still.frame}`, ...still.moments.map((m) => `${m.name} (${m.at})`), ...(still.line ? [`“${still.line.text}”`] : [])].join(' · ');

type ReviewBoardRowProps = {
  readonly row: ReviewBoardRowLayout;
  readonly aspect: number | null;
  readonly ground: ReviewProofGround | null;
  /** The most stills any row has: the Board's columns, when they fit. */
  readonly columns: number;
  /** The still under the Board's cursor, by its index in this row; null when the cursor is in another row. */
  readonly cursor: number | null;
  /** Seek to the frame and go back to the stage. */
  readonly onOpen: (frame: number) => void;
};

/**
 * A scene on the Board: its id, rung edge, time and note dots, then its stills at the render's aspect. The head opens
 * the scene's first frame; each still, its own. A render without a snapshot has one row with no head.
 */
export function ReviewBoardRow({ row, aspect, columns, ground, cursor, onOpen }: ReviewBoardRowProps) {
  const { artifact, timing: { fps } } = useReviewScreen();
  const { scene } = row;
  const from = Math.max(row.from, 0);
  const span = `${formatReviewTimecode(from, fps)}–${formatReviewTimecode(row.to, fps)}`;
  const shape = aspect ?? REVIEW_BOARD_GUESSED_ASPECT;
  return (
    <Group gap="gap" wrap="nowrap" align="flex-start" {...stylex.props(styles.row)}>
      {scene && (
        <Tooltip label={[scene.rung, span, scene.timing, scene.note].filter(Boolean).join(' · ')} openDelay={400} multiline maw={360}>
          <UnstyledButton onClick={() => onOpen(from)} aria-label={`${scene.id}, ${span}`} {...stylex.props(styles.head)}>
            {scene.rung && <Box {...stylex.props(styles.rung, styles[scene.rung])} />}
            <Stack gap="hairline">
              <Text component="span" size="sm" {...stylex.props(styles.id)}>{scene.id}</Text>
              <Readout>{formatReviewTimecode(from, fps)}</Readout>
              <ReviewThreadDots path={artifact.path} frames={{ from: row.from, to: row.to }} />
            </Stack>
          </UnstyledButton>
        </Tooltip>
      )}
      <Box {...stylex.props(styles.tiles(reviewBoardTileMin(shape), columns))}>
        {row.stills.map((still, i) => (
          <Tooltip key={`${still.frame}:${still.line?.id ?? ''}`} label={reviewBoardStillTitleOf(still)} openDelay={400}>
            <Stack gap={0} {...{ [REVIEW_BOARD_STILL_ATTRIBUTE]: still.frame }} {...stylex.props(styles.still)}>
              <Box {...stylex.props(styles.frame(shape))}>
                <ReviewStillTile src={reviewStillUrl(artifact, still.frame, fps)} label={`f${still.frame}`} aspect={aspect} fill="cell"
                  ground={ground} selected={cursor === i} onClick={() => onOpen(still.frame)} />
              </Box>
              <Text component="span" size="xs" {...stylex.props(styles.caption)}>{reviewBoardCaptionOf(still) || formatReviewTimecode(still.frame, fps)}</Text>
            </Stack>
          </Tooltip>
        ))}
      </Box>
    </Group>
  );
}
