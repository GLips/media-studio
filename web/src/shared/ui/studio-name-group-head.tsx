import { Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { colors } from './theme.stylex.ts';

const styles = stylex.create({
  head: { color: colors.dim },
  start: { color: colors.cream, fontWeight: 600 },
});

/**
 * `03-menu-appstore-iphone-* · 5` over a grid's group of pictures whose names start alike (studioNameGroupsOf): the
 * start they share, cream, then how many, dim. Their captions leave that start out.
 */
export function StudioNameGroupHead({ head, count }: { readonly head: string; readonly count: number }) {
  return (
    <Group gap="tight" wrap="nowrap" {...stylex.props(styles.head)}>
      <Text component="span" size="sm" {...stylex.props(styles.start)}>{head}*</Text>
      <Text component="span" size="sm">· {count}</Text>
    </Group>
  );
}
