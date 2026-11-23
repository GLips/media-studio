import { Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReviewDecision } from '#lib/output/review/models/review-threads.ts';
import type { StoryboardScenes } from '#lib/timing/storyboard/models/storyboard.ts';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useDecisionScreen } from './decision-screen-context.tsx';

const styles = stylex.create({
  about: { paddingInline: spacing.inset, paddingBlockStart: spacing.inset, minWidth: 0 },
  place: { color: colors.dim, whiteSpace: 'nowrap', flexShrink: 0 },
  line: { color: colors.cream, minWidth: 0 },
});

/** The text of the line `decision` is about, as storyboard.ts has it now; undefined when it's about no line, or the line is gone. */
export function decisionLineTextOf(scenes: StoryboardScenes | null, { about }: ReviewDecision): string | undefined {
  if (!scenes || about?.line === undefined) return undefined;
  return scenes[about.scene]?.lines?.[about.line]?.text;
}

/**
 * What in the story the decision is for, over its candidates: `hook · open` and the line's words, read as the take is
 * heard. Nothing for a decision about no scene: its question in the bar says it all.
 */
export function DecisionAbout() {
  const { decision, pass } = useDecisionScreen();
  const { about } = decision;
  if (!about) return null;
  const line = decisionLineTextOf(pass.scenes, decision);
  return (
    <Group gap="gap" wrap="nowrap" align="baseline" {...stylex.props(styles.about)}>
      <Text component="span" size="sm" {...stylex.props(styles.place)}>{about.scene}{about.line !== undefined && ` · ${about.line}`}</Text>
      {line !== undefined && <Text component="span" size="lg" {...stylex.props(styles.line)}>“{line}”</Text>}
    </Group>
  );
}
