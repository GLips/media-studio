import { Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Fragment, type ReactNode } from 'react';
import { formatLibraryLength, librarySourcesOf } from '#lib/footage/library/models/library-item.ts';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useLibraryItemScreen } from './library-item-context.tsx';

const styles = stylex.create({
  header: { flex: 1, minWidth: 0 },
  crumb: { color: colors.dim, paddingInline: spacing.tight, whiteSpace: 'nowrap' },
  // The title keeps its room before the facts give up theirs; a long one gives way at half the bar.
  title: { flexShrink: 0, maxWidth: '50%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.cream, fontWeight: 700 },
  facts: { flex: 1, minWidth: 0, overflow: 'hidden', color: colors.dim, paddingInlineStart: spacing.tight },
  fact: { whiteSpace: 'nowrap' },
  link: { color: colors.dim, textDecorationColor: colors.mark },
  offline: { color: colors.caution, whiteSpace: 'nowrap', cursor: 'default' },
});

/** The day and time footage began, as Graham reads it. */
const recordedOn = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The quiet run after the title: when the item was recorded, its length, its sources, the window its screen recorded,
 * the projects that use it, and whether its media is there.
 */
function LibraryItemFacts() {
  const { view } = useLibraryItemScreen();
  const { item, usedBy, media } = view;
  const facts: { key: string; node: ReactNode }[] = [
    { key: 'recorded', node: recordedOn(item.recordedAt ?? item.addedAt) },
    { key: 'length', node: <Readout>{formatLibraryLength(item.durationSeconds)}</Readout> },
    { key: 'sources', node: librarySourcesOf(item).map(({ label }) => label).join(', ') },
    ...Object.values(item.tracks).flatMap(({ window }) => (window ? [window] : [])).map(({ title, app }) => ({
      key: `window ${app} ${title}`,
      node: <HotkeyTooltip name={`The screen track recorded this window of ${app}`}><Text component="span" inherit>{title ? `${title} — ${app}` : app}</Text></HotkeyTooltip>,
    })),
    ...(usedBy.length > 0
      ? [{
        key: 'used',
        node: <>in {usedBy.map((project, i) => (
          <Fragment key={project}>{i > 0 && ', '}<AnchorLink to="/projects/$project" params={{ project }} inherit {...stylex.props(styles.link)}>{project}</AnchorLink></Fragment>
        ))}</>,
      }]
      : []),
  ];
  return (
    <Group gap="tight" wrap="nowrap" {...stylex.props(styles.facts)}>
      {facts.map(({ key, node }, i) => (
        <Fragment key={key}>
          {i > 0 && <Text component="span" size="sm" aria-hidden>·</Text>}
          <Text component="span" size="sm" {...stylex.props(styles.fact)}>{node}</Text>
        </Fragment>
      ))}
      {!media.online && (
        <HotkeyTooltip name={`${media.path} isn't there`}>
          <Text component="span" size="sm" {...stylex.props(styles.offline)}>· media offline</Text>
        </HotkeyTooltip>
      )}
    </Group>
  );
}

/** The item's part of the bar: `library /`, its title, and its facts, dim after it. */
export function LibraryItemHeader() {
  const { view: { item } } = useLibraryItemScreen();
  return (
    <Group gap="gap" wrap="nowrap" {...stylex.props(styles.header)}>
      <Text component="span" size="sm" {...stylex.props(styles.crumb)}>
        <AnchorLink to="/library" inherit underline="never" c="inherit">Library</AnchorLink> /
      </Text>
      <Text component="span" size="md" title={item.title} {...stylex.props(styles.title)}>{item.title}</Text>
      <LibraryItemFacts />
    </Group>
  );
}
