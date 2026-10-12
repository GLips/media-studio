import { Box, Group, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { REVIEW_PROOF_GROUNDS, reviewProofGroundStyles, useReviewProofGround, type ReviewProofGround } from './use-review-proof-ground.ts';

const REVIEW_PROOF_GROUND_NAMES: Readonly<Record<ReviewProofGround, string>> = {
  checker: 'Checkerboard', coral: 'Coral', navy: 'Navy', white: 'White', black: 'Black',
};

const styles = stylex.create({
  bar: {
    padding: spacing.hairline, borderRadius: radius.control, backgroundColor: colors.panel,
    borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line,
  },
  swatchButton: {
    padding: spacing.hairline, borderRadius: radius.control, cursor: 'pointer',
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
    outlineColor: colors.cream, outlineOffset: '1px', outlineStyle: 'solid', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  // Edged, so a dark ground still reads against the bar.
  swatch: {
    display: 'block', boxSizing: 'border-box', width: '12px', height: '12px', borderRadius: radius.control,
    borderWidth: '1px', borderStyle: 'solid', borderColor: colors.mark,
  },
  // The checkerboard at a swatch's scale, so the group leads with the sign for "what shows behind".
  checkerSwatch: { backgroundSize: '6px 6px' },
  // The ground in use: a 2px inner cream edge, as every selected thing has.
  chosen: { outlineColor: colors.cream, outlineStyle: 'solid', outlineWidth: '2px', outlineOffset: '-2px' },
});

/**
 * The grounds a transparent picture is proofed over, as swatches. Buttons, not a radio group: a focused radio is an
 * input to the hotkeys, and every key after the click would go to it.
 */
export function ReviewProofGroundControl() {
  const [ground, setGround] = useReviewProofGround();
  return (
    <Group gap={0} wrap="nowrap" role="group" aria-label="Ground" {...stylex.props(styles.bar)}>
      {REVIEW_PROOF_GROUNDS.map((g) => (
        <HotkeyTooltip key={g} name={REVIEW_PROOF_GROUND_NAMES[g]}>
          <UnstyledButton aria-label={REVIEW_PROOF_GROUND_NAMES[g]} aria-pressed={g === ground} onClick={() => setGround(g)} {...stylex.props(styles.swatchButton)}>
            <Box component="span" {...stylex.props(styles.swatch, reviewProofGroundStyles[g], g === 'checker' && styles.checkerSwatch, g === ground && styles.chosen)} />
          </UnstyledButton>
        </HotkeyTooltip>
      ))}
    </Group>
  );
}
