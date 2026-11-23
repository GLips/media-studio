import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { reviewDecisionAfterSignOff } from '#lib/output/review/models/review-decisions.ts';
import { reviewDecisionRefusalOf } from '#lib/output/review/models/review-ops.ts';
import type { ReviewDecision } from '#lib/output/review/models/review-threads.ts';
import { useReviewOps, type DecodedReviewOp } from '#web/features/review/index.ts';
import { RouteNotFoundPage } from '#web/shared/ui/route-not-found-page.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { useDecisionPass, type DecisionPass } from '../controllers/decision-pass.ts';
import { useReviewDecisionView, type ReviewDecisionView } from '../controllers/decision-queries.ts';
import { useDecisionSearch } from '../controllers/decision-search.ts';
import { DecisionHeader } from './decision-header.tsx';
import { DecisionLayout } from './decision-layout.tsx';
import { DecisionQueue } from './decision-queue.tsx';
import { createDecisionPlayback } from './decision-playback.ts';
import { DecisionScreenProvider, type DecisionScreenValue } from './decision-screen-context.tsx';
import { decisionTwoUpPairOf, decisionTwoUpPairWith } from './decision-two-up-pair.ts';
import { useDecisionHotkeys } from './use-decision-hotkeys.ts';

type DecisionScreenBodyProps = {
  readonly project: string; readonly topic: string; readonly view: ReviewDecisionView; readonly decision: ReviewDecision; readonly pass: DecisionPass;
};

function DecisionScreenBody({ project, topic, view, decision, pass }: DecisionScreenBodyProps) {
  const [search, setSearch] = useDecisionSearch();
  const navigate = useNavigate();
  const ops = useReviewOps(project);
  const [playback] = useState(createDecisionPlayback);
  const { candidates } = decision;
  const twoUp = search.view === 'two';
  // The two-up shows its pair whatever the filter, so only the survey narrows to the picks.
  const shown = !twoUp && search.filter === 'picks' ? candidates.filter((c) => c.verdict === 'pick') : candidates;
  // Focus stays on a candidate on show: with picks only, a hidden one isn't heard or judged.
  const focused = shown.find((c) => c.key === search.c)?.key ?? shown[0]?.key ?? null;
  const heard = focused ?? candidates[0].key;
  const pair = decisionTwoUpPairOf(candidates, heard, search.two);
  const openDecision = (to: string) => void navigate({ to: '/projects/$project/decisions/$topic', params: { project, topic: to } });
  const decide = (batch: DecodedReviewOp[]) => {
    const refused = reviewDecisionRefusalOf(decision, batch);
    if (refused === null) void ops.apply(batch);
    return refused === null;
  };
  const screen: DecisionScreenValue = {
    project, topic, view, decision, pass, shown, playback, search, setSearch, focused, pair, ops, decide, openDecision,
    signOff: () => {
      if (!decide([{ op: 'decision.close', id: decision.id }])) return;
      const next = reviewDecisionAfterSignOff(pass.decisions, topic);
      if (next !== null) openDecision(next);
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
        <DecisionLayout queue={<DecisionQueue />} />
      </StudioShell>
    </DecisionScreenProvider>
  );
}

/**
 * The project's decisions walked in one pass, in story order: each one's candidates surveyed or two-up on one clock,
 * judged with Lightroom's keys and signed off, which opens the next. On the project pulse. Mounted once per project:
 * the pass outlives each decision, whose clock and focus start fresh.
 */
export function DecisionScreen({ project, topic }: { readonly project: string; readonly topic: string }) {
  const view = useReviewDecisionView(project, topic);
  const pass = useDecisionPass(project, topic, view.topics);
  if (!view.decision) return <RouteNotFoundPage />;
  return <DecisionScreenBody key={topic} project={project} topic={topic} view={view} decision={view.decision} pass={pass} />;
}
