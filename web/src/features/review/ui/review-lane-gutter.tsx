import { UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { AudioWaveform, Quote } from 'lucide-react';
import type { ReactNode } from 'react';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, fonts, typography } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewLaneId } from './review-dock.tsx';

/**
 * Each lane's glyph and name; the ruler has none, as it never hides. Voice and sound are drawn as icons: `”` and `∿`
 * are slivers in any font at the gutter's size.
 */
const REVIEW_LANE_GLYPHS: Readonly<Record<Exclude<ReviewLaneId, 'ruler'>, { glyph: ReactNode; name: string }>> = {
  scenes: { glyph: '▤', name: 'Scenes' },
  marks: { glyph: '▽', name: 'Marks' },
  notes: { glyph: '●', name: 'Notes' },
  voice: { glyph: <Quote size={11} />, name: 'Voice' },
  sound: { glyph: <AudioWaveform size={12} />, name: 'Sound' },
};

const styles = stylex.create({
  glyph: {
    width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    fontFamily: fonts.mono, lineHeight: typography.lineHeight,
    color: { default: colors.dim, ':hover': colors.cream }, backgroundColor: { default: 'transparent', ':hover': colors.raised },
    outlineColor: colors.cream, outlineWidth: { default: 0, ':focus-visible': '1px' }, outlineStyle: 'solid', outlineOffset: '-1px',
  },
  hidden: { color: colors.line },
});

type ReviewLaneGutterProps = { readonly lane: Exclude<ReviewLaneId, 'ruler'>; readonly hidden: boolean; readonly onToggle: () => void };

/** A lane's glyph in the dock's left column: named on hover, and a click folds the lane away or brings it back. */
export function ReviewLaneGutter({ lane, hidden, onToggle }: ReviewLaneGutterProps) {
  const { glyph, name } = REVIEW_LANE_GLYPHS[lane];
  return (
    <HotkeyTooltip name={name} hotkey={name}>
      <UnstyledButton aria-label={name} aria-pressed={!hidden} onClick={onToggle} fz="sm" {...stylex.props(styles.glyph, hidden && styles.hidden)}>
        {glyph}
      </UnstyledButton>
    </HotkeyTooltip>
  );
}
