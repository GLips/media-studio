import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { formatLibraryLength } from '#lib/footage/library/models/library-item.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
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
  // A flag's mark, no count: the item has some. Its tooltip says how many.
  dot: { flexShrink: 0, width: '6px', height: '6px', borderRadius: '50%', backgroundColor: colors.caution },
});

/** An item in the shelf's grid: its poster large, then its title, flag dot and length, then its opening words. */
export function LibraryShelfTile({ shelved, online }: { readonly shelved: LibraryShelfItem; readonly online: boolean }) {
  const { item } = shelved;
  const { title, dateLead, opening, interrupted, flagCount } = libraryShelfLabelsOf(shelved);
  return (
    <LibraryShelfRow item={item.id} layout="tile">
      <LibraryPoster item={item} online={online} size="tile" />
      <Box {...stylex.props(styles.lines)}>
        <Box {...stylex.props(styles.titleLine)}>
          <Text component="span" size="md" title={item.title} {...stylex.props(styles.text, styles.title)}>{title}</Text>
          {interrupted && <Text component="span" size="sm" {...stylex.props(styles.mark)}>interrupted</Text>}
          {flagCount && <HotkeyTooltip name={flagCount}><Box role="img" aria-label={flagCount} {...stylex.props(styles.dot)} /></HotkeyTooltip>}
          <Readout>{formatLibraryLength(item.durationSeconds)}</Readout>
        </Box>
        <Text component="span" size="sm" {...stylex.props(styles.text)}>
          {dateLead && <Text component="span" inherit {...stylex.props(styles.dim)}>{dateLead}{opening && ' · '}</Text>}
          <Text component="span" inherit {...stylex.props(styles.said)}>{opening}</Text>
        </Text>
      </Box>
    </LibraryShelfRow>
  );
}
