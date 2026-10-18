import { Group, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { formatReviewPlanNoteWhere } from '#lib/output/review/models/review-plan.ts';
import { ReviewThreadKindIcon } from '#web/features/review/index.ts';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, radius, spacing, typography } from '#web/shared/ui/theme.stylex.ts';
import { planThreadMarkOf, planUnquotedAttributes, type PlanPlacedThread } from './plan-notes.ts';
import { usePlanScreen } from './plan-screen-context.tsx';

const styles = stylex.create({
  marks: { display: 'inline-flex', gap: 0, flexShrink: 0 },
  mark: {
    display: 'inline-flex', alignItems: 'center', height: typography.lineHeight, paddingInline: spacing.tight, borderRadius: radius.control,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  focused: { backgroundColor: colors.raised },
  accent: { color: colors.accent },
  pass: { color: colors.pass },
  caution: { color: colors.caution },
  dim: { color: colors.dim },
});

/** The open threads on one anchor, each its kind's icon in its state's colour: click one to open it in the thread. Resolved ones leave it. */
export function PlanThreadMarks({ threads }: { readonly threads: readonly PlanPlacedThread[] }) {
  const { search, setSearch } = usePlanScreen();
  const shown = threads.filter((t) => t.state !== 'resolved');
  if (!shown.length) return null;
  return (
    <Group component="span" wrap="nowrap" {...planUnquotedAttributes} {...stylex.props(styles.marks)}>
      {shown.map((thread) => {
        const mark = planThreadMarkOf(thread);
        const label = `#${thread.id} · ${mark.word} · ${formatReviewPlanNoteWhere(thread.anchor, { short: true })}`;
        return (
          <HotkeyTooltip key={thread.id} name={label}>
            <UnstyledButton aria-label={label} onClick={() => setSearch({ note: thread.id })}
              {...stylex.props(styles.mark, styles[mark.tone], search.note === thread.id && styles.focused)}>
              <ReviewThreadKindIcon kind={thread.kind} size={14} />
            </UnstyledButton>
          </HotkeyTooltip>
        );
      })}
    </Group>
  );
}
