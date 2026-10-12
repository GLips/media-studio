import { Button, Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { reviewScriptSignoffStale } from '#lib/output/review/models/review-script.ts';
import { countReviewThreadTones } from '#lib/output/review/models/review-threads.ts';
import { useReviewOps, useReviewScreen, useReviewThreads } from '#web/features/review/index.ts';
import { AgentPresence, formatStudioClock } from '#web/shared/ui/agent-presence.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ReviewScriptRead, ReviewScriptTakeRead } from '../controllers/review-script.ts';

const styles = stylex.create({
  header: { flex: 1, minWidth: 0 },
  crumb: { color: colors.cream, paddingInline: spacing.tight, whiteSpace: 'nowrap' },
  project: { color: colors.dim },
  take: { color: colors.dim, cursor: 'default', whiteSpace: 'nowrap' },
  signOff: { color: colors.cream, backgroundColor: colors.accent, borderWidth: 0, borderRadius: radius.control },
  signed: { color: colors.pass, fontWeight: 600, cursor: 'default', whiteSpace: 'nowrap' },
  failed: { color: colors.danger, paddingInline: spacing.tight, borderRadius: radius.control, backgroundColor: { default: 'transparent', ':hover': colors.raised } },
});

/** The script's sign-off as it stands: not read yet, never given, given on these words, or on words since changed. */
type ScriptSignoffState = 'unknown' | 'unsigned' | 'signed' | 'stale';

type ScriptHeaderProps = { readonly script: ReviewScriptRead; readonly take: ReviewScriptTakeRead };

/**
 * The read-along's part of the bar: `project / script` and the take it plays. Right: a save that failed, the agent's
 * `◆`, and Sign off, the decision screen's accent button, which counts the notes still open on the script; once given
 * on these words it stands as `✓ signed off` in `pass`.
 */
export function ScriptHeader({ script, take }: ScriptHeaderProps) {
  const { project, pulse } = useReviewScreen();
  const ops = useReviewOps(project);
  const placed = useReviewThreads();
  const signoffs = placed?.signoffs;
  const open = countReviewThreadTones((placed?.threads ?? []).filter((t) => t.anchor.on === 'script')).open;
  const signed = signoffs?.findLast((s) => s.on === 'script');
  const stale = signoffs !== undefined && reviewScriptSignoffStale(signoffs, script.hash);
  const state: ScriptSignoffState = (signoffs === undefined && 'unknown') || (signed === undefined && 'unsigned') || (stale && 'stale') || 'signed';
  const signOff = () => void ops.apply([{ op: 'signoff', signoff: { on: 'script', hash: script.hash, at: new Date().toISOString() } }]);
  return (
    <Group justify="space-between" wrap="nowrap" gap="gap" {...stylex.props(styles.header)}>
      <Group gap="tight" wrap="nowrap">
        <Text component="span" size="sm" {...stylex.props(styles.crumb)}>
          <Text component="span" inherit {...stylex.props(styles.project)}>{project} / </Text>script
        </Text>
        <HotkeyTooltip name={`${script.voice ?? 'no voice'} · take ${take.hash}`}>
          <Text component="span" size="sm" {...stylex.props(styles.take)}>take: {take.label}</Text>
        </HotkeyTooltip>
      </Group>
      <Group gap="tight" wrap="nowrap">
        {ops.failed && (
          <UnstyledButton onClick={ops.retry} {...stylex.props(styles.failed)}><Text component="span" size="sm">not saved · retry</Text></UnstyledButton>
        )}
        <AgentPresence agent={pulse.agent} />
        {state === 'signed' && signed && (
          <HotkeyTooltip name={`signed off ${formatStudioClock(signed.at)}`}>
            <Text component="span" size="sm" {...stylex.props(styles.signed)}>✓ signed off</Text>
          </HotkeyTooltip>
        )}
        {(state === 'unsigned' || state === 'stale') && (
          <HotkeyTooltip name={[state === 'stale' ? 'Sign off · the words changed since' : 'Sign off', open > 0 && `${open} open`].filter(Boolean).join(' · ')}>
            <Button size="compact-xs" onClick={signOff} {...stylex.props(styles.signOff)}>Sign off{open > 0 && ` ●${open}`}</Button>
          </HotkeyTooltip>
        )}
      </Group>
    </Group>
  );
}
