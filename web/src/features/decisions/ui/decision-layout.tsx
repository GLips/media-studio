import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReviewDecision } from '#lib/output/review/models/review-threads.ts';
import { ReviewThreadSplit } from '#web/features/review/index.ts';
import { spacing } from '#web/shared/ui/theme.stylex.ts';
import { useDecisionScreen } from './decision-screen-context.tsx';
import { DecisionSurvey } from './decision-survey.tsx';
import { DecisionThread } from './decision-thread.tsx';
import { DecisionTransport } from './decision-transport.tsx';
import { DecisionTwoUp } from './decision-two-up.tsx';

const styles = stylex.create({
  body: {
    display: 'grid', height: '100%', minHeight: 0,
    gridTemplateAreas: '"candidates" "transport"',
    gridTemplateRows: `minmax(0, 1fr) ${spacing.bar}`,
  },
  untimed: { gridTemplateRows: 'minmax(0, 1fr) 0' },
  candidates: { gridArea: 'candidates', minHeight: 0, minWidth: 0 },
  transport: { gridArea: 'transport', minWidth: 0, overflow: 'hidden' },
});

/** Whether any candidate plays: only then is there a transport. */
const isTimed = (decision: ReviewDecision) => decision.candidates.some((c) => c.media && c.media.kind !== 'still');

/** The decision's body: the candidates (surveyed or two-up) over their one transport, the focused candidate's thread full height beside them. */
export function DecisionLayout() {
  const { decision, playback, search, focused } = useDecisionScreen();
  return (
    <ReviewThreadSplit rootRef={playback.attachRoot} thread={<DecisionThread key={focused ?? ''} />}>
      <Box {...stylex.props(styles.body, isTimed(decision) || styles.untimed)}>
        <Box {...stylex.props(styles.candidates)}>{search.view === 'two' ? <DecisionTwoUp /> : <DecisionSurvey />}</Box>
        {isTimed(decision) && <Box {...stylex.props(styles.transport)}><DecisionTransport /></Box>}
      </Box>
    </ReviewThreadSplit>
  );
}
