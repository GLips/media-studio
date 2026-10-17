import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Fragment } from 'react';
import { colors, fonts, radius, spacing } from './theme.stylex.ts';

const styles = stylex.create({
  strong: { color: colors.cream, fontWeight: 600 },
  code: { fontFamily: fonts.mono, backgroundColor: colors.raised, borderRadius: radius.control, paddingInline: spacing.hairline },
});

/** Bold, emphasis and code spans. */
const STUDIO_INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;

/** A line's inline markdown, as a plan's cells and brief and a note's text are written: `**bold**`, `*emphasis*` and `` `code` ``. */
export function StudioInline({ text }: { readonly text: string }) {
  return text.split(STUDIO_INLINE).map((piece, i) => {
    // oxlint-disable-next-line react/no-array-index-key -- pieces of one fixed string, keyed by their order in it
    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) return <Text key={i} component="strong" inherit {...stylex.props(styles.strong)}>{piece.slice(2, -2)}</Text>;
    // oxlint-disable-next-line react/no-array-index-key -- as above
    if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) return <Text key={i} component="code" size="xs" {...stylex.props(styles.code)}>{piece.slice(1, -1)}</Text>;
    // oxlint-disable-next-line react/no-array-index-key -- as above
    if (piece.startsWith('*') && piece.endsWith('*') && piece.length > 2) return <Text key={i} component="em" inherit>{piece.slice(1, -1)}</Text>;
    // oxlint-disable-next-line react/no-array-index-key -- as above
    return <Fragment key={i}>{piece}</Fragment>;
  });
}
