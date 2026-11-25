import { Box, Group, Popover, Stack, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { formatLibraryLength, librarySourcesOf } from '#lib/footage/library/models/library-item.ts';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useLibraryItemScreen } from './library-item-context.tsx';

const styles = stylex.create({
  header: { flex: 1, minWidth: 0 },
  crumb: { color: colors.dim, paddingInline: spacing.tight, whiteSpace: 'nowrap' },
  // The title keeps its room before the facts give up theirs; a long one gives way at half the bar.
  title: { flexShrink: 0, maxWidth: '50%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.cream, fontWeight: 700 },
  facts: { minWidth: 0, color: colors.dim, paddingInlineStart: spacing.tight, whiteSpace: 'nowrap' },
  details: {
    display: 'inline-flex', alignItems: 'center', gap: spacing.hairline, paddingInline: spacing.tight, borderRadius: radius.control,
    color: { default: colors.dim, ':hover': colors.cream }, backgroundColor: { default: 'transparent', ':hover': colors.raised },
    outlineColor: colors.cream, outlineStyle: 'solid', outlineOffset: '1px', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  // Lifted off the ground as a menu is (mantine-theme.ts), which Popover isn't given.
  dropdown: { backgroundColor: colors.panel, borderColor: colors.line, maxWidth: '480px' },
  term: { color: colors.dim },
  link: { color: colors.cream, textDecorationColor: colors.mark },
  offline: { color: colors.caution, whiteSpace: 'nowrap', cursor: 'default' },
});

/** The day and time footage began, as Graham reads it. */
const recordedOn = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The item's facts past its date and length: its sources, the window its screen recorded, the projects that use it. */
function LibraryItemDetails() {
  const { view: { item, usedBy } } = useLibraryItemScreen();
  const windows = Object.values(item.tracks).flatMap(({ window }) => (window ? [window] : []));
  const rows: { term: string; node: ReactNode }[] = [
    { term: 'Sources', node: librarySourcesOf(item).map(({ label }) => label).join(', ') },
    ...windows.map(({ title, app }) => ({ term: 'Window', node: title ? `${title} — ${app}` : app })),
    ...(usedBy.length > 0
      ? [{
        term: 'Used in',
        node: usedBy.map((project, i) => (
          <Fragment key={project}>{i > 0 && ', '}<AnchorLink to="/projects/$project" params={{ project }} inherit {...stylex.props(styles.link)}>{project}</AnchorLink></Fragment>
        )),
      }]
      : []),
  ];
  return (
    <Popover position="bottom-start" withinPortal shadow="md" classNames={{ dropdown: stylex.props(styles.dropdown).className }}>
      <Popover.Target>
        <UnstyledButton {...stylex.props(styles.details)}>
          <Text component="span" size="sm" inherit>Details</Text>
          <ChevronDown size={12} aria-hidden />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="tight">
          {rows.map(({ term, node }, i) => (
            // oxlint-disable-next-line react/no-array-index-key -- the item's facts in one fixed order, never reordered.
            <Box key={i}>
              <Text component="span" size="sm" {...stylex.props(styles.term)}>{term} </Text>
              <Text component="span" size="sm">{node}</Text>
            </Box>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/**
 * The item's part of the bar: `library /`, its title, then dim after it when it was recorded and how long it runs,
 * with the rest behind Details, and whether its media is there.
 */
export function LibraryItemHeader() {
  const { view: { item, media } } = useLibraryItemScreen();
  return (
    <Group gap="gap" wrap="nowrap" {...stylex.props(styles.header)}>
      <Text component="span" size="sm" {...stylex.props(styles.crumb)}>
        <AnchorLink to="/library" inherit underline="never" c="inherit">Library</AnchorLink> /
      </Text>
      <Text component="span" size="md" title={item.title} {...stylex.props(styles.title)}>{item.title}</Text>
      <Text component="span" size="sm" {...stylex.props(styles.facts)}>
        {recordedOn(item.recordedAt ?? item.addedAt)} · <Readout>{formatLibraryLength(item.durationSeconds)}</Readout>
      </Text>
      <LibraryItemDetails />
      {!media.online && (
        <HotkeyTooltip name={`${media.path} isn't there`}>
          <Text component="span" size="sm" {...stylex.props(styles.offline)}>media offline</Text>
        </HotkeyTooltip>
      )}
    </Group>
  );
}
