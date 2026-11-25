import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { createLink, type LinkComponent } from '@tanstack/react-router';
import { createContext, useContext, useLayoutEffect, useRef, type AnchorHTMLAttributes, type ReactNode, type Ref } from 'react';
import { FadeScroll } from './fade-scroll.tsx';
import { colors, radius, spacing, typography } from './theme.stylex.ts';

/** A page's icon column. A project has none, so its name starts at the edge the Projects heading and filter share. */
const ICON_COLUMN = '14px';

const styles = stylex.create({
  layout: { display: 'grid', gridTemplateColumns: `${spacing.sidebarWidth} minmax(0, 1fr)`, height: '100dvh', overflow: 'hidden' },
  sidebar: {
    display: 'grid', gridTemplateRows: `${spacing.titleRow} minmax(0, 1fr)`, minHeight: 0, backgroundColor: colors.panel,
    borderInlineEndWidth: '1px', borderInlineEndStyle: 'solid', borderInlineEndColor: colors.line,
  },
  // Level with the page's title (StudioPageTitle), set over the items' icons.
  wordmark: {
    display: 'flex', alignItems: 'center', paddingInline: `calc(${spacing.gap} * 2)`,
    fontSize: typography.pageTitle, lineHeight: spacing.bar, fontWeight: 900, letterSpacing: '-0.03em', color: colors.cream,
  },
  body: { display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', minHeight: 0 },
  head: { display: 'flex', flexDirection: 'column', paddingInline: spacing.gap },
  nav: { display: 'flex', flexDirection: 'column', paddingInline: spacing.gap, paddingBlockEnd: spacing.gap },
  main: { minWidth: 0, minHeight: 0, overflow: 'hidden' },
  item: {
    display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', columnGap: spacing.gap,
    height: spacing.row, paddingInline: spacing.gap, borderRadius: radius.control, textDecoration: 'none',
    fontSize: typography.chrome, lineHeight: typography.lineHeight, color: colors.cream,
    backgroundColor: { default: 'transparent', ':hover': colors.raised, ':focus-visible': colors.raised },
    outlineColor: colors.cream, outlineStyle: 'solid', outlineOffset: '-1px', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  current: { backgroundColor: colors.raised, fontWeight: 600 },
  withIcon: { gridTemplateColumns: `${ICON_COLUMN} minmax(0, 1fr) auto` },
  icon: { display: 'flex', color: colors.dim },
  label: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  count: { color: colors.caution, fontVariantNumeric: 'tabular-nums' },
  section: {
    display: 'flex', justifyContent: 'space-between', color: colors.dim, fontWeight: 600,
    paddingInline: spacing.gap, paddingBlockStart: spacing.row, paddingBlockEnd: spacing.tight,
  },
  // A run inside a section's list (a month of projects): set closer to the run above, in the items' size.
  nested: { paddingBlockStart: spacing.gap, fontSize: typography.chrome },
});

/** True inside StudioSidebarFrame: the page's StudioShell then draws no bar, its title row (StudioPageTitle) the bar's stand-in. */
const StudioSidebarContext = createContext(false);

export const useInStudioSidebar = () => useContext(StudioSidebarContext);

type StudioSidebarFrameProps = {
  /** Under the wordmark: a StudioSidebarBody. */
  readonly sidebar: ReactNode;
  /** The page, which titles itself (StudioPageTitle). */
  readonly children: ReactNode;
};

/**
 * The index's, the library's and a project page's frame: the sidebar down the left at full height, the page beside
 * it. The viewers leave it out, as the work there needs the width.
 */
export function StudioSidebarFrame({ sidebar, children }: StudioSidebarFrameProps) {
  return (
    <Box {...stylex.props(styles.layout)}>
      <Box component="aside" {...stylex.props(styles.sidebar)}>
        <Text component="span" {...stylex.props(styles.wordmark)}>studio</Text>
        {sidebar}
      </Box>
      <StudioSidebarContext value>
        <Box {...stylex.props(styles.main)}>{children}</Box>
      </StudioSidebarContext>
    </Box>
  );
}

type StudioSidebarBodyProps = {
  /** Fixed: the pages, a list's heading and filter. */
  readonly head: ReactNode;
  /** Under the head, scrolling on its own: the projects. */
  readonly list: ReactNode;
};

/**
 * Where the list was scrolled to. Each sidebar page is its own route, so moving between them mounts a new sidebar;
 * it picks up here, so a project clicked far down the list stays where it was.
 */
const sidebarListScroll = { top: 0 };

/** The sidebar under its wordmark: what stays put, then the list that scrolls. */
export function StudioSidebarBody({ head, list }: StudioSidebarBodyProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = sidebarListScroll.top;
  }, []);
  return (
    <Box component="nav" {...stylex.props(styles.body)}>
      <Box {...stylex.props(styles.head)}>{head}</Box>
      <FadeScroll viewportRef={viewportRef} onScroll={() => { sidebarListScroll.top = viewportRef.current?.scrollTop ?? 0; }}>
        <Box {...stylex.props(styles.nav)}>{list}</Box>
      </FadeScroll>
    </Box>
  );
}

type StudioSidebarSectionProps = {
  readonly children: ReactNode;
  readonly count?: number;
  /** A run within a section's list, a level under its heading. */
  readonly nested?: boolean;
};

/** A dim label over a run of items, with how many there are when that's worth knowing. */
export function StudioSidebarSection({ children, count, nested = false }: StudioSidebarSectionProps) {
  return (
    <Text component={nested ? 'h3' : 'h2'} size="sm" {...stylex.props(styles.section, nested && styles.nested)}>
      <span>{children}</span>
      {count !== undefined && count > 0 && <span>{count}</span>}
    </Text>
  );
}

type SidebarAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly ref?: Ref<HTMLAnchorElement>;
  readonly icon?: ReactNode;
  readonly label: ReactNode;
  /** What waits on the reviewer there, in caution; none is left out. */
  readonly waiting?: number;
  /** The page showing now: lit, and announced as the current page. */
  readonly current?: boolean;
};

function SidebarAnchor({ icon, label, waiting = 0, current = false, ref, ...anchor }: SidebarAnchorProps) {
  return (
    <a ref={ref} {...anchor} aria-current={current ? 'page' : undefined} {...stylex.props(styles.item, icon !== undefined && styles.withIcon, current && styles.current)}>
      {icon !== undefined && <span {...stylex.props(styles.icon)}>{icon}</span>}
      <span {...stylex.props(styles.label)}>{label}</span>
      {waiting > 0 && <span {...stylex.props(styles.count)}>{waiting}</span>}
    </a>
  );
}

const RouterSidebarAnchor = createLink(SidebarAnchor);

/** A sidebar item: its icon, its name and what waits there, as a route link. A truncated name's whole is its `title`. */
export const StudioSidebarLink: LinkComponent<typeof SidebarAnchor> = (props) => <RouterSidebarAnchor preload="intent" {...props} />;
