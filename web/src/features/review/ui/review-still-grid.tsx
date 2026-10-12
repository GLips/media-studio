import { Box, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import { FadeScroll } from '#web/shared/ui/fade-scroll.tsx';
import { colors, fonts, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewStillSibling } from './review-still-siblings.ts';
import { ReviewStillTile } from './review-still-tile.tsx';
import { ReviewThreadDots } from './review-thread-dots.tsx';
import { reviewTileArrowKeys, useReviewBoardHotkeys, type ReviewTileStep } from './use-review-board-hotkeys.ts';
import { useReviewProofGround } from './use-review-proof-ground.ts';

const styles = stylex.create({
  grid: {
    display: 'grid', columnGap: spacing.gap, rowGap: spacing.inset, padding: spacing.inset,
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  },
  cell: { height: '200px' },
  // Cut in the middle: the head gives way, the tail (where variants differ) and the extension stay.
  name: { display: 'flex', justifyContent: 'center', width: 0, minWidth: '100%', fontFamily: fonts.mono, color: colors.dim, whiteSpace: 'nowrap' },
  head: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  tail: { flexShrink: 0 },
  current: { color: colors.cream },
});

/** Characters of the name's stem kept beside its extension when the name is cut. */
const REVIEW_GRID_NAME_TAIL = 4;

/** A file name as the part a narrow cell may cut and the part it always shows: the stem's end and the extension. */
function reviewGridNameParts(name: string): { head: string; tail: string } {
  const dot = name.lastIndexOf('.');
  const cut = Math.max(0, (dot > 0 ? dot : name.length) - REVIEW_GRID_NAME_TAIL);
  return { head: name.slice(0, cut), tail: name.slice(cut) };
}

/** How many columns the grid lays out at its width now: the arrows' up and down move by that many. */
const reviewGridColumnsOf = (grid: HTMLElement | null) => (grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1);

/** The cursor moved along, or by a row of `columns`, held inside the grid. */
const reviewGridStep = (at: number, { along, rows }: ReviewTileStep, columns: number, count: number) =>
  Math.min(Math.max(at + along + rows * columns, 0), count - 1);

type ReviewStillGridProps = {
  readonly stills: readonly ReviewStillSibling[];
  readonly openPath: string;
  /** The stills the ground shows through. */
  readonly clear: ReadonlySet<string>;
  readonly onOpen: (path: string) => void;
};

/**
 * The folder's stills at their own aspects, each with its live notes' dots in the corner. The cursor starts on the
 * open still; the arrows move it, `Enter` or a click opens that still on the stage.
 */
export function ReviewStillGrid({ stills, openPath, clear, onOpen }: ReviewStillGridProps) {
  const [ground] = useReviewProofGround();
  const [cursor, setCursor] = useState(() => Math.max(0, stills.findIndex((s) => s.path === openPath)));
  const grid = useRef<HTMLDivElement>(null);
  const at = Math.min(cursor, stills.length - 1);
  useReviewBoardHotkeys([
    ...reviewTileArrowKeys((step) => setCursor((c) => reviewGridStep(c, step, reviewGridColumnsOf(grid.current), stills.length))),
    { hotkey: 'Enter', name: 'Open', run: () => onOpen(stills[at].path) },
  ], 'still');
  return (
    <FadeScroll>
      <Box ref={grid} {...stylex.props(styles.grid)}>
        {stills.map(({ path, name, src }, i) => {
          const { head, tail } = reviewGridNameParts(name);
          return (
            <Stack key={path} gap="tight">
              <Box {...stylex.props(styles.cell)}>
                <ReviewStillTile src={src} label={name} aspect={null} fill="cell" ground={clear.has(path) ? ground : null}
                  selected={i === at} onClick={() => onOpen(path)} corner={<ReviewThreadDots path={path} />} />
              </Box>
              <Text component="span" size="xs" title={name} {...stylex.props(styles.name, path === openPath && styles.current)}>
                <Box component="span" {...stylex.props(styles.head)}>{head}</Box>
                <Box component="span" {...stylex.props(styles.tail)}>{tail}</Box>
              </Text>
            </Stack>
          );
        })}
      </Box>
    </FadeScroll>
  );
}
