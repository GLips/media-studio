import { Group, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { useReviewStillPixels, useReviewStillSiblings } from './review-still-siblings.ts';

const styles = stylex.create({
  head: {
    flexShrink: 0, paddingInline: spacing.inset, paddingBlock: spacing.gap,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line,
  },
  // The whole name, which the grid shortens: broken anywhere rather than cut, since its tail is what tells variants apart.
  name: { color: colors.cream, fontWeight: 600, overflowWrap: 'anywhere' },
  dim: { color: colors.dim },
});

/** `buy-box-og-every-colour-box.png` over its size and place in the folder: which still the rail's notes are on. */
export function ReviewStillRailHead() {
  const { artifact } = useReviewScreen();
  const stills = useReviewStillSiblings();
  const here = stills.findIndex((s) => s.path === artifact.path);
  const [pixels] = useReviewStillPixels(here < 0 ? [] : [stills[here]]);
  return (
    <Stack gap="hairline" {...stylex.props(styles.head)}>
      <Text component="span" size="md" {...stylex.props(styles.name)}>{artifact.path.slice(artifact.path.lastIndexOf('/') + 1)}</Text>
      <Group gap="tight" wrap="nowrap">
        {pixels && <Readout>{pixels.w} × {pixels.h}</Readout>}
        {pixels && stills.length > 1 && <Text component="span" size="sm" {...stylex.props(styles.dim)}>·</Text>}
        {stills.length > 1 && <Text component="span" size="sm" {...stylex.props(styles.dim)}>{here + 1} of {stills.length}</Text>}
      </Group>
    </Stack>
  );
}
