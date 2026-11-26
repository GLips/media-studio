import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReviewThreadCounts } from '#lib/output/review/models/review-dashboard.ts';
import { colors } from '#web/shared/ui/theme.stylex.ts';
import { PROJECT_THREAD_COUNT_WORDS } from './project-thread-counts.tsx';

const styles = stylex.create({
  status: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  waiting: { color: colors.caution },
  // Verifying is the reviewer's to do, so it isn't pass-green, which reads as done on a list of what waits.
  verify: { color: colors.cream },
  open: { color: colors.accent },
  settled: { color: colors.dim },
  fresh: { color: colors.accent, fontWeight: 600 },
});

/** A decision's or the plan's own state: `not decided`, `0 of 6 signed`; `waiting` while it waits on the reviewer. */
export type ProjectPlaceState = { readonly words: string; readonly waiting: boolean };

type ProjectRowStatusProps = {
  readonly threads: ReviewThreadCounts;
  readonly state?: ProjectPlaceState;
  /** Changed since the reviewer last looked (project-seen.ts). */
  readonly fresh?: boolean;
};

/**
 * A row's one state in words: what needs the reviewer first (a question, an open decision or unsigned plan, a note to
 * verify), then a note waiting on the agent, then `new`, then a settled state, dim. One word, so `decided` never trails a
 * note still to verify.
 */
export function ProjectRowStatus({ threads, state, fresh = false }: ProjectRowStatusProps) {
  const [words, tone] =
    (threads.asks > 0 && [PROJECT_THREAD_COUNT_WORDS.asks(threads.asks), styles.waiting] as const) ||
    (state?.waiting && [state.words, styles.waiting] as const) ||
    (threads.addressed > 0 && [PROJECT_THREAD_COUNT_WORDS.addressed(threads.addressed), styles.verify] as const) ||
    (threads.open > 0 && [PROJECT_THREAD_COUNT_WORDS.open(threads.open), styles.open] as const) ||
    (fresh && ['new', styles.fresh] as const) ||
    (state && [state.words, styles.settled] as const) ||
    [null, null];
  if (words === null) return null;
  return <Text component="span" size="sm" {...stylex.props(styles.status, tone)}>{words}</Text>;
}
