import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useRef, useState } from 'react';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ReviewBoard } from './review-board.tsx';
import { ReviewDock } from './review-dock.tsx';
import { useReviewScreen } from './review-screen-context.tsx';
import { ReviewStage } from './review-stage.tsx';
import { ReviewStillsView } from './review-stills-view.tsx';
import { ReviewScreenThread } from './review-screen-thread.tsx';
import { ReviewTransportBar } from './review-transport-bar.tsx';
import { useReviewBoardToggleHotkey } from './use-review-board-hotkeys.ts';
import { useReviewPlaybackHotkeys } from './use-review-playback-hotkeys.ts';

const styles = stylex.create({
  // The dock's row is `auto`: its lanes set its height, so a project without a voice gets a shorter dock.
  video: {
    display: 'grid', height: '100%', minHeight: 0,
    gridTemplateAreas: '"stage thread" "transport thread" "dock thread"',
    gridTemplateRows: `minmax(0, 1fr) ${spacing.bar} auto`,
  },
  still: { display: 'grid', height: '100%', minHeight: 0, gridTemplateAreas: '"stage thread"', gridTemplateRows: 'minmax(0, 1fr)' },
  withThread: { gridTemplateColumns: `minmax(0, 1fr) ${spacing.sideWidth}` },
  withoutThread: { gridTemplateColumns: 'minmax(0, 1fr) 0' },
  stage: { gridArea: 'stage', minHeight: 0, minWidth: 0 },
  transport: { gridArea: 'transport', minWidth: 0 },
  dock: { gridArea: 'dock', minWidth: 0 },
  thread: {
    gridArea: 'thread', minHeight: 0, overflow: 'hidden',
    borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.line,
  },
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
 * beside them. `Mod+\` folds the thread away and the stage takes its width; `B` swaps in the Board (a folder's
 * grid). A still has no dock: its view fills.
 */
export function ReviewScreenLayout() {
  const { artifact, playback, mode } = useReviewScreen();
  const [threadOpen, setThreadOpen] = useState(true);
  const threadBox = useRef<HTMLDivElement>(null);
  useHotkey('Mod+\\', () => {
    // Folding away a thread that holds focus lets the focus go, so no hidden row keeps taking the arrows.
    const focused = document.activeElement;
    if (threadOpen && focused instanceof HTMLElement && threadBox.current?.contains(focused)) focused.blur();
    setThreadOpen(!threadOpen);
  }, { meta: { group: 'global', name: 'Thread' } });
  const isVideo = artifact.kind === 'video';
  const { attachRoot } = playback;
  return (
    <Box ref={attachRoot} {...stylex.props(isVideo ? styles.video : styles.still, threadOpen ? styles.withThread : styles.withoutThread)}>
      <ReviewScreenHotkeys />
      <Box {...stylex.props(styles.stage)}>
        {isVideo || <ReviewStillsView />}
        {isVideo && mode === 'board' && <ReviewBoard />}
        {isVideo && mode !== 'board' && <ReviewStage />}
      </Box>
      {isVideo && <Box {...stylex.props(styles.transport)}><ReviewTransportBar /></Box>}
      {isVideo && <Box {...stylex.props(styles.dock)}><ReviewDock /></Box>}
      {/* Folded, the thread stays mounted at no width, so its keys still work; focus landing in it (`G N`) unfolds it. */}
      <Box ref={threadBox} onFocus={() => setThreadOpen(true)} {...stylex.props(styles.thread)}>
        <ReviewScreenThread on={isVideo ? 'video' : 'still'} />
      </Box>
    </Box>
  );
}
