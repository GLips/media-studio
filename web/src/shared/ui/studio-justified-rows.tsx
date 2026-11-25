import { Box } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import * as stylex from '@stylexjs/stylex';
import { Fragment, type ReactNode } from 'react';
import { studioJustifiedRowsOf } from '../studio-collection-arrangement.ts';

const styles = stylex.create({
  rows: { display: 'flex', flexDirection: 'column', minWidth: 0, width: '100%' },
  // Nowrap and clipped: a row's widths are fractional, and a sub-pixel overshoot must not wrap its last tile.
  row: { display: 'flex', flexWrap: 'nowrap', alignItems: 'flex-start', overflow: 'hidden' },
  gaps: (gap: number) => ({ rowGap: `${gap}px`, columnGap: `${gap}px` }),
});

type StudioJustifiedRowsProps = {
  /** Each picture's width over height, in the order they lay out. */
  readonly aspects: readonly number[];
  /** The height a row's pictures stand at before it scales to fill the width. */
  readonly target: number;
  /** Between tiles and between rows, in px. */
  readonly gap: number;
  /** How much wider a tile is than its picture (its padding), so the pictures, not the tiles, fill the width. */
  readonly tileInset?: number;
  readonly tileKeyOf: (index: number) => string;
  /** The tile for picture `index`, its picture drawn at `width` × `height`; it mustn't shrink (`flexShrink: 0`). */
  readonly renderTile: (index: number, width: number, height: number) => ReactNode;
};

/**
 * Pictures in justified rows, Google Photos' way: each row's pictures share a height and keep their own shapes, and
 * the row scales to fill the width exactly; a short last row stays at the target (studioJustifiedRowsOf).
 */
export function StudioJustifiedRows({ aspects, target, gap, tileInset = 0, tileKeyOf, renderTile }: StudioJustifiedRowsProps) {
  const { ref, width } = useElementSize();
  // A tile's inset counts as gap between pictures, and once at the row's end.
  const rows = width > 0 ? studioJustifiedRowsOf(aspects, width - tileInset, target, gap + tileInset) : [];
  return (
    <Box ref={ref} {...stylex.props(styles.rows, styles.gaps(gap))}>
      {rows.map((row) => (
        <Box key={tileKeyOf(row.indices[0])} {...stylex.props(styles.row, styles.gaps(gap))}>
          {row.indices.map((i) => <Fragment key={tileKeyOf(i)}>{renderTile(i, aspects[i] * row.height, row.height)}</Fragment>)}
        </Box>
      ))}
    </Box>
  );
}
