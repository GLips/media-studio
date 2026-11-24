import { Button, Group, Image, Stack, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { CornerDownLeft } from 'lucide-react';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { REVIEW_OPEN_STILL_HOTKEY } from './review-still-grid.tsx';
import { useReviewScreen } from './review-screen-context.tsx';
import { useReviewStillPixels, useReviewStillSiblings } from './review-still-siblings.ts';

const styles = stylex.create({
  head: {
    flexShrink: 0, paddingInline: spacing.inset, paddingBlock: spacing.gap,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line,
  },
  // The whole name, which the grid shortens: broken anywhere rather than cut, since its tail is what tells variants apart.
  name: { color: colors.cream, fontWeight: 600, overflowWrap: 'anywhere' },
  // The selected still whole, the rail's width up to half the screen: big enough to judge it without leaving the grid.
  open: { display: 'block', marginBottom: spacing.gap, borderRadius: radius.control, cursor: 'zoom-in' },
  label: { flex: 1, minWidth: 0 },
  // Said out loud as well as by the zoom cursor: a click on a tile only selects it, so the rail names the way to open.
  openButton: { flexShrink: 0 },
  preview: { display: 'block', width: '100%', maxHeight: '50dvh', objectFit: 'contain', objectPosition: 'left center', borderRadius: radius.control },
});

/**
 * `buy-box-og-every-colour-box.png` over its size: which still the rail's notes are on, shown whole above them while
 * the grid has the stage, with an Open button (`Enter`) and a click on the picture opening it there. Its place in the
 * folder is the grid's footer's to say.
 */
export function ReviewStillRailHead() {
  const { artifact, search, setSearch } = useReviewScreen();
  const stills = useReviewStillSiblings();
  const here = stills.findIndex((s) => s.path === artifact.path);
  const [pixels] = useReviewStillPixels(here < 0 ? [] : [stills[here]]);
  const grid = search.view === 'grid' && here >= 0;
  const open = () => setSearch({ view: 'stage' });
  return (
    <Stack gap="hairline" {...stylex.props(styles.head)}>
      {grid && (
        <HotkeyTooltip name="Open on the stage" hotkey={REVIEW_OPEN_STILL_HOTKEY}>
          <UnstyledButton aria-label="Open on the stage" onClick={open} {...stylex.props(styles.open)}>
            <Image src={stills[here].src} alt="" {...stylex.props(styles.preview)} />
          </UnstyledButton>
        </HotkeyTooltip>
      )}
      <Group gap="gap" wrap="nowrap" align="flex-start">
        <Stack gap="hairline" {...stylex.props(styles.label)}>
          <Text component="span" size="md" {...stylex.props(styles.name)}>{artifact.path.slice(artifact.path.lastIndexOf('/') + 1)}</Text>
          {pixels && <Readout>{pixels.w} × {pixels.h}</Readout>}
        </Stack>
        {grid && (
          // Enter's hint as the composer's Post button gives it; the tooltip names the key from the registry.
          <HotkeyTooltip name="Open on the stage" hotkey={REVIEW_OPEN_STILL_HOTKEY}>
            <Button size="compact-xs" variant="default" onClick={open} rightSection={<CornerDownLeft size={12} />} {...stylex.props(styles.openButton)}>Open</Button>
          </HotkeyTooltip>
        )}
      </Group>
    </Stack>
  );
}
