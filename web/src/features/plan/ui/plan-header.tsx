import { Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { StoryboardLineRead } from '#lib/timing/storyboard/models/resolve-storyboard.ts';
import { AgentPresence } from '#web/shared/ui/agent-presence.tsx';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { formatPlanSeconds } from './plan-timing.ts';

const styles = stylex.create({
  header: { flex: 1, minWidth: 0 },
  crumb: { color: colors.cream, paddingInline: spacing.tight, whiteSpace: 'nowrap' },
  project: { color: colors.dim },
  title: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.cream },
  fact: { color: colors.dim, whiteSpace: 'nowrap', cursor: 'default' },
  strong: { color: colors.cream },
  over: { color: colors.caution },
  past: { color: colors.danger },
  allSigned: { color: colors.pass },
  link: {
    color: colors.cream, paddingInline: spacing.tight, borderRadius: radius.control, whiteSpace: 'nowrap', textDecoration: 'none',
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  failed: { color: colors.danger, paddingInline: spacing.tight, borderRadius: radius.control, backgroundColor: { default: 'transparent', ':hover': colors.raised } },
});

const READ_WORDS: Readonly<Record<StoryboardLineRead, string>> = { recorded: 'recorded', draft: 'draft read', estimated: 'estimated' };

const READ_TOOLTIPS: Readonly<Record<StoryboardLineRead, string>> = {
  recorded: 'timed by the recorded take',
  draft: 'timed by a draft read (macOS say): fine for timing, never for delivery',
  estimated: 'timed from each line\'s word count: no take says these lines yet',
};

/** `estimated`, or `recorded 3 · estimated 2` once a take covers some lines: where the timing came from. */
function PlanTimingSource() {
  const { plan } = usePlanScreen();
  const { lines } = plan.resolved;
  const grid = plan.storyboard.grid;
  if (!lines.length) {
    if (!grid) return null;
    const name = 'music' in grid ? grid.music : `${grid.tempo} bpm`;
    return <HotkeyTooltip name={'music' in grid ? 'cut on the fitted track\'s beats' : 'cut on a steady tempo'}><Text component="span" size="sm" {...stylex.props(styles.fact)}>♪ {name}</Text></HotkeyTooltip>;
  }
  const reads = (['recorded', 'draft', 'estimated'] as const).map((read) => ({ read, count: lines.filter((l) => l.read === read).length })).filter((r) => r.count > 0);
  const label = reads.length === 1 ? READ_WORDS[reads[0].read] : reads.map((r) => `${READ_WORDS[r.read]} ${r.count}`).join(' · ');
  return (
    <HotkeyTooltip name={reads.map((r) => `${reads.length > 1 ? `${r.count}: ` : ''}${READ_TOOLTIPS[r.read]}`).join('; ')}>
      <Text component="span" size="sm" {...stylex.props(styles.fact)}>{label}</Text>
    </HotkeyTooltip>
  );
}

/** `23.8 s of 24`: amber past the target, red past the most it may run. */
function PlanLength() {
  const { plan, timing } = usePlanScreen();
  const { target } = plan.storyboard;
  if (!timing) return <Text component="span" size="sm" {...stylex.props(styles.fact)}>doesn't time · target {formatPlanSeconds(target.seconds)}</Text>;
  const seconds = timing.end / timing.fps;
  const tone = (target.max !== undefined && seconds > target.max && styles.past) || (seconds > target.seconds && styles.over) || styles.strong;
  const tip = `${seconds.toFixed(2)} s against a target of ${target.seconds} s${target.max === undefined ? '' : `, ${target.max} s at most`}`;
  return (
    <HotkeyTooltip name={tip}>
      <Text component="span" size="sm" {...stylex.props(styles.fact)}>
        <Text component="span" inherit {...stylex.props(tone)}>{formatPlanSeconds(seconds)}</Text> of {target.seconds}{target.max !== undefined && ` (≤ ${target.max})`}
      </Text>
    </HotkeyTooltip>
  );
}

/** `3 of 4 signed`, in `pass` once every scene is. */
function PlanSignedCount() {
  const { signoffs } = usePlanScreen();
  const all = [...signoffs.values()];
  const signed = all.filter((s) => s.state === 'signed').length;
  const stale = all.filter((s) => s.state === 'stale').length;
  if (!all.length) return null;
  const tip = [`${signed} of ${all.length} scenes signed off`, stale > 0 && `${stale} changed since`].filter(Boolean).join(' · ');
  return (
    <HotkeyTooltip name={tip}>
      <Text component="span" size="sm" {...stylex.props(styles.fact, signed === all.length && styles.allSigned)}>
        {signed === all.length ? '✓ all signed' : `${signed} of ${all.length} signed`}
      </Text>
    </HotkeyTooltip>
  );
}

/**
 * The plan's part of the bar: `project / plan`, the title, its length against the target, the scenes signed, where the
 * timing came from, and Animatic ↗ once a render exists. Right: a save that failed and the agent's `◆`.
 */
export function PlanHeader() {
  const { project, pulse, plan, render, ops } = usePlanScreen();
  return (
    <Group justify="space-between" wrap="nowrap" gap="gap" {...stylex.props(styles.header)}>
      <Group gap="inset" wrap="nowrap" {...stylex.props(styles.header)}>
        <Text component="span" size="sm" {...stylex.props(styles.crumb)}>
          <Text component="span" inherit {...stylex.props(styles.project)}>{project} / </Text>plan
        </Text>
        <Text component="span" size="sm" title={plan.storyboard.title} {...stylex.props(styles.title)}>{plan.storyboard.title}</Text>
        <PlanLength />
        <PlanSignedCount />
        <PlanTimingSource />
        {render && (
          <HotkeyTooltip name={`the video review of ${render.path}`}>
            <AnchorLink to="/projects/$project/artifacts/$" params={{ project, _splat: render.path }} underline="never" {...stylex.props(styles.link)}>
              <Text component="span" size="sm" inherit>{render.path.includes('animatic') ? 'Animatic' : 'Video'} ↗</Text>
            </AnchorLink>
          </HotkeyTooltip>
        )}
      </Group>
      <Group gap="tight" wrap="nowrap">
        {ops.failed && (
          <UnstyledButton onClick={ops.retry} {...stylex.props(styles.failed)}><Text component="span" size="sm">not saved · retry</Text></UnstyledButton>
        )}
        <AgentPresence agent={pulse.agent} />
      </Group>
    </Group>
  );
}
