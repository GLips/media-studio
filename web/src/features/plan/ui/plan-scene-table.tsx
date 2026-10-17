import { Box, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { planSceneColumnStyles, PlanSceneRow } from './plan-scene-row.tsx';
import { usePlanScreen } from './plan-screen-context.tsx';

const styles = stylex.create({
  head: {
    height: spacing.row, alignItems: 'center',
    paddingInlineEnd: spacing.inset, paddingInlineStart: `calc(${spacing.gap} + ${spacing.hairline})`, color: colors.dim,
  },
  label: { paddingInline: spacing.tight },
});

const PLAN_TABLE_HEADS = ['scene', 'lines', 'on screen', 'motion', 'reads'] as const;

/** The scene table: a head naming its columns, then a row per scene in plan order. */
export function PlanSceneTable() {
  const { plan, timing } = usePlanScreen();
  return (
    <Box component="section" aria-label="Scenes">
      <Box {...stylex.props(planSceneColumnStyles.columns, styles.head)}>
        {PLAN_TABLE_HEADS.map((head) => <Text key={head} component="span" size="sm" {...stylex.props(styles.label)}>{head}</Text>)}
      </Box>
      {Object.keys(plan.storyboard.scenes).map((id, i) => (
        <PlanSceneRow key={id} id={id} n={i + 1} timed={timing?.scenes.find((s) => s.id === id) ?? null} />
      ))}
    </Box>
  );
}
