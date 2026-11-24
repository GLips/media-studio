import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Fragment, type ReactNode } from 'react';
import type { ReviewFirstThread, ReviewProjectSummary, ReviewThreadCounts } from '#lib/output/review/models/review-dashboard.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { colors } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  count: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  linked: { cursor: 'pointer', textDecoration: { default: 'none', ':hover': 'underline' } },
  open: { color: colors.accent },
  // Verifying is the reviewer's to do, so it isn't pass-green, which reads as done on a list of what waits.
  addressed: { color: colors.cream },
  asks: { color: colors.caution },
});

/** The states counted, in the order the thread panel's filter chips use. */
const THREAD_COUNT_TONES = ['open', 'addressed', 'asks'] as const;

type ThreadCountTone = (typeof THREAD_COUNT_TONES)[number];

/** What a count says, the same words the review panel uses: `1 open note`, `2 to verify`, `3 questions`. */
const THREAD_COUNT_WORDS: Record<ThreadCountTone, (n: number) => string> = {
  open: (n) => `${n} open note${n === 1 ? '' : 's'}`,
  addressed: (n) => `${n} to verify`,
  asks: (n) => `${n} question${n === 1 ? '' : 's'}`,
};

/**
 * The first thread's page with it open (`?note=`). A note on the whole project is read beside the newest video, as
 * the project-notes row leads; with no video it has no page, and its count stays plain.
 */
function FirstThreadLink({ summary, first, children }: { readonly summary: ReviewProjectSummary; readonly first: ReviewFirstThread; readonly children: ReactNode }) {
  const { project } = summary, { place } = first, search = { note: first.id };
  const link = { underline: 'never' } as const;
  switch (place.on) {
    case 'file': return <AnchorLink to="/projects/$project/artifacts/$" params={{ project, _splat: place.path }} search={search} {...link}>{children}</AnchorLink>;
    case 'decision': return <AnchorLink to="/projects/$project/decisions/$topic" params={{ project, topic: place.topic }} search={search} {...link}>{children}</AnchorLink>;
    case 'plan': return <AnchorLink to="/projects/$project/plan" params={{ project }} search={search} {...link}>{children}</AnchorLink>;
    default: {
      const newest = summary.rows.find((row) => row.on === 'file' && row.artifact.kind === 'video');
      if (newest?.on !== 'file') return children;
      return <AnchorLink to="/projects/$project/artifacts/$" params={{ project, _splat: newest.artifact.path }} search={search} {...link}>{children}</AnchorLink>;
    }
  }
}

type ProjectThreadCountsProps = {
  readonly threads: ReviewThreadCounts;
  /** A project page's header: each count opens its state's first thread. Left out inside a row, which is a link itself. */
  readonly linkedTo?: ReviewProjectSummary;
};

/** `1 open note  2 to verify  1 question`: the threads waiting on someone, in words coloured by state; none, nothing. */
export function ProjectThreadCounts({ threads, linkedTo }: ProjectThreadCountsProps) {
  return THREAD_COUNT_TONES.filter((state) => threads[state] > 0).map((state) => {
    const first = linkedTo?.firstThreads[state];
    const words = <Text component="span" size="sm" {...stylex.props(styles.count, styles[state], first && styles.linked)}>{THREAD_COUNT_WORDS[state](threads[state])}</Text>;
    if (!linkedTo || !first) return <Fragment key={state}>{words}</Fragment>;
    return (
      <FirstThreadLink key={state} summary={linkedTo} first={first}>
        <HotkeyTooltip name={`Open #${first.id}`}>{words}</HotkeyTooltip>
      </FirstThreadLink>
    );
  });
}
