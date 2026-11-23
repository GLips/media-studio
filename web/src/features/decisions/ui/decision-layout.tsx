import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { reviewCandidateIsTimed, type ReviewDecision } from '#lib/output/review/models/review-threads.ts';
import { ReviewThreadSplit } from '#web/features/review/index.ts';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { DecisionAbout } from './decision-about.tsx';
import { useDecisionScreen } from './decision-screen-context.tsx';
import { DecisionSurvey } from './decision-survey.tsx';
import { DecisionThread } from './decision-thread.tsx';
import { DecisionTransport } from './decision-transport.tsx';
import { DecisionTwoUp } from './decision-two-up.tsx';

const styles = stylex.create({
  screen: { display: 'grid', height: '100%', minHeight: 0, gridTemplateColumns: `${spacing.queueWidth} minmax(0, 1fr)` },
  queue: { minHeight: 0, overflow: 'hidden', borderRightWidth: '1px', borderRightStyle: 'solid', borderRightColor: colors.line },
  body: {
    display: 'grid', height: '100%', minHeight: 0,
    gridTemplateAreas: '"about" "candidates" "transport"',
    gridTemplateRows: `auto minmax(0, 1fr) ${spacing.bar}`,
  },
  untimed: { gridTemplateRows: 'auto minmax(0, 1fr) 0' },
  about: { gridArea: 'about', minWidth: 0 },
  candidates: { gridArea: 'candidates', minHeight: 0, minWidth: 0 },
  transport: { gridArea: 'transport', minWidth: 0, overflow: 'hidden' },
});

/** Whether any candidate plays: only then is there a transport. */
const isTimed = (decision: ReviewDecision) => decision.candidates.some(reviewCandidateIsTimed);

/**
 * The screen's body: the pass's queue down the left; then what the decision is for over its candidates (surveyed or
 * two-up) over their one transport; the focused candidate's thread full height on the right.
 */
export function DecisionLayout({ queue }: { readonly queue: ReactNode }) {
  const { decision, playback, search, focused } = useDecisionScreen();
  return (
    <Box {...stylex.props(styles.screen)}>
      <Box {...stylex.props(styles.queue)}>{queue}</Box>
      <ReviewThreadSplit rootRef={playback.attachRoot} thread={<DecisionThread key={focused ?? ''} />}>
        <Box {...stylex.props(styles.body, isTimed(decision) || styles.untimed)}>
          <Box {...stylex.props(styles.about)}><DecisionAbout /></Box>
          <Box {...stylex.props(styles.candidates)}>{search.view === 'two' ? <DecisionTwoUp /> : <DecisionSurvey />}</Box>
          {isTimed(decision) && <Box {...stylex.props(styles.transport)}><DecisionTransport /></Box>}
        </Box>
      </ReviewThreadSplit>
    </Box>
  );
}
