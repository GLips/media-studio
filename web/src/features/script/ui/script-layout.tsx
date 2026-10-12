import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useMemo, useRef, useState } from 'react';
import { ReviewDock, ReviewScreenThread, useReviewScreen } from '#web/features/review/index.ts';
import { reviewMediaUrl } from '#web/shared/media-urls.ts';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewScriptRead, ReviewScriptTakeRead } from '../controllers/review-script.ts';
import { ScriptLines } from './script-lines.tsx';
import { scriptTimedLinesOf } from './script-read-along.ts';
import { ScriptTransport } from './script-transport.tsx';
import { useScriptHotkeys } from './use-script-hotkeys.ts';

const styles = stylex.create({
  grid: {
    display: 'grid', height: '100%', minHeight: 0,
    gridTemplateAreas: '"lines thread" "transport thread" "dock thread"',
    gridTemplateRows: `minmax(0, 1fr) ${spacing.bar} auto`,
  },
  withThread: { gridTemplateColumns: `minmax(0, 1fr) ${spacing.sideWidth}` },
  withoutThread: { gridTemplateColumns: 'minmax(0, 1fr) 0' },
  lines: { gridArea: 'lines', minHeight: 0, minWidth: 0 },
  transport: { gridArea: 'transport', minWidth: 0 },
  dock: { gridArea: 'dock', minWidth: 0 },
  thread: {
    gridArea: 'thread', minHeight: 0, overflow: 'hidden',
    borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.line,
  },
  take: { display: 'none' },
});

type ScriptLayoutProps = { readonly script: ReviewScriptRead; readonly take: ReviewScriptTakeRead };

/**
 * The read-along's body: the lines over the take's transport and a dock of its voice and waveform under a ruler (where
 * the playhead's flag sits, clear of the line names), the script's thread full height beside them (`Mod+\` folds it).
 * The take plays from an unseen audio element on the review's clock.
 */
export function ScriptLayout({ script, take }: ScriptLayoutProps) {
  const { artifact, playback } = useReviewScreen();
  const { attachRoot, attachMedia } = playback;
  const [threadOpen, setThreadOpen] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const timed = useMemo(() => scriptTimedLinesOf(script.lines), [script.lines]);
  useHotkey('Mod+\\', () => setThreadOpen((open) => !open), { meta: { group: 'global', name: 'Thread' } });
  useScriptHotkeys({ script, take, timed, linesRef: viewportRef });
  return (
    <Box ref={attachRoot} {...stylex.props(styles.grid, threadOpen ? styles.withThread : styles.withoutThread)}>
      <Box component="audio" ref={attachMedia} src={reviewMediaUrl(artifact)} preload="auto" {...stylex.props(styles.take)} />
      <Box {...stylex.props(styles.lines)}><ScriptLines script={script} timed={timed} viewportRef={viewportRef} /></Box>
      <Box {...stylex.props(styles.transport)}><ScriptTransport /></Box>
      <Box {...stylex.props(styles.dock)}><ReviewDock lanes={['ruler', 'voice', 'sound']} tall /></Box>
      <Box {...stylex.props(styles.thread)}>{threadOpen && <ReviewScreenThread on="script" />}</Box>
    </Box>
  );
}
