import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';

/** Marks the rows the arrow keys walk (use-library-shelf-hotkeys.ts). */
export const LIBRARY_SHELF_ROW_ATTRIBUTE = 'data-library-row';

/**
 * The shelf's columns: poster, title (with its second line and its flags), sources, length. The column header and
 * every item row lay out on this one grid, so a column's words sit under its name.
 */
export const libraryShelfColumns = stylex.create({
  grid: {
    display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr) 72px 64px', columnGap: spacing.inset, alignItems: 'center',
    paddingInline: spacing.gap,
  },
  // The shelf page's widest: a title column of about 720px, a reading width, so the sources and length sit close by
  // it rather than across the window; the search above keeps to it too. 96 + 720 + 72 + 64, three column gaps, and
  // a row's padding with the page's inset (row − gap), each side.
  table: { maxWidth: `calc(952px + 3 * ${spacing.inset} + 2 * ${spacing.row})` },
  end: { justifySelf: 'end', textAlign: 'end' },
});

const styles = stylex.create({
  row: {
    height: '40px', minWidth: 0, color: colors.cream, textDecoration: 'none', borderRadius: radius.control,
    backgroundColor: {
      default: 'transparent',
      // While the keyboard holds a row, hover lights no other. The attribute is LIBRARY_SHELF_ROW_ATTRIBUTE, spelled
      // out as the compiler needs; the list carries `stylex.defaultMarker()`.
      ':hover': { default: colors.raised, [stylex.when.ancestor(':has([data-library-row]:focus-visible)')]: 'transparent' },
      ':focus-visible': colors.raised,
    },
    outlineColor: colors.cream, outlineStyle: 'solid', outlineOffset: '-1px', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  // Two lines beside a 54px poster.
  item: { height: '64px' },
  // A poster over its lines, as tall as they make it.
  tile: { display: 'flex', flexDirection: 'column', gap: spacing.tight, height: 'auto', padding: spacing.tight },
  flex: { display: 'flex', alignItems: 'center', gap: spacing.inset, paddingInline: spacing.gap },
});

const LIBRARY_SHELF_LAYOUTS = { columns: [libraryShelfColumns.grid, styles.item], line: styles.flex, tile: styles.tile } as const;

type LibraryShelfRowProps = {
  readonly item: string;
  /** Where the item opens: a moment, a flag. */
  readonly at?: { t: number; flag?: number };
  /** On the shelf's columns (an item in the list), a free line (a search hit), or a grid's tile (an item). */
  readonly layout: 'columns' | 'line' | 'tile';
  readonly children: ReactNode;
};

/**
 * The shelf's one row, an item (64px, two lines, or a grid's tile) or a hit in it (40px): lit on hover or keyboard
 * focus; it opens the item.
 */
export function LibraryShelfRow({ item, at, layout, children }: LibraryShelfRowProps) {
  return (
    <AnchorLink
      to="/library/$item"
      params={{ item }}
      search={at ? { t: at.t, flag: at.flag } : {}}
      underline="never"
      {...{ [LIBRARY_SHELF_ROW_ATTRIBUTE]: '' }}
      {...stylex.props(styles.row, LIBRARY_SHELF_LAYOUTS[layout])}
    >
      {children}
    </AnchorLink>
  );
}
