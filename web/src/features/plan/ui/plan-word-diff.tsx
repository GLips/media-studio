import { Box, Button, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Fragment } from 'react';
import { formatReviewPlanTextKey, reviewPlanWordDiff, type ReviewPlanFieldChange } from '#lib/output/review/models/review-plan.ts';
import type { PlacedReviewThread } from '#lib/output/review/models/review-placement.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { usePlanScreen } from './plan-screen-context.tsx';

const styles = stylex.create({
  diff: { color: colors.dim, lineHeight: typography.lineHeight, overflowWrap: 'anywhere', paddingInline: spacing.tight },
  same: {},
  removed: { color: colors.dim, textDecorationLine: 'line-through', opacity: 0.7 },
  added: { color: colors.cream, backgroundColor: colors.raised, borderRadius: radius.control, paddingInline: spacing.hairline },
  key: { color: colors.dim, paddingInlineEnd: spacing.gap },
  keep: { color: colors.dim, borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line, borderRadius: radius.control, marginTop: spacing.tight },
});

const PLAN_DIFF_TAGS = { same: 'span', removed: 'del', added: 'ins' } as const;

/** `was` against `now`, word by word: removed words struck and dim, added ones lit, the rest as it reads. */
export function PlanWordDiff({ was, now, label }: { readonly was: string; readonly now: string; readonly label?: string }) {
  return (
    <Text component="div" size="sm" {...stylex.props(styles.diff)}>
      {label !== undefined && <Text component="span" inherit {...stylex.props(styles.key)}>{label}</Text>}
      {reviewPlanWordDiff(was, now).map((run, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- a run's place in the diff is its identity
        <Fragment key={i}>
          {i > 0 && ' '}
          <Text component={PLAN_DIFF_TAGS[run.kind]} inherit {...stylex.props(styles[run.kind])}>{run.text}</Text>
        </Fragment>
      ))}
    </Text>
  );
}

/** A stale scene's fields, each reworded since its sign-off, as diffs against what was signed. */
export function PlanSceneChanges({ changes }: { readonly changes: readonly ReviewPlanFieldChange[] }) {
  if (!changes.length) return <Text size="sm" {...stylex.props(styles.diff)}>Changed since signed off: its timing moved, its words are as signed.</Text>;
  return changes.map((c) => <PlanWordDiff key={c.key} label={formatReviewPlanTextKey(c.key)} was={c.was} now={c.now} />);
}

/**
 * A plan note's field reworded since the note, as a diff, with **Keep the old wording**: a reply that reopens the
 * note asking for the text back. Nothing on a note whose field reads as it did.
 */
export function PlanNoteChange({ thread }: { readonly thread: PlacedReviewThread }) {
  const { threads, ops } = usePlanScreen();
  const placed = threads?.find((t) => t.id === thread.id);
  const changed = placed?.plan.changed;
  if (!changed) return null;
  const keepOld = () => void ops.apply([{ op: 'thread.reply', id: thread.id, text: `Keep the old wording: "${changed.was}"`, transition: 'reopened' }]);
  return (
    <Box onClick={(event) => event.stopPropagation()}>
      <PlanWordDiff was={changed.was} now={changed.now} />
      {thread.state !== 'resolved' && (
        <HotkeyTooltip name="Reopen the note, asking for the wording it had when you wrote it">
          <Button size="compact-xs" variant="subtle" onClick={keepOld} {...stylex.props(styles.keep)}>Keep the old wording</Button>
        </HotkeyTooltip>
      )}
    </Box>
  );
}
