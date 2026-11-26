import { Box } from '@mantine/core';
import { reviewMediaIsTimed } from '#lib/output/review/models/review-context.ts';
import * as stylex from '@stylexjs/stylex';
import { spacing } from '#web/shared/ui/theme.stylex.ts';
import { ReviewBoard } from './review-board.tsx';
import { ReviewDock } from './review-dock.tsx';
import { useReviewScreen } from './review-screen-context.tsx';
import { ReviewTrackStage } from './review-track-stage.tsx';
import { ReviewStage } from './review-stage.tsx';
import { ReviewStillsView } from './review-stills-view.tsx';
import { ReviewScreenThread } from './review-screen-thread.tsx';
import { ReviewThreadSplit } from './review-thread-split.tsx';
import { ReviewTransportBar } from './review-transport-bar.tsx';
import { useReviewBoardToggleHotkey } from './use-review-board-hotkeys.ts';
import { useReviewPlaybackHotkeys } from './use-review-playback-hotkeys.ts';

const styles = stylex.create({
  // The dock's row is `auto`: its lanes set its height, so a project without a voice gets a shorter dock.
  video: {
    display: 'grid', height: '100%', minHeight: 0,
    gridTemplateAreas: '"stage" "transport" "dock"',
    gridTemplateRows: `minmax(0, 1fr) ${spacing.bar} auto`,
  },
  still: { display: 'grid', height: '100%', minHeight: 0, gridTemplateAreas: '"stage"', gridTemplateRows: 'minmax(0, 1fr)' },
  stage: { gridArea: 'stage', minHeight: 0, minWidth: 0 },
  transport: { gridArea: 'transport', minWidth: 0 },
  dock: { gridArea: 'dock', minWidth: 0 },
});

/**
 * The screen's own keys, in a component rendered before the slots. Its effects then run before theirs: switching to
 * the Board drops the playback arrows here before the Board binds its own, where a parent's effects would run after
 * its children's and the Board's arrows would collide with keys not yet let go.
 */
function ReviewScreenHotkeys() {
  useReviewPlaybackHotkeys();
  useReviewBoardToggleHotkey();
  return null;
}

/**
 * The review's body: the stage (or the Board in its place) over the transport and the dock, the thread full height
 * beside them. `B` swaps in the Board (a folder's grid). A still has no dock: its view fills.
 */
export function ReviewScreenLayout() {
  const { artifact, playback, mode } = useReviewScreen();
  // Audio plays on the same clock and dock as video, its stage showing the track in place of a picture.
  const isVideo = reviewMediaIsTimed(artifact.kind);
  return (
    <ReviewThreadSplit rootRef={playback.attachRoot} thread={<ReviewScreenThread on={isVideo ? 'video' : 'still'} />}>
      <ReviewScreenHotkeys />
      <Box {...stylex.props(isVideo ? styles.video : styles.still)}>
        <Box {...stylex.props(styles.stage)}>
          {isVideo || <ReviewStillsView />}
          {artifact.kind === 'video' && mode === 'board' && <ReviewBoard />}
          {artifact.kind === 'video' && mode !== 'board' && <ReviewStage />}
          {artifact.kind === 'audio' && <ReviewTrackStage />}
        </Box>
        {isVideo && <Box {...stylex.props(styles.transport)}><ReviewTransportBar /></Box>}
        {isVideo && <Box {...stylex.props(styles.dock)}><ReviewDock /></Box>}
      </Box>
    </ReviewThreadSplit>
  );
}
