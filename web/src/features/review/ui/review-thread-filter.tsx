import { Box, Group, Menu, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Check, CheckCheck, ChevronDown, Copy, Ellipsis, ScanEye, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { REVIEW_THREAD_TONES, type ReviewThreadTone } from '#lib/output/review/models/review-threads.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { useHotkeyLabel } from '#web/shared/ui/use-hotkey-label.ts';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewSearch } from '../controllers/review-search.ts';
import type { ReviewCheck, ReviewCheckStep } from './use-review-check-queue.ts';
import type { ReviewThreadActions } from './use-review-thread-panel.ts';

const styles = stylex.create({
  row: {
    minHeight: spacing.bar, flexShrink: 0, paddingInlineStart: spacing.inset, paddingInlineEnd: spacing.tight,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line,
  },
  title: { color: colors.cream, fontWeight: 600, whiteSpace: 'nowrap' },
  // The heading is the filter: what the list shows, in a word, and a menu of the other two.
  view: {
    display: 'inline-flex', alignItems: 'center', gap: spacing.hairline, height: spacing.rowDense, paddingInline: spacing.tight,
    marginInlineStart: `calc(-1 * ${spacing.tight})`, borderRadius: radius.control, whiteSpace: 'nowrap',
    color: colors.cream, fontWeight: 600, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  chevron: { color: colors.dim },
  hint: { color: colors.dim },
  more: { height: spacing.rowDense },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: spacing.tight, paddingInline: spacing.tight, borderRadius: radius.control,
    whiteSpace: 'nowrap', color: { default: colors.dim, ':hover': colors.cream }, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  count: { display: 'inline-flex', alignItems: 'center', gap: spacing.tight, paddingInline: spacing.tight, whiteSpace: 'nowrap', color: colors.dim, cursor: 'default' },
  open: { color: colors.accent },
  addressed: { color: colors.pass },
  asks: { color: colors.caution },
  resolved: { color: colors.dim },
  keep: { color: colors.cream },
  cream: { color: colors.cream },
  end: { marginInlineStart: 'auto' },
});

type ReviewThreadView = NonNullable<ReviewSearch['filter']>;

/** Each view by the heading it gives the thread, and what it shows besides, for its row in the heading's menu. */
const REVIEW_THREAD_VIEWS: readonly { readonly view: ReviewThreadView; readonly title: string; readonly hint: string }[] = [
  { view: 'active', title: 'Notes', hint: 'all but resolved' },
  { view: 'open', title: 'Open notes', hint: 'only the open' },
  { view: 'all', title: 'All notes', hint: 'resolved too' },
];

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
 * `Notes ▾  ● 1 open note  ◐ 2 to verify  ✓ 9 resolved   ⋯`: the heading is the filter, a menu of the thread's three
 * views (`F` cycles them), and the states follow in words, zero counts left out; Copy and Clear resolved wait behind ⋯.
 * With rows selected, the row becomes their actions; while the check queue walks, its place.
 */
export function ReviewThreadFilter({ head, counts, filter, onFilter, actions, check }: ReviewThreadFilterProps) {
  const filterKey = useHotkeyLabel('Filter');
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
  const empty = Object.values(counts).every((n) => n === 0);
  const title = REVIEW_THREAD_VIEWS.find((v) => v.view === filter)?.title ?? 'Notes';
  // Every state at once outgrows the side's width: the counts wrap rather than run under the actions.
  return (
    <Group gap="tight" {...stylex.props(styles.row)}>
      {head}
      {empty && !head && <Text component="span" size="sm" {...stylex.props(styles.title)}>Notes</Text>}
      {empty && <Text component="span" size="sm" {...stylex.props(styles.count)}>none yet</Text>}
      {empty || (
        <Menu position="bottom-start" withinPortal>
          {/* No tooltip: it would lie over the menu it opens. The menu names the key instead. */}
          <Menu.Target>
            <UnstyledButton {...stylex.props(styles.view)}>
              <Text component="span" size="sm" inherit>{title}</Text>
              <ChevronDown size={12} {...stylex.props(styles.chevron)} />
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            {REVIEW_THREAD_VIEWS.map(({ view, title: name, hint }) => (
              <Menu.Item key={view} onClick={() => onFilter(view)} leftSection={view === filter ? <Check size={14} /> : <Box w={14} />}
                rightSection={<Text component="span" size="sm" {...stylex.props(styles.hint)}>{hint}</Text>}>
                {name}
              </Menu.Item>
            ))}
            <Menu.Label>{filterKey && `${filterKey} steps through them`}</Menu.Label>
          </Menu.Dropdown>
        </Menu>
      )}
      {(['open', 'addressed', 'asks', 'keep', 'resolved'] as const).map((tone) => counts[tone] > 0 && (
        <Text key={tone} component="span" size="sm" {...stylex.props(styles.count)}><ReviewToneWords tone={tone} count={counts[tone]} /></Text>
      ))}
      {check?.start && <IconButton name="Check addressed" onClick={check.start}><ScanEye size={14} /></IconButton>}
      {/* The thread's own actions, held together at the row's end; the rare ones behind ⋯, so the bar stays calm. */}
      <Group gap={0} wrap="nowrap" {...stylex.props(styles.end)}>
        {counts.addressed > 0 && <IconButton name="Resolve all addressed" onClick={() => actions.resolveAddressed()}><CheckCheck size={14} /></IconButton>}
        {(actions.copy || counts.resolved > 0) && (
          <Menu position="bottom-end" withinPortal>
            <HotkeyTooltip name={actions.copied ? 'Copied' : 'More'}>
              <Menu.Target>
                <UnstyledButton aria-label="More" {...stylex.props(styles.chip, styles.more)}>{actions.copied ? <Check size={14} /> : <Ellipsis size={14} />}</UnstyledButton>
              </Menu.Target>
            </HotkeyTooltip>
            <Menu.Dropdown>
              {actions.copy && <Menu.Item leftSection={<Copy size={14} />} onClick={() => void actions.copy?.()}>Copy notes</Menu.Item>}
              {/* "Clear resolved" in full: "Clear" alone could be any of the counts. An Undo row in the list takes a slip back. */}
              {counts.resolved > 0 && <Menu.Item leftSection={<Trash2 size={14} />} onClick={actions.clearResolved}>Clear resolved</Menu.Item>}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </Group>
  );
}
