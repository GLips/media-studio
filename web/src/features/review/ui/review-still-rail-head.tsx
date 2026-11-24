import { Image, Stack, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
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
  // The open still whole, the rail's width up to half the screen: big enough to judge it without leaving the grid, and
  // it says which still the rail's notes are on while the cursor is elsewhere.
  open: { display: 'block', marginBottom: spacing.gap, borderRadius: radius.control, cursor: 'zoom-in' },
  preview: { display: 'block', width: '100%', maxHeight: '50dvh', objectFit: 'contain', objectPosition: 'left center', borderRadius: radius.control },
});

/**
 * `buy-box-og-every-colour-box.png` over its size: which still the rail's notes are on, shown whole above them while
 * the grid has the stage, a click opening it there. Its place in the folder is the grid's footer's to say.
 */
export function ReviewStillRailHead() {
  const { artifact, search, setSearch } = useReviewScreen();
  const stills = useReviewStillSiblings();
  const here = stills.findIndex((s) => s.path === artifact.path);
  const [pixels] = useReviewStillPixels(here < 0 ? [] : [stills[here]]);
  return (
    <Stack gap="hairline" {...stylex.props(styles.head)}>
      {search.view === 'grid' && here >= 0 && (
        <HotkeyTooltip name="Open on the stage">
          <UnstyledButton aria-label="Open on the stage" onClick={() => setSearch({ view: 'stage' })} {...stylex.props(styles.open)}>
            <Image src={stills[here].src} alt="" {...stylex.props(styles.preview)} />
          </UnstyledButton>
        </HotkeyTooltip>
      )}
      <Text component="span" size="md" {...stylex.props(styles.name)}>{artifact.path.slice(artifact.path.lastIndexOf('/') + 1)}</Text>
      {pixels && <Readout>{pixels.w} × {pixels.h}</Readout>}
    </Stack>
  );
}
