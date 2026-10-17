import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { PlanInline } from './plan-inline.tsx';
import { usePlanScreen } from './plan-screen-context.tsx';
import { PlanTargetBox } from './plan-target-box.tsx';
import { PlanThreadMarks } from './plan-thread-marks.tsx';

const styles = stylex.create({
  section: { paddingBlock: spacing.inset, borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line },
  heading: { color: colors.dim, paddingInline: spacing.inset, height: spacing.row, display: 'flex', alignItems: 'center' },
  list: { margin: 0, padding: 0, listStyle: 'none', maxWidth: '96ch', paddingInline: spacing.gap },
  item: { display: 'flex', gap: spacing.gap, alignItems: 'baseline', padding: spacing.tight, color: colors.cream },
  dash: { color: colors.dim },
  text: { flex: 1, minWidth: 0 },
});

/** What the video deliberately leaves out, and why: an item each, its notes' marks on the item their quote is in. */
export function PlanLeftOut() {
  const { plan, threads } = usePlanScreen();
  const items = plan.storyboard.leftOut ?? [];
  if (!items.length) return null;
  const placed = (threads ?? []).filter((t) => !t.plan.unplaced && t.anchor.field === 'leftOut');
  return (
    <Box component="section" aria-label="Left out" {...stylex.props(styles.section)}>
      {/* A note that quotes no item (`studio review ask --left-out` with no --quote) is on the list as a whole. */}
      <Text component="h2" size="sm" {...stylex.props(styles.heading)}>left out<PlanThreadMarks threads={placed.filter((t) => t.plan.item === null)} /></Text>
      <Box component="ul" {...stylex.props(styles.list)}>
        {items.map((item, k) => (
          <PlanTargetBox key={item} component="li" target={{ field: 'leftOut', item: k }}>
            <Box {...stylex.props(styles.item)}>
              <Text component="span" size="md" {...stylex.props(styles.dash)}>–</Text>
              <Text component="span" size="md" {...stylex.props(styles.text)}><PlanInline text={item} /></Text>
              <PlanThreadMarks threads={placed.filter((t) => t.plan.item === k)} />
            </Box>
          </PlanTargetBox>
        ))}
      </Box>
    </Box>
  );
}
