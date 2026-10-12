import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useRef } from 'react';
import type { ReviewCandidate } from '#lib/output/review/models/review-threads.ts';
import { spacing } from '#web/shared/ui/theme.stylex.ts';
import { DecisionCandidateFrame } from './decision-candidate-frame.tsx';
import { useDecisionGridFit } from './decision-grid-fit.ts';
import { useDecisionScreen } from './decision-screen-context.tsx';

const styles = stylex.create({
  pair: { display: 'grid', height: '100%', gap: spacing.inset, padding: spacing.inset, gridAutoRows: 'minmax(0, 1fr)' },
  columns: (count: number) => ({ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }),
});

/**
 * Two candidates on one clock, side by side or one over the other, whichever shows them larger: the one in focus is
 * heard, the other plays along muted.
 */
export function DecisionTwoUp() {
  const { decision, pair } = useDecisionScreen();
  const box = useRef<HTMLDivElement>(null);
  const candidates = pair.flatMap((key): ReviewCandidate[] => decision.candidates.filter((c) => c.key === key));
  const fit = useDecisionGridFit(box, candidates);
  return (
    <Box ref={box} {...stylex.props(styles.pair, styles.columns(fit.columns))}>
      {candidates.map((candidate) => <DecisionCandidateFrame key={candidate.key} candidate={candidate} />)}
    </Box>
  );
}
