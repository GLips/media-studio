import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Flag } from 'lucide-react';
import { formatLibraryLength } from '#lib/footage/library/models/library-item.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { LibraryShelfItem } from '../controllers/library-reads.ts';
import { LibraryPoster } from './library-poster.tsx';
import { libraryShelfLabelsOf } from './library-shelf-labels.ts';
import { LibraryShelfRow } from './library-shelf-row.tsx';

const styles = stylex.create({
  lines: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: spacing.hairline },
  titleLine: { minWidth: 0, display: 'flex', alignItems: 'center', gap: spacing.gap },
  text: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  title: { flex: 1, fontWeight: 600 },
  said: { color: `color-mix(in srgb, ${colors.cream} 70%, transparent)` },
  dim: { color: colors.dim },
  mark: { color: colors.caution, whiteSpace: 'nowrap' },
  poster: { position: 'relative' },
  // On the poster's corner, as Frame.io and Air carry it, so the title line keeps the width.
  length: {
    position: 'absolute', right: spacing.tight, bottom: spacing.tight, paddingInline: spacing.tight, borderRadius: radius.control,
    backgroundColor: `color-mix(in srgb, ${colors.screen} 80%, transparent)`,
  },
  // The flag glyph with its count, in the caution a flag is drawn in, so it says what it counts.
  flags: { flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: spacing.hairline, color: colors.caution },
  // What the take opens by saying, to two lines: enough to tell it from its neighbours.
  opening: { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden' },
});

/** An item in the shelf's grid: its poster large with its length on the corner, then its title and flag count, then up to two lines of its opening words. */
export function LibraryShelfTile({ shelved, online }: { readonly shelved: LibraryShelfItem; readonly online: boolean }) {
  const { item } = shelved;
  const { title, dateLead, opening, interrupted, flagCount } = libraryShelfLabelsOf(shelved);
  return (
    <LibraryShelfRow item={item.id} layout="tile">
      <Box {...stylex.props(styles.poster)}>
        <LibraryPoster item={item} online={online} size="tile" />
        <Box component="span" {...stylex.props(styles.length)}><Readout bright>{formatLibraryLength(item.durationSeconds)}</Readout></Box>
      </Box>
      <Box {...stylex.props(styles.lines)}>
        <Box {...stylex.props(styles.titleLine)}>
          <Text component="span" size="md" title={item.title} {...stylex.props(styles.text, styles.title)}>{title}</Text>
          {interrupted && <Text component="span" size="sm" {...stylex.props(styles.mark)}>interrupted</Text>}
          {flagCount && (
            <HotkeyTooltip name={flagCount}>
              <Text component="span" size="sm" aria-label={flagCount} {...stylex.props(styles.flags)}><Flag size={12} aria-hidden />{shelved.flags}</Text>
            </HotkeyTooltip>
          )}
        </Box>
        <Text component="span" size="sm" {...stylex.props(styles.opening)}>
          {dateLead && <Text component="span" inherit {...stylex.props(styles.dim)}>{dateLead}{opening && ' · '}</Text>}
          <Text component="span" inherit {...stylex.props(styles.said)}>{opening}</Text>
        </Text>
      </Box>
    </LibraryShelfRow>
  );
}
