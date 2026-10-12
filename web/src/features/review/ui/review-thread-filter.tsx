import { Box, Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Check, CheckCheck, Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { REVIEW_THREAD_TONES, type ReviewThreadTone } from '#lib/output/review/models/review-threads.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewSearch } from '../controllers/review-search.ts';
import type { ReviewThreadActions } from './use-review-thread-panel.ts';

const styles = stylex.create({
  row: {
    height: spacing.row, flexShrink: 0, paddingInlineStart: spacing.gap, paddingInlineEnd: spacing.tight,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line,
  },
  chip: {
    paddingInline: spacing.tight, borderRadius: radius.control,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  lit: { backgroundColor: colors.raised },
  count: { paddingInline: spacing.tight, cursor: 'default' },
  open: { color: colors.accent },
  addressed: { color: colors.pass },
  asks: { color: colors.caution },
  resolved: { color: colors.dim },
  keep: { color: colors.cream },
  cream: { color: colors.cream },
  end: { marginInlineStart: 'auto' },
});

/** How many of the panel's threads stand in each state; the filter row shows those that aren't zero. */
export type ReviewThreadCounts = Record<ReviewThreadTone, number>;

type ReviewThreadFilterProps = {
  /** What the thread is about, leading the row (ReviewThreadPanel's `head`). */
  readonly head?: ReactNode;
  readonly counts: ReviewThreadCounts;
  readonly filter: NonNullable<ReviewSearch['filter']>;
  readonly onFilter: (filter: NonNullable<ReviewSearch['filter']>) => void;
  readonly actions: ReviewThreadActions;
};

function Count({ children, glyphStyle, word }: { readonly children: ReactNode; readonly glyphStyle: keyof typeof styles; readonly word: string }) {
  return (
    <HotkeyTooltip name={word}>
      <Text component="span" size="sm" {...stylex.props(styles.count, styles[glyphStyle])}>{children}</Text>
    </HotkeyTooltip>
  );
}

/**
 * `●4 ◐2 ?1 ◇1 … ✓9`: the thread's states by glyph and count, zero counts left out. `●` narrows to the open notes and
 * `✓` lets the resolved in; both again, or `F`, go back. With rows selected, the row becomes their actions.
 */
export function ReviewThreadFilter({ head, counts, filter, onFilter, actions }: ReviewThreadFilterProps) {
  const toggle = (to: 'open' | 'all') => onFilter(filter === to ? 'active' : to);
  if (actions.selected.size) {
    const ids = [...actions.selected];
    return (
      <Group gap="tight" wrap="nowrap" {...stylex.props(styles.row)}>
        {head}
        <Text component="span" size="sm" {...stylex.props(styles.count, styles.cream)}>{ids.length}</Text>
        <UnstyledButton onClick={() => actions.resolve(ids)} {...stylex.props(styles.chip, styles.cream)}><Text component="span" size="sm" inherit>Resolve</Text></UnstyledButton>
        <UnstyledButton onClick={() => actions.reopen(ids)} {...stylex.props(styles.chip, styles.cream)}><Text component="span" size="sm" inherit>Reopen</Text></UnstyledButton>
        <UnstyledButton onClick={() => actions.remove(ids)} {...stylex.props(styles.chip, styles.cream)}><Text component="span" size="sm" inherit>Delete</Text></UnstyledButton>
      </Group>
    );
  }
  // Nothing to name, count or copy (a fresh thread): no row at all, not an empty band.
  if (!head && !actions.copy && !counts.open && !counts.addressed && !counts.asks && !counts.keep && !counts.resolved) return null;
  return (
    <Group gap="hairline" wrap="nowrap" {...stylex.props(styles.row)}>
      {head}
      {counts.open > 0 && (
        <HotkeyTooltip name={filter === 'open' ? 'Show all live notes' : 'Only open notes'} hotkey="Filter">
          <UnstyledButton aria-label={`${counts.open} open`} aria-pressed={filter === 'open'} onClick={() => toggle('open')} {...stylex.props(styles.chip, styles.open, filter === 'open' && styles.lit)}>
            <Text component="span" size="sm" inherit>{REVIEW_THREAD_TONES.open.glyph}{counts.open}</Text>
          </UnstyledButton>
        </HotkeyTooltip>
      )}
      {counts.addressed > 0 && <Count glyphStyle="addressed" word={REVIEW_THREAD_TONES.addressed.word}>{REVIEW_THREAD_TONES.addressed.glyph}{counts.addressed}</Count>}
      {counts.asks > 0 && <Count glyphStyle="asks" word={REVIEW_THREAD_TONES.asks.word}>{REVIEW_THREAD_TONES.asks.glyph}{counts.asks}</Count>}
      {counts.keep > 0 && <Count glyphStyle="keep" word={REVIEW_THREAD_TONES.keep.word}>{REVIEW_THREAD_TONES.keep.glyph}{counts.keep}</Count>}
      <Box {...stylex.props(styles.end)} />
      {counts.addressed > 0 && <IconButton name="Resolve all addressed" onClick={() => actions.resolveAddressed()}><CheckCheck size={14} /></IconButton>}
      {actions.copy && (
        <IconButton name="Copy notes" onClick={() => void actions.copy?.()} active={actions.copied}>{actions.copied ? <Check size={14} /> : <Copy size={14} />}</IconButton>
      )}
      {counts.resolved > 0 && (
        <HotkeyTooltip name={filter === 'all' ? 'Hide resolved' : 'Show resolved'} hotkey="Filter">
          <UnstyledButton aria-label={`${counts.resolved} resolved`} aria-pressed={filter === 'all'} onClick={() => toggle('all')} {...stylex.props(styles.chip, styles.resolved, filter === 'all' && styles.lit)}>
            <Text component="span" size="sm" inherit>{REVIEW_THREAD_TONES.resolved.glyph}{counts.resolved}</Text>
          </UnstyledButton>
        </HotkeyTooltip>
      )}
    </Group>
  );
}
