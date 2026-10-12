import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { colors, radius } from './theme.stylex.ts';

const styles = stylex.create({
  tile: { maxWidth: '100%', maxHeight: '100%', backgroundColor: colors.skeleton, borderRadius: radius.control },
  sized: (aspect: number) => ({ aspectRatio: aspect }),
});

/** A picture not there yet, at the shape it will have: a still being cut, a page loading. Never a spinner. */
export function SkeletonTile({ aspect }: { readonly aspect: number }) {
  return <Box aria-busy {...stylex.props(styles.tile, styles.sized(aspect))} />;
}
