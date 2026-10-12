import { Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReviewThreadCounts } from '#lib/output/review/models/review-dashboard.ts';
import { REVIEW_THREAD_TONES } from '#lib/output/review/models/review-threads.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  count: { fontFamily: fonts.mono, whiteSpace: 'nowrap', cursor: 'default' },
  open: { color: colors.accent },
  addressed: { color: colors.pass },
  asks: { color: colors.caution },
});

/** The states counted, in the order the thread panel's filter chips use. */
const THREAD_COUNT_TONES = ['open', 'addressed', 'asks'] as const;

/** A count's tooltip: `11 open notes`, `2 addressed, to verify`, `1 agent question`. */
const THREAD_COUNT_TIPS: Record<(typeof THREAD_COUNT_TONES)[number], (n: number) => string> = {
  open: (n) => `${n} open note${n === 1 ? '' : 's'}`,
  addressed: (n) => `${n} addressed, to verify`,
  asks: (n) => `${n} agent question${n === 1 ? '' : 's'}`,
};

/** `●4 ◐2 ?1`: the threads waiting on someone, by state; a state with none is left out. */
export function ProjectThreadCounts({ threads }: { readonly threads: ReviewThreadCounts }) {
  const shown = THREAD_COUNT_TONES.filter((state) => threads[state] > 0);
  if (!shown.length) return null;
  return (
    <Group gap="gap" wrap="nowrap">
      {shown.map((state) => (
        <HotkeyTooltip key={state} name={THREAD_COUNT_TIPS[state](threads[state])}>
          <Text component="span" size="sm" {...stylex.props(styles.count, styles[state])}>{REVIEW_THREAD_TONES[state].glyph}{threads[state]}</Text>
        </HotkeyTooltip>
      ))}
    </Group>
  );
}
