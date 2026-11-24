import { Image, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { useReviewStillPixels, useReviewStillSiblings } from './review-still-siblings.ts';

const styles = stylex.create({
  head: {
    flexShrink: 0, paddingInline: spacing.inset, paddingBlock: spacing.gap,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line,
  },
  // The whole name, which the grid shortens: broken anywhere rather than cut, since its tail is what tells variants apart.
  name: { color: colors.cream, fontWeight: 600, overflowWrap: 'anywhere' },
  // The open still whole, as big as the rail allows up to a third of the screen: on the grid it says which still the
  // rail's notes are on while the cursor is elsewhere.
  preview: {
    display: 'block', width: '100%', maxHeight: '33dvh', objectFit: 'contain', objectPosition: 'left center',
    marginBottom: spacing.gap, borderRadius: radius.control,
  },
});

/**
 * `buy-box-og-every-colour-box.png` over its size: which still the rail's notes are on, shown whole above them while
 * the grid has the stage. Its place in the folder is the grid's footer's to say.
 */
export function ReviewStillRailHead() {
  const { artifact, search } = useReviewScreen();
  const stills = useReviewStillSiblings();
  const here = stills.findIndex((s) => s.path === artifact.path);
  const [pixels] = useReviewStillPixels(here < 0 ? [] : [stills[here]]);
  return (
    <Stack gap="hairline" {...stylex.props(styles.head)}>
      {search.view === 'grid' && here >= 0 && <Image src={stills[here].src} alt="" {...stylex.props(styles.preview)} />}
      <Text component="span" size="md" {...stylex.props(styles.name)}>{artifact.path.slice(artifact.path.lastIndexOf('/') + 1)}</Text>
      {pixels && <Readout>{pixels.w} × {pixels.h}</Readout>}
    </Stack>
  );
}
