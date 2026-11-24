import { Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Keyboard, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './icon-button.tsx';
import { useStudioOverlays } from './studio-overlays.tsx';
import { colors, spacing, typography } from './theme.stylex.ts';

const styles = stylex.create({
  // Level with the sidebar's wordmark row, and inset as the page's rows are, so the title sits over their names' edge.
  row: { height: spacing.titleRow, flexShrink: 0, paddingInline: spacing.row, minWidth: 0 },
  title: { fontSize: typography.pageTitle, lineHeight: spacing.bar, fontWeight: 700, color: colors.cream, margin: 0, whiteSpace: 'nowrap' },
  count: { color: colors.dim, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  end: { marginInlineStart: 'auto' },
});

type StudioPageTitleProps = {
  /** The page's name: `Awaiting you`, `Library`. */
  readonly children: ReactNode;
  /** Quiet, beside the name: `28`, `8 recordings`. Left out when there's nothing to count. */
  readonly count?: ReactNode;
};

/**
 * A sidebar page's one title row: its name at the page-title size, a quiet count, then quick-open and the keys at the
 * right, since a sidebar page has no bar (StudioShell). Keep it outside the page's scroll, so its buttons stay put.
 */
export function StudioPageTitle({ children, count }: StudioPageTitleProps) {
  const { openCheatsheet, openQuickOpen } = useStudioOverlays();
  return (
    <Group gap="inset" wrap="nowrap" {...stylex.props(styles.row)}>
      <Group gap="inset" wrap="nowrap" align="baseline">
        <Text component="h1" {...stylex.props(styles.title)}>{children}</Text>
        {count !== undefined && <Text component="span" size="md" {...stylex.props(styles.count)}>{count}</Text>}
      </Group>
      <Group gap="tight" wrap="nowrap" {...stylex.props(styles.end)}>
        <IconButton name="Open…" onClick={openQuickOpen}><Search size={14} /></IconButton>
        <IconButton name="Keys" onClick={openCheatsheet}><Keyboard size={14} /></IconButton>
      </Group>
    </Group>
  );
}
