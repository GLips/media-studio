import { useEffect, useState } from 'react';
import { reviewDecisionRefusalOf } from '#lib/output/review/models/review-ops.ts';
import type { ReviewDecision } from '#lib/output/review/models/review-threads.ts';
import { useReviewOps } from '#web/features/review/index.ts';
import { RouteNotFoundPage } from '#web/shared/ui/route-not-found-page.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { decisionOpsTarget, useReviewDecisionView } from '../controllers/decision-queries.ts';
import { useDecisionSearch } from '../controllers/decision-search.ts';
import type { ReviewDecisionView } from '../controllers/review-decision.ts';
import { DecisionHeader } from './decision-header.tsx';
import { DecisionLayout } from './decision-layout.tsx';
import { createDecisionPlayback } from './decision-playback.ts';
import { DecisionScreenProvider, type DecisionScreenValue } from './decision-screen-context.tsx';
import { decisionTwoUpPairOf, decisionTwoUpPairWith } from './decision-two-up-pair.ts';
import { useDecisionHotkeys } from './use-decision-hotkeys.ts';

type DecisionScreenBodyProps = { readonly project: string; readonly topic: string; readonly view: ReviewDecisionView; readonly decision: ReviewDecision };

function DecisionScreenBody({ project, topic, view, decision }: DecisionScreenBodyProps) {
  const [search, setSearch] = useDecisionSearch();
  const ops = useReviewOps(decisionOpsTarget(project, topic));
  const [playback] = useState(createDecisionPlayback);
  const { candidates } = decision;
  const twoUp = search.view === 'two';
  // The two-up shows its pair whatever the filter, so only the survey narrows to the picks.
  const shown = !twoUp && search.filter === 'picks' ? candidates.filter((c) => c.verdict === 'pick') : candidates;
  // Focus stays on a candidate on show: with picks only, a hidden one isn't heard or judged.
  const focused = shown.find((c) => c.key === search.c)?.key ?? shown[0]?.key ?? null;
  const heard = focused ?? candidates[0].key;
  const pair = decisionTwoUpPairOf(candidates, heard, search.two);
  const screen: DecisionScreenValue = {
    project, topic, view, decision, shown, playback, search, setSearch, focused, pair, ops,
    decide: (batch) => {
      if (reviewDecisionRefusalOf(decision, batch) === null) void ops.apply(batch);
    },
    focus: (key) => setSearch(twoUp ? { c: key, two: decisionTwoUpPairWith(candidates, pair, heard, key).join(',') } : { c: key }),
    openTwoUp: (key) => setSearch(key === null
      ? { view: undefined, two: undefined }
      : { view: 'two', c: key, two: decisionTwoUpPairOf(candidates, key, undefined).join(',') }),
  };
  const [left, right] = pair;
  useEffect(() => {
    playback.setActive(heard);
    playback.setLinked(twoUp ? [left, right] : [heard]);
  }, [playback, heard, twoUp, left, right]);
  useDecisionHotkeys(screen);
  return (
    <DecisionScreenProvider value={screen}>
      <StudioShell start={<DecisionHeader />}>
        <DecisionLayout />
      </StudioShell>
    </DecisionScreenProvider>
  );
}

/**
 * A decision an agent posted: its candidates surveyed or two-up on one clock, judged with Lightroom's keys and
 * signed off. Polled, so a re-post or the agent's reply shows within a second.
 */
export function DecisionScreen({ project, topic }: { readonly project: string; readonly topic: string }) {
  const view = useReviewDecisionView(project, topic);
  if (!view.decision) return <RouteNotFoundPage />;
  return <DecisionScreenBody project={project} topic={topic} view={view} decision={view.decision} />;
}
