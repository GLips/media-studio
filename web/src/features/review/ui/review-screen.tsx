import { useState } from 'react';
import type { ReviewArtifact } from '#lib/output/review/models/review-artifact.ts';
import { REVIEW_FALLBACK_FPS } from '#lib/output/review/models/review-context.ts';
import type { ReviewGuideSet } from '#lib/output/review/models/review-guides.ts';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { useReviewSearch, type ReviewSearch, type SetReviewSearch } from '../controllers/review-search.ts';
import { ReviewHeader } from './review-header.tsx';
import { useReviewPlaybackClock, useReviewPlaybackState } from './review-playback-store.ts';
import { ReviewScreenProvider, useReviewStatus, type ReviewScreenMode, type ReviewScreenValue } from './review-screen-context.tsx';
import { ReviewScreenLayout } from './review-screen-layout.tsx';
import { useReviewDraft } from './use-review-draft.ts';

/**
 * How the stage is shown: the mode (the Board is in the URL as `view`, so Back leaves it; drawing is not) and its
 * guides, which the transport's ⌗ and the stage's `H` share.
 */
function useReviewScreenView(search: ReviewSearch, setSearch: SetReviewSearch): Pick<ReviewScreenValue, 'mode' | 'setMode' | 'guides' | 'setGuides'> {
  const [drawing, setDrawing] = useState(false);
  const [guides, setGuides] = useState<ReviewGuideSet | null>(null);
  const onBoard = search.view === 'board';
  const mode: ReviewScreenMode = drawing ? 'draw' : (onBoard && 'board') || 'stage';
  const setMode = (next: ReviewScreenMode) => {
    setDrawing(next === 'draw');
    if ((next === 'board') !== onBoard) setSearch({ view: next === 'board' ? 'board' : 'stage' });
  };
  return { mode, setMode, guides, setGuides };
}

/**
 * The review of one file, bound to the render it loaded. It holds what every slot shares: the clock, the draft, the
 * URL, the polled status and the stage's view.
 */
export function ReviewScreen({ artifact, onLoadReplacement }: { readonly artifact: ReviewArtifact; readonly onLoadReplacement: () => void }) {
  const fps = artifact.fps ?? REVIEW_FALLBACK_FPS;
  const [search, setSearch] = useReviewSearch();
  const playback = useReviewPlaybackClock(
    { fps, durationInFrames: artifact.durationInFrames, startFrame: search.f ?? 0 },
    (f) => setSearch({ f }),
  );
  const durationInFrames = useReviewPlaybackState(playback, (s) => s.durationInFrames);
  const draft = useReviewDraft(`${artifact.project}/${artifact.path}`);
  const status = useReviewStatus(artifact.project, artifact.path);
  const view = useReviewScreenView(search, setSearch);
  const screen: ReviewScreenValue = {
    project: artifact.project, artifact, timing: { fps, durationInFrames }, status, playback, draft, search, setSearch, ...view,
  };
  return (
    <ReviewScreenProvider value={screen}>
      <StudioShell start={<ReviewHeader onLoadReplacement={onLoadReplacement} />}>
        <ReviewScreenLayout />
      </StudioShell>
    </ReviewScreenProvider>
  );
}
