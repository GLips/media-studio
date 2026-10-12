import { Box, Center, Kbd } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useRef } from 'react';
import { colors, fonts, spacing } from '#web/shared/ui/theme.stylex.ts';
import { DecisionCandidateFrame } from './decision-candidate-frame.tsx';
import { useDecisionGridFit } from './decision-grid-fit.ts';
import { useDecisionScreen } from './decision-screen-context.tsx';

const styles = stylex.create({
  grid: {
    display: 'grid', height: '100%', gap: spacing.inset, padding: spacing.inset,
    gridAutoRows: 'minmax(0, 1fr)',
  },
  columns: (count: number) => ({ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }),
  empty: { height: '100%' },
  kbd: { fontFamily: fonts.mono, color: colors.dim, backgroundColor: 'transparent' },
});

/** Every candidate at once, fitted to the space without a scroll; `F` narrows it to the picks. */
export function DecisionSurvey() {
  const { shown } = useDecisionScreen();
  const grid = useRef<HTMLDivElement>(null);
  const fit = useDecisionGridFit(grid, shown);
  if (shown.length === 0) {
    return <Center {...stylex.props(styles.empty)}><Kbd size="xs" {...stylex.props(styles.kbd)}>P</Kbd></Center>;
  }
  return (
    <Box ref={grid} {...stylex.props(styles.grid, styles.columns(fit.columns))}>
      {shown.map((candidate) => <DecisionCandidateFrame key={candidate.key} candidate={candidate} />)}
    </Box>
  );
}
