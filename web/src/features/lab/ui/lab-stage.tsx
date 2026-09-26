import { Box, Text } from '@mantine/core';
import { Player } from '@remotion/player';
import * as stylex from '@stylexjs/stylex';
import type { ComponentType } from 'react';
import { LAB_FORMAT } from '#studio/lab/lab-format.ts';
import { colors, fonts, spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  // A stage sits in HUD brackets, as the showcase frames its shots.
  stage: {
    position: 'relative', padding: '10px',
    '::before': { content: '""', position: 'absolute', top: 0, left: 0, width: '22px', height: '22px', borderTopWidth: '2px', borderTopStyle: 'solid', borderTopColor: colors.cream, borderLeftWidth: '2px', borderLeftStyle: 'solid', borderLeftColor: colors.cream, pointerEvents: 'none' },
    '::after': { content: '""', position: 'absolute', bottom: 0, right: 0, width: '22px', height: '22px', borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: colors.cream, borderRightWidth: '2px', borderRightStyle: 'solid', borderRightColor: colors.cream, pointerEvents: 'none' },
  },
  label: {
    position: 'absolute', top: '-8px', left: '34px', paddingInline: spacing.tight, backgroundColor: colors.ground,
    fontFamily: fonts.mono, letterSpacing: '0.08em', textTransform: 'uppercase', color: colors.dim,
  },
  player: { borderRadius: '4px', overflow: 'hidden' },
});

// The Player sizes itself from its inline `style` alone: with no width there it plays at the composition's own pixel
// size, whatever a class says. Given only a width, it keeps the composition's aspect ratio itself.
const PLAYER_FILLS_STAGE = { width: '100%' } as const;

type LabStageProps<P extends Record<keyof P & string, unknown>> = {
  readonly component: ComponentType<P>;
  readonly inputProps: P;
  readonly seconds: number;
  /** LAB_FORMAT's unless a tab needs another shape or rate. */
  readonly format?: { width: number; height: number; fps: number };
  readonly label?: string;
  readonly controls?: boolean;
};

/**
 * A composition playing live, looped, in a bracketed frame. Its props re-render it as they change, so controls feel
 * immediate.
 */
export function LabStage<P extends Record<keyof P & string, unknown>>({ component, inputProps, seconds, format = LAB_FORMAT, label, controls = true }: LabStageProps<P>) {
  const { width, height, fps } = format;
  return (
    <Box component="figure" m={0} {...stylex.props(styles.stage)}>
      {label && <Text component="figcaption" size="xs" {...stylex.props(styles.label)}>{label}</Text>}
      <Player
        component={component}
        inputProps={inputProps}
        durationInFrames={Math.max(1, Math.round(seconds * fps))}
        fps={fps}
        compositionWidth={width}
        compositionHeight={height}
        {...stylex.props(styles.player)}
        style={PLAYER_FILLS_STAGE}
        controls={controls}
        loop
        autoPlay
        // Remotion mutes an autoplaying Player anyway, and warns about it; the lab's stages are silent.
        initiallyMuted
        acknowledgeRemotionLicense
      />
    </Box>
  );
}
