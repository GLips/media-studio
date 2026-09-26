import { Paper, Text, Title } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { shadows } from '#web/shared/ui/shadows.ts';
import { colors, fonts, spacing } from '#web/shared/ui/theme.stylex.ts';

const stampLand = stylex.keyframes({
  from: { transform: 'rotate(-12deg) scale(1.8)', opacity: 0 },
  to: { transform: 'rotate(-4deg) scale(1)', opacity: 1 },
});

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

const styles = stylex.create({
  // Pinned at the head of the controls column as it scrolls, so a dragged slider and the verdict it flips are always
  // on screen together.
  verdict: {
    // Above the sliders' thumbs, which Mantine lifts with a z-index of their own.
    position: 'sticky', top: 0, zIndex: 10, backgroundColor: colors.panel, padding: `${spacing.gap} ${spacing.inset}`,
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: spacing.gap,
    borderLeftWidth: '6px', borderLeftStyle: 'solid', transition: 'border-color 0.15s',
  },
  pass: { borderLeftColor: colors.pass, color: colors.pass },
  fail: { borderLeftColor: colors.accent, color: colors.accent },
  stamp: {
    display: 'inline-block', fontFamily: fonts.display, lineHeight: 1, fontWeight: 900, color: 'inherit', fontStretch: '75%',
    textTransform: 'uppercase', letterSpacing: '0.04em', padding: '4px 14px 2px', borderWidth: '4px', borderStyle: 'solid',
    borderColor: 'currentColor', borderRadius: '6px', transform: 'rotate(-4deg)',
    animationName: { default: stampLand, [REDUCED_MOTION]: 'none' },
    animationDuration: '0.32s', animationTimingFunction: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)',
  },
  // Room for the longest reason, so the verdict doesn't change height and slide the preset buttons out from under a click.
  plain: { color: colors.cream, lineHeight: 1.45, minHeight: 'calc(var(--mantine-font-size-sm) * 1.45 * 8)' },
});

/** The check's verdict on the lab's scene: a stamp that lands again on every flip, and its reason in plain words. */
export function LabHoldVerdict({ pass, explanation }: { readonly pass: boolean; readonly explanation: string }) {
  return (
    <Paper component="section" aria-live="polite" {...stylex.props(styles.verdict, shadows.cardLift, pass ? styles.pass : styles.fail)}>
      {/* Re-keyed on a flip, so the stamp's landing plays again. */}
      <Title key={pass ? 'pass' : 'fail'} order={2} component="span" {...stylex.props(styles.stamp)}>{pass ? 'Pass' : 'Fail'}</Title>
      <Text size="sm" {...stylex.props(styles.plain)}>{explanation}</Text>
    </Paper>
  );
}
