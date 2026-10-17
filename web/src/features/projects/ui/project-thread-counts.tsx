import { Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import type { ReviewFirstThread, ReviewProjectSummary, ReviewThreadCounts } from '#lib/output/review/models/review-dashboard.ts';
import { REVIEW_THREAD_TONES } from '#lib/output/review/models/review-threads.ts';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  count: { fontFamily: fonts.mono, whiteSpace: 'nowrap', cursor: 'default' },
  linked: { cursor: 'pointer', textDecoration: { default: 'none', ':hover': 'underline' } },
  open: { color: colors.accent },
  addressed: { color: colors.pass },
  asks: { color: colors.caution },
});

/** The states counted, in the order the thread panel's filter chips use. */
const THREAD_COUNT_TONES = ['open', 'addressed', 'asks'] as const;

type ThreadCountTone = (typeof THREAD_COUNT_TONES)[number];

/** A count's tooltip: `11 open notes`, `2 addressed, to verify`, `1 agent question`. */
const THREAD_COUNT_TIPS: Record<ThreadCountTone, (n: number) => string> = {
  open: (n) => `${n} open note${n === 1 ? '' : 's'}`,
  addressed: (n) => `${n} addressed, to verify`,
  asks: (n) => `${n} agent question${n === 1 ? '' : 's'}`,
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

/** `●4 ◐2 ?1`: the threads waiting on someone, by state; a state with none is left out. */
export function ProjectThreadCounts({ threads, linkedTo }: ProjectThreadCountsProps) {
  const shown = THREAD_COUNT_TONES.filter((state) => threads[state] > 0);
  if (!shown.length) return null;
  return (
    <Group gap="gap" wrap="nowrap">
      {shown.map((state) => {
        const first = linkedTo?.firstThreads[state];
        const count = (
          <HotkeyTooltip key={state} name={`${THREAD_COUNT_TIPS[state](threads[state])}${first ? `: open #${first.id}` : ''}`}>
            <Text component="span" size="sm" {...stylex.props(styles.count, styles[state], first && styles.linked)}>{REVIEW_THREAD_TONES[state].glyph}{threads[state]}</Text>
          </HotkeyTooltip>
        );
        return linkedTo && first ? <FirstThreadLink key={state} summary={linkedTo} first={first}>{count}</FirstThreadLink> : count;
      })}
    </Group>
  );
}
