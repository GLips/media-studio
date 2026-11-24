import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { createLink, type LinkComponent } from '@tanstack/react-router';
import type { AnchorHTMLAttributes, ReactNode, Ref } from 'react';
import { FadeScroll } from './fade-scroll.tsx';
import { colors, radius, spacing, typography } from './theme.stylex.ts';

/** The icon column every item keeps, so a project's name lines up with the labels above it. */
const ICON_COLUMN = '14px';

const styles = stylex.create({
  layout: { display: 'grid', gridTemplateColumns: `${spacing.sidebarWidth} minmax(0, 1fr)`, height: '100dvh', overflow: 'hidden' },
  sidebar: {
    display: 'grid', gridTemplateRows: `${spacing.bar} minmax(0, 1fr)`, minHeight: 0, backgroundColor: colors.panel,
    borderInlineEndWidth: '1px', borderInlineEndStyle: 'solid', borderInlineEndColor: colors.line,
  },
  // On the header bar's line, so the bar's rule runs on unbroken across the sidebar.
  top: {
    display: 'flex', alignItems: 'center', paddingInline: spacing.inset, fontWeight: 700,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line,
  },
  nav: { display: 'flex', flexDirection: 'column', padding: spacing.gap },
  main: { minWidth: 0, minHeight: 0, overflow: 'hidden' },
  item: {
    display: 'grid', gridTemplateColumns: `${ICON_COLUMN} minmax(0, 1fr) auto`, alignItems: 'center', columnGap: spacing.gap,
    height: spacing.row, paddingInline: spacing.gap, borderRadius: radius.control, textDecoration: 'none',
    fontSize: typography.chrome, lineHeight: typography.lineHeight, color: colors.cream,
    backgroundColor: { default: 'transparent', ':hover': colors.raised, ':focus-visible': colors.raised },
    outlineColor: colors.cream, outlineStyle: 'solid', outlineOffset: '-1px', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  current: { backgroundColor: colors.raised, fontWeight: 600 },
  icon: { display: 'flex', color: colors.dim },
  label: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  count: { color: colors.caution, fontVariantNumeric: 'tabular-nums' },
  section: {
    display: 'flex', justifyContent: 'space-between', color: colors.dim, fontWeight: 600,
    paddingInline: spacing.gap, paddingBlockStart: spacing.row, paddingBlockEnd: spacing.tight,
  },
});

type StudioSidebarFrameProps = {
  /** The sidebar's items, under the studio's name. */
  readonly sidebar: ReactNode;
  /** The page, which brings its own bar (StudioShell). */
  readonly children: ReactNode;
};

/**
 * The index's and the library's frame: the sidebar down the left at full height, the page beside it. The viewers
 * leave it out, as the work there needs the width.
 */
export function StudioSidebarFrame({ sidebar, children }: StudioSidebarFrameProps) {
  return (
    <Box {...stylex.props(styles.layout)}>
      <Box component="aside" {...stylex.props(styles.sidebar)}>
        <Text size="sm" {...stylex.props(styles.top)}>studio</Text>
        <FadeScroll>
          <Box component="nav" {...stylex.props(styles.nav)}>{sidebar}</Box>
        </FadeScroll>
      </Box>
      <Box {...stylex.props(styles.main)}>{children}</Box>
    </Box>
  );
}

/** A dim label over a run of items, with how many there are when that's worth knowing. */
export function StudioSidebarSection({ children, count }: { readonly children: ReactNode; readonly count?: number }) {
  return (
    <Text component="h2" size="sm" {...stylex.props(styles.section)}>
      <span>{children}</span>
      {count !== undefined && count > 0 && <span>{count}</span>}
    </Text>
  );
}

type SidebarAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly ref?: Ref<HTMLAnchorElement>;
  readonly icon?: ReactNode;
  readonly label: string;
  /** What waits on the reviewer there, in caution; none is left out. */
  readonly waiting?: number;
  /** The page showing now: lit, and announced as the current page. */
  readonly current?: boolean;
};

function SidebarAnchor({ icon, label, waiting = 0, current = false, ref, ...anchor }: SidebarAnchorProps) {
  return (
    <a ref={ref} {...anchor} aria-current={current ? 'page' : undefined} {...stylex.props(styles.item, current && styles.current)}>
      <span {...stylex.props(styles.icon)}>{icon}</span>
      <span title={label} {...stylex.props(styles.label)}>{label}</span>
      {waiting > 0 && <span {...stylex.props(styles.count)}>{waiting}</span>}
    </a>
  );
}

const RouterSidebarAnchor = createLink(SidebarAnchor);

/** A sidebar item: its icon, its name and what waits there, as a route link. */
export const StudioSidebarLink: LinkComponent<typeof SidebarAnchor> = (props) => <RouterSidebarAnchor preload="intent" {...props} />;
