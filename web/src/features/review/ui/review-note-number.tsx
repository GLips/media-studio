import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { colors, fonts, radius } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  number: {
    display: 'inline-grid', placeItems: 'center', flexShrink: 0, width: '20px', height: '20px', borderRadius: radius.pill,
    backgroundColor: colors.accent, color: colors.ground, fontFamily: fonts.mono, fontWeight: 700,
  },
});

/** A note's number, as its pin, its row and its storyboard card show it. */
export function ReviewNoteNumber({ n, title }: { readonly n: number; readonly title?: string }) {
  return <Text component="span" size="xs" title={title} {...stylex.props(styles.number)}>{n}</Text>;
}
