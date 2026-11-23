import { Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';

/** Marks the rows the arrow keys walk (use-library-shelf-hotkeys.ts). */
export const LIBRARY_SHELF_ROW_ATTRIBUTE = 'data-library-row';

const styles = stylex.create({
  row: {
    display: 'flex', alignItems: 'center', gap: spacing.inset, height: '40px', paddingInline: spacing.gap, minWidth: 0,
    color: colors.cream, textDecoration: 'none', borderRadius: radius.control,
    backgroundColor: {
      default: 'transparent',
      // While the keyboard holds a row, hover lights no other. The attribute is LIBRARY_SHELF_ROW_ATTRIBUTE, spelled
      // out as the compiler needs; the list carries `stylex.defaultMarker()`.
      ':hover': { default: colors.raised, [stylex.when.ancestor(':has([data-library-row]:focus-visible)')]: 'transparent' },
      ':focus-visible': colors.raised,
    },
    outlineColor: colors.cream, outlineStyle: 'solid', outlineOffset: '-1px', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  title: { minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  end: { flexShrink: 0 },
});

type LibraryShelfRowProps = {
  readonly item: string;
  /** Where the item opens: a moment, a flag. */
  readonly at?: { t: number; flag?: number };
  readonly title: ReactNode;
  /** Readouts, right-aligned. */
  readonly end?: ReactNode;
};

/** The shelf's one row, an item or a hit in it: 40px, its words, readouts at the end; it opens the item. */
export function LibraryShelfRow({ item, at, title, end }: LibraryShelfRowProps) {
  return (
    <AnchorLink
      to="/library/$item"
      params={{ item }}
      search={at ? { t: at.t, flag: at.flag } : {}}
      underline="never"
      {...{ [LIBRARY_SHELF_ROW_ATTRIBUTE]: '' }}
      {...stylex.props(styles.row)}
    >
      <Text component="span" size="md" {...stylex.props(styles.title)}>{title}</Text>
      {end && <Group gap="gap" wrap="nowrap" {...stylex.props(styles.end)}>{end}</Group>}
    </AnchorLink>
  );
}
