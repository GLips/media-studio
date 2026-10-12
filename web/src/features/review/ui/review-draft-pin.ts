import type { ReviewPoint } from '#lib/output/review/models/review-threads.ts';
import type { ReviewScreenValue } from './review-screen-context.tsx';

/**
 * Points the draft at the still, or at the playhead, paused: a draft whose frame or range already covers it keeps its anchor (a
 * sketched range, a cue), any other moves here. `point` pins it.
 */
export function pinReviewDraft({ artifact, playback, draft }: ReviewScreenValue, point?: ReviewPoint) {
  if (artifact.kind === 'still') {
    draft.setAnchor((a) => ({ ...(a.on === 'still' && a), on: 'still', writtenOn: { path: artifact.path, hash: artifact.render.hash }, ...(point && { point }) }));
    return;
  }
  playback.pause();
  const frame = playback.frameNow();
  draft.setAnchor((a) => {
    const covers = a.on === 'video' && a.frame !== undefined && a.frame <= frame && frame <= (a.end ?? a.frame);
    const anchor = covers ? a : { on: 'video' as const, frame, writtenOn: { path: artifact.path, hash: artifact.render.hash } };
    return point ? { ...anchor, point } : anchor;
  });
}

/** `D` and the transport's ✎: into draw mode with the draft pinned where the strokes go, or back to the stage. */
export function toggleReviewDraw(screen: ReviewScreenValue) {
  if (screen.mode === 'draw') return screen.setMode('stage');
  pinReviewDraft(screen);
  screen.setMode('draw');
}
