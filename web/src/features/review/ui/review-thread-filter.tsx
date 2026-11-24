import { Box, Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Check, CheckCheck, Copy, ScanEye } from 'lucide-react';
import type { ReactNode } from 'react';
import { REVIEW_THREAD_TONES, type ReviewThreadTone } from '#lib/output/review/models/review-threads.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewSearch } from '../controllers/review-search.ts';
import type { ReviewCheck, ReviewCheckStep } from './use-review-check-queue.ts';
import type { ReviewThreadActions } from './use-review-thread-panel.ts';

const styles = stylex.create({
  row: {
    minHeight: spacing.row, flexShrink: 0, paddingInlineStart: spacing.inset, paddingInlineEnd: spacing.tight,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line,
  },
  title: { color: colors.cream, fontWeight: 600, paddingInlineEnd: spacing.tight, whiteSpace: 'nowrap' },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: spacing.tight, paddingInline: spacing.tight, borderRadius: radius.control,
    whiteSpace: 'nowrap', color: { default: colors.dim, ':hover': colors.cream }, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  // A filter is edged at rest, so it reads as a control beside the bare counts; lit, it fills.
  filter: { height: spacing.rowDense, borderWidth: '1px', borderStyle: 'solid', borderColor: { default: colors.line, ':hover': colors.dim } },
  lit: { color: colors.cream, backgroundColor: colors.raised },
  count: { display: 'inline-flex', alignItems: 'center', gap: spacing.tight, paddingInline: spacing.tight, whiteSpace: 'nowrap', color: colors.dim, cursor: 'default' },
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
  /** What the thread is about, leading the row in the place of `Notes` (ReviewThreadPanel's `head`). */
  readonly head?: ReactNode;
  readonly counts: ReviewThreadCounts;
  readonly filter: NonNullable<ReviewSearch['filter']>;
  readonly onFilter: (filter: NonNullable<ReviewSearch['filter']>) => void;
  readonly actions: ReviewThreadActions;
  /** The check queue, on a render's thread: its button by the addressed count, and the row it becomes while checking. */
  readonly check?: ReviewCheck;
};

/** A state's count in words, the index's words (`THREAD_COUNT_WORDS`): `1 open note`, `2 to verify`, `3 questions`. */
const REVIEW_THREAD_COUNT_WORDS: Readonly<Record<ReviewThreadTone, (count: number) => string>> = {
  open: (count) => (count === 1 ? '1 open note' : `${count} open notes`),
  addressed: (count) => `${count} to verify`,
  asks: (count) => (count === 1 ? '1 question' : `${count} questions`),
  keep: (count) => `${count} to keep`,
  resolved: (count) => `${count} resolved`,
};

/** The state's glyph in its colour, then its count in words: the glyph is each row's, so the header is their legend. */
function ReviewToneWords({ tone, count }: { readonly tone: ReviewThreadTone; readonly count: number }) {
  return (
    <>
      <Text component="span" size="sm" {...stylex.props(styles[tone])}>{REVIEW_THREAD_TONES[tone].glyph}</Text>
      <Text component="span" size="sm" inherit>{REVIEW_THREAD_COUNT_WORDS[tone](count)}</Text>
    </>
  );
}

/** `Checking 3 of 12 · Esc   vs r12`: the row while the check queue walks the addressed notes; Esc, or a click, leaves. */
function ReviewCheckRow({ head, step }: { readonly head?: ReactNode; readonly step: ReviewCheckStep }) {
  return (
    <Group gap="tight" wrap="nowrap" {...stylex.props(styles.row)}>
      {head}
      <Text component="span" size="sm" {...stylex.props(styles.count, styles.addressed)}>Checking {step.at} of {step.of} ·</Text>
      <HotkeyTooltip name="Leave check">
        <UnstyledButton onClick={step.leave} {...stylex.props(styles.chip)}><Text component="span" size="sm" inherit>Esc</Text></UnstyledButton>
      </HotkeyTooltip>
      <Box {...stylex.props(styles.end)} />
      <Text component="span" size="sm" {...stylex.props(styles.count, step.compare.vs ? styles.cream : styles.resolved)}>{step.compare.label}</Text>
    </Group>
  );
}

/**
 * `Notes  ● 1 open note  ◐ 2 to verify  ? 1 question  ✓ 9 resolved`: the thread's states in words, zero counts left out.
 * `open` and `resolved` are its two filters: `open` narrows to the open notes, `resolved` lets the resolved in; either
 * again, or `F`, goes back. With rows selected, the row becomes their actions; while the check queue walks, its place.
 */
export function ReviewThreadFilter({ head, counts, filter, onFilter, actions, check }: ReviewThreadFilterProps) {
  const toggle = (to: 'open' | 'all') => onFilter(filter === to ? 'active' : to);
  if (actions.selected.size) {
    const ids = [...actions.selected];
    return (
      <Group gap="tight" wrap="nowrap" {...stylex.props(styles.row)}>
        {head}
        <Text component="span" size="sm" {...stylex.props(styles.count, styles.cream)}>{ids.length} selected</Text>
        <UnstyledButton onClick={() => actions.resolve(ids)} {...stylex.props(styles.chip, styles.cream)}><Text component="span" size="sm" inherit>Resolve</Text></UnstyledButton>
        <UnstyledButton onClick={() => actions.reopen(ids)} {...stylex.props(styles.chip, styles.cream)}><Text component="span" size="sm" inherit>Reopen</Text></UnstyledButton>
        <UnstyledButton onClick={() => actions.remove(ids)} {...stylex.props(styles.chip, styles.cream)}><Text component="span" size="sm" inherit>Delete</Text></UnstyledButton>
      </Group>
    );
  }
  if (check?.step) return <ReviewCheckRow head={head} step={check.step} />;
  // Every state at once outgrows the side's width: the counts wrap rather than run under the actions.
  return (
    <Group gap="tight" {...stylex.props(styles.row)}>
      {head ?? <Text component="span" size="sm" {...stylex.props(styles.title)}>Notes</Text>}
      {Object.values(counts).every((n) => n === 0) && <Text component="span" size="sm" {...stylex.props(styles.count)}>none yet</Text>}
      {counts.open > 0 && (
        <HotkeyTooltip name={filter === 'open' ? 'Show every live note' : 'Show only open notes'} hotkey="Filter">
          <UnstyledButton aria-pressed={filter === 'open'} onClick={() => toggle('open')} {...stylex.props(styles.chip, styles.filter, filter === 'open' && styles.lit)}>
            <ReviewToneWords tone="open" count={counts.open} />
          </UnstyledButton>
        </HotkeyTooltip>
      )}
      {counts.addressed > 0 && <Text component="span" size="sm" {...stylex.props(styles.count)}><ReviewToneWords tone="addressed" count={counts.addressed} /></Text>}
      {check?.start && <IconButton name="Check addressed" onClick={check.start}><ScanEye size={14} /></IconButton>}
      {counts.asks > 0 && <Text component="span" size="sm" {...stylex.props(styles.count)}><ReviewToneWords tone="asks" count={counts.asks} /></Text>}
      {counts.keep > 0 && <Text component="span" size="sm" {...stylex.props(styles.count)}><ReviewToneWords tone="keep" count={counts.keep} /></Text>}
      {counts.resolved > 0 && (
        <HotkeyTooltip name={filter === 'all' ? 'Hide resolved notes' : 'Show resolved notes'} hotkey="Filter">
          <UnstyledButton aria-pressed={filter === 'all'} onClick={() => toggle('all')} {...stylex.props(styles.chip, styles.filter, filter === 'all' && styles.lit)}>
            <ReviewToneWords tone="resolved" count={counts.resolved} />
          </UnstyledButton>
        </HotkeyTooltip>
      )}
      {/* Beside the resolved count, so `resolved` is said once: an Undo row in the list takes a slip back. */}
      {counts.resolved > 0 && (
        <HotkeyTooltip name="Clear the resolved notes">
          <UnstyledButton onClick={actions.clearResolved} {...stylex.props(styles.chip)}><Text component="span" size="sm" inherit>Clear</Text></UnstyledButton>
        </HotkeyTooltip>
      )}
      <Box {...stylex.props(styles.end)} />
      {counts.addressed > 0 && <IconButton name="Resolve all addressed" onClick={() => actions.resolveAddressed()}><CheckCheck size={14} /></IconButton>}
      {actions.copy && (
        <IconButton name="Copy notes" onClick={() => void actions.copy?.()} active={actions.copied}>{actions.copied ? <Check size={14} /> : <Copy size={14} />}</IconButton>
      )}
    </Group>
  );
}
