import { Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useLibraryItemScreen } from './library-item-context.tsx';

const styles = stylex.create({
  header: { flex: 1, minWidth: 0 },
  crumb: { color: colors.dim, paddingInline: spacing.tight, whiteSpace: 'nowrap' },
  title: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.cream },
  used: { color: colors.dim, whiteSpace: 'nowrap' },
  offline: { color: colors.caution, whiteSpace: 'nowrap', cursor: 'default' },
});

/** The day and time footage began, as Graham reads it. */
const recordedOn = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The item's part of the bar: `library / title`, when it was recorded, its length, the window its screen recorded,
 * and the projects that use it.
 */
export function LibraryItemHeader() {
  const { view } = useLibraryItemScreen();
  const { item, usedBy, media } = view;
  return (
    <Group gap="gap" wrap="nowrap" {...stylex.props(styles.header)}>
      <Text component="span" size="sm" {...stylex.props(styles.crumb)}>
        <AnchorLink to="/library" inherit underline="never" c="inherit">library</AnchorLink> /
      </Text>
      <Text component="span" size="sm" title={item.title} {...stylex.props(styles.title)}>{item.title}</Text>
      <Readout>{recordedOn(item.recordedAt ?? item.addedAt)}</Readout>
      <Readout>{formatReviewClock(item.durationSeconds)}</Readout>
      <Readout>{Object.keys(item.tracks).join('+')}</Readout>
      {Object.values(item.tracks).flatMap(({ window }) => (window ? [window] : [])).map(({ title, app }) => (
        <Text component="span" size="sm" key={`${app} ${title}`} title={`The screen track recorded this window of ${app}`} {...stylex.props(styles.used)}>
          {title ? `${title} — ${app}` : app}
        </Text>
      ))}
      {usedBy.length > 0 && (
        <Text component="span" size="sm" {...stylex.props(styles.used)}>
          in {usedBy.map((project, i) => (
            <Text component="span" inherit key={project}>{i > 0 && ', '}<AnchorLink to="/projects/$project" params={{ project }} inherit c="inherit">{project}</AnchorLink></Text>
          ))}
        </Text>
      )}
      {!media.online && (
        <HotkeyTooltip name={`${media.path} isn't there`}>
          <Text component="span" size="sm" {...stylex.props(styles.offline)}>media offline</Text>
        </HotkeyTooltip>
      )}
    </Group>
  );
}
