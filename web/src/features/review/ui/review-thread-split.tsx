import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useHotkey } from '@tanstack/react-hotkeys';
import { useRef, useState, type ReactNode, type Ref } from 'react';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  split: { display: 'grid', height: '100%', minHeight: 0, gridTemplateRows: 'minmax(0, 1fr)' },
  open: { gridTemplateColumns: `minmax(0, 1fr) ${spacing.sideWidth}` },
  folded: { gridTemplateColumns: 'minmax(0, 1fr) 0' },
  main: { minHeight: 0, minWidth: 0 },
  thread: {
    minHeight: 0, overflow: 'hidden',
    borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.line,
  },
});

type ReviewThreadSplitProps = {
  /** The screen's body, filling the width the thread leaves. */
  readonly children: ReactNode;
  readonly thread: ReactNode;
  /** The playback's root, which carries the clock's CSS variables to both sides. */
  readonly rootRef?: Ref<HTMLDivElement>;
};

/**
 * A screen's body with its thread full height beside it, as the review, the plan and a decision all lay out.
 * `Mod+\` folds the thread to no width; folded, it stays mounted, so its keys still work, and focus landing in it
 * (`G N`) unfolds it.
 */
export function ReviewThreadSplit({ children, thread, rootRef }: ReviewThreadSplitProps) {
  const [threadOpen, setThreadOpen] = useState(true);
  const threadBox = useRef<HTMLDivElement>(null);
  useHotkey('Mod+\\', () => {
    // Folding away a thread that holds focus lets the focus go, so no hidden row keeps taking the arrows.
    const focused = document.activeElement;
    if (threadOpen && focused instanceof HTMLElement && threadBox.current?.contains(focused)) focused.blur();
    setThreadOpen(!threadOpen);
  }, { meta: { group: 'global', name: 'Thread' } });
  return (
    <Box ref={rootRef} {...stylex.props(styles.split, threadOpen ? styles.open : styles.folded)}>
      <Box {...stylex.props(styles.main)}>{children}</Box>
      <Box ref={threadBox} onFocus={() => setThreadOpen(true)} {...stylex.props(styles.thread)}>{thread}</Box>
    </Box>
  );
}
