import { formatReviewThreadsMarkdown } from '#lib/output/review/models/review-markdown.ts';
import { useReviewOps } from '../controllers/use-review-ops.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { ReviewThreadPanel } from './review-thread-panel.tsx';
import { ReviewThreadScopeProvider, type ReviewThreadScope } from './review-thread-scope.tsx';
import { useReviewRenderVersions } from './use-review-render-versions.ts';
import { useReviewSplices, useReviewThreads } from './use-review-threads.ts';

/**
 * The thread of a screen that reviews one file (a render or a still): its scope is the screen's
 * file, clock, draft and URL, so a pin on the stage and the composer are one draft.
 */
export function ReviewScreenThread({ on }: { readonly on: 'video' | 'still' }) {
  const { project, artifact, timing, playback, draft, search, setSearch, mode } = useReviewScreen();
  const threads = useReviewThreads()?.threads;
  const { versions } = useReviewRenderVersions();
  const splices = useReviewSplices();
  const ops = useReviewOps(project);
  const scope: ReviewThreadScope = {
    project, subject: { on }, threads, ops, draft, search, setSearch,
    media: {
      artifact, timing, playback, versions, splices, drawing: mode === 'draw',
      compare: { vs: search.vs, cmp: search.cmp, w: search.w }, setCompare: setSearch,
    },
    markdownOf: (listed) => formatReviewThreadsMarkdown(listed, {
      project, renderPath: artifact.path, renderHash: artifact.render.hash, fps: timing.fps, size: artifact.frameSize, splices: splices.laid,
      sources: { fps: timing.fps, frameSize: artifact.frameSize, scenes: artifact.scenes, sounds: artifact.sounds, motion: artifact.motion, cells: artifact.cells, timing: artifact.timing },
    }),
  };
  return (
    <ReviewThreadScopeProvider value={scope}>
      <ReviewThreadPanel />
    </ReviewThreadScopeProvider>
  );
}
