import { Button, Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { reviewDecisionRefusalOf } from '#lib/output/review/models/review-ops.ts';
import { countReviewThreadTones, type ReviewDecision } from '#lib/output/review/models/review-threads.ts';
import type { DecodedReviewOp } from '#web/features/review/index.ts';
import { AgentPresence, formatStudioClock } from '#web/shared/ui/agent-presence.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useDecisionScreen } from './decision-screen-context.tsx';

const styles = stylex.create({
  header: { flex: 1, minWidth: 0 },
  crumb: { color: colors.cream, paddingInline: spacing.tight, whiteSpace: 'nowrap' },
  retry: {
    paddingInline: spacing.tight, borderRadius: radius.control, whiteSpace: 'nowrap',
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  project: { color: colors.dim },
  question: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.cream },
  middle: { minWidth: 0, flex: 1 },
  failed: { color: colors.danger },
  chip: {
    color: colors.pass, paddingInline: spacing.tight, borderRadius: radius.control, whiteSpace: 'nowrap',
    borderWidth: '1px', borderStyle: 'solid', borderColor: colors.pass,
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  signOff: {
    color: colors.cream, backgroundColor: { default: colors.accent, ':disabled': colors.raised },
    borderWidth: 0, borderRadius: radius.control, opacity: { default: 1, ':disabled': 0.5 },
  },
  verdict: { color: colors.pass, whiteSpace: 'nowrap', cursor: 'default', fontWeight: 600 },
});

/** The picks a closed decision was signed off with, by their labels. */
const pickedLabels = (decision: ReviewDecision) =>
  decision.candidates.filter((c) => decision.decided?.picks.includes(c.key)).map((c) => c.label).join(', ');

/**
 * The decision's part of the shell's bar: `project / topic`, the question and a `picks` chip while `F` hides the rest,
 * then a save that failed, the agent's presence and the screen's one primary action, Sign off, which opens the next
 * open decision. Once signed off, the picks stand there in `pass`.
 */
export function DecisionHeader() {
  const { project, topic, view, decision, ops, signOff, search, setSearch } = useDecisionScreen();
  const close: DecodedReviewOp[] = [{ op: 'decision.close', id: decision.id }];
  const refused = reviewDecisionRefusalOf(decision, close);
  const open = countReviewThreadTones(view.threads.filter((t) => t.anchor.on === 'decision' && t.anchor.decision === decision.id)).open;
  return (
    <Group justify="space-between" wrap="nowrap" gap="gap" {...stylex.props(styles.header)}>
      <Text component="span" size="sm" {...stylex.props(styles.crumb)}><Text component="span" inherit {...stylex.props(styles.project)}>{project} / </Text>{topic}</Text>
      <Group gap="gap" wrap="nowrap" {...stylex.props(styles.middle)}>
        <Text component="span" size="md" title={decision.question} {...stylex.props(styles.question)}>{decision.question}</Text>
        {search.filter === 'picks' && search.view !== 'two' && (
          <HotkeyTooltip name="Picks only" hotkey="Picks only">
            <UnstyledButton onClick={() => setSearch({ filter: undefined })} {...stylex.props(styles.chip)}>
              <Text component="span" size="sm" inherit>picks ✕</Text>
            </UnstyledButton>
          </HotkeyTooltip>
        )}
      </Group>
      <Group gap="gap" wrap="nowrap">
        {ops.failed && (
          <UnstyledButton onClick={ops.retry} {...stylex.props(styles.retry)}><Text component="span" size="sm" {...stylex.props(styles.failed)}>not saved · retry</Text></UnstyledButton>
        )}
        <AgentPresence agent={view.agent} />
        {decision.state === 'open' && (
          <HotkeyTooltip name={refused ?? (open > 0 ? `Sign off · ${open} open` : 'Sign off')} hotkey="Sign off">
            {/* A disabled button takes no pointer, so the tooltip hangs on a wrapper that does. */}
            <Group component="span">
              <Button size="compact-xs" disabled={refused !== null} onClick={signOff} {...stylex.props(styles.signOff)}>Sign off{open > 0 && ` ●${open}`}</Button>
            </Group>
          </HotkeyTooltip>
        )}
        {decision.state === 'decided' && decision.decided && (
          <HotkeyTooltip name={`signed off ${formatStudioClock(decision.decided.at)}`}>
            <Text component="span" size="sm" {...stylex.props(styles.verdict)}>✓ {pickedLabels(decision)}</Text>
          </HotkeyTooltip>
        )}
      </Group>
    </Group>
  );
}
