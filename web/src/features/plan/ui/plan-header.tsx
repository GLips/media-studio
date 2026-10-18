import { Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { BookOpen, CircleHelp, Film, Send } from 'lucide-react';
import { AgentPresence } from '#web/shared/ui/agent-presence.tsx';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { formatPlanSeconds } from './plan-timing.ts';

const styles = stylex.create({
  header: { flex: 1, minWidth: 0 },
  crumb: { color: colors.dim, textDecoration: 'none', whiteSpace: 'nowrap' },
  title: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: colors.cream, fontWeight: 700 },
  pill: {
    display: 'inline-flex', alignItems: 'center', gap: spacing.tight, whiteSpace: 'nowrap', cursor: 'default',
    paddingInline: spacing.gap, height: '22px', borderRadius: radius.pill, backgroundColor: colors.panel, color: colors.dim,
  },
  button: { cursor: 'pointer', color: colors.cream, backgroundColor: { default: colors.panel, ':hover': colors.raised }, textDecoration: 'none' },
  asks: { color: colors.ground, backgroundColor: colors.caution, filter: { default: null, ':hover': 'brightness(1.12)' } },
  ok: { color: colors.pass },
  over: { color: colors.caution },
  past: { color: colors.danger },
  failed: { color: colors.danger },
});

/** `26.1 s · 2.1 s over the 24 s target`: amber past the target, red past the most it may run. */
function PlanLength() {
  const { plan, timing } = usePlanScreen();
  const { target } = plan.storyboard;
  if (!timing) return <Text component="span" {...stylex.props(styles.pill, styles.past)}>Doesn't time: see the scene with the problem</Text>;
  const seconds = timing.end / timing.fps, gap = seconds - target.seconds;
  const past = target.max !== undefined && seconds > target.max;
  const tone = (past && styles.past) || (gap > 0.05 && styles.over) || styles.ok;
  const said = (past && `over the ${target.max} s limit`) || (Math.abs(gap) <= 0.05 ? `on the ${target.seconds} s target` : `${formatPlanSeconds(Math.abs(gap))} ${gap > 0 ? 'over' : 'under'} the ${target.seconds} s target`);
  return (
    <HotkeyTooltip name={target.max === undefined ? `${seconds.toFixed(2)} s long` : `${seconds.toFixed(2)} s long; it may run ${target.max} s at most`}>
      <Text component="span" {...stylex.props(styles.pill)}>
        <Text component="span" inherit {...stylex.props(styles.title)}>{formatPlanSeconds(seconds)}</Text>
        <Text component="span" inherit {...stylex.props(tone)}>{said}</Text>
      </Text>
    </HotkeyTooltip>
  );
}

/** `1 of 4 scenes approved`, green once all are; changed ones counted apart. */
function PlanApprovedCount() {
  const { signoffs } = usePlanScreen();
  const all = [...signoffs.values()];
  if (!all.length) return null;
  const signed = all.filter((s) => s.state === 'signed').length;
  const stale = all.filter((s) => s.state === 'stale').length;
  return (
    <Text component="span" {...stylex.props(styles.pill, signed === all.length && styles.ok)}>
      {signed === all.length ? 'Every scene approved' : `${signed} of ${all.length} scenes approved`}
      {stale > 0 && <Text component="span" inherit {...stylex.props(styles.over)}> · {stale} changed since</Text>}
    </Text>
  );
}

/** Where the timing comes from, in words: estimated from word counts, a recorded voice, or the music. */
function PlanTimingSource() {
  const { plan } = usePlanScreen();
  const { lines } = plan.resolved;
  const grid = plan.storyboard.grid;
  if (!lines.length) {
    if (!grid) return null;
    return <Text component="span" {...stylex.props(styles.pill)}>{'music' in grid ? `Cut to ${grid.music}` : `Cut to a steady ${grid.tempo} bpm until there's music`}</Text>;
  }
  const estimated = lines.filter((l) => l.read === 'estimated').length;
  const said = (estimated === lines.length && 'Voice timed from word counts')
    || (estimated > 0 && `Voice recorded for ${lines.length - estimated} of ${lines.length} lines`)
    || (lines.some((l) => l.read === 'draft') ? 'Voice timed by a draft read' : 'Voice recorded');
  return (
    <HotkeyTooltip name={estimated > 0 ? 'Until a voice is recorded, each line is timed at about three words a second' : 'Timed by the recorded take'}>
      <Text component="span" {...stylex.props(styles.pill)}>{said}</Text>
    </HotkeyTooltip>
  );
}

/**
 * The plan's bar: back to the project, the title, its length against the target, scenes approved and where the timing
 * comes from; then the agent's open questions (a click opens the first), the brief, the animation's own review, and
 * the agent's presence.
 */
export function PlanHeader({ onOpenBrief }: { readonly onOpenBrief: () => void }) {
  const { project, pulse, plan, render, ops, threads, setSearch } = usePlanScreen();
  const open = (threads ?? []).filter((t) => t.state !== 'resolved');
  const asks = open.filter((t) => t.entries.at(-1)?.author === 'agent' && t.entries.at(-1)?.asks);
  // A note needs no sending: it's saved in the review file the agent reads. This says how many still wait on its answer.
  const waiting = open.filter((t) => t.entries.at(-1)?.author !== 'agent').length;
  return (
    <Group justify="space-between" wrap="nowrap" gap="gap" {...stylex.props(styles.header)}>
      <Group gap="inset" wrap="nowrap" {...stylex.props(styles.header)}>
        <AnchorLink to="/projects/$project" params={{ project }} underline="never" fz="sm" {...stylex.props(styles.crumb)}>{project}</AnchorLink>
        <Text component="span" size="md" title={plan.storyboard.title} {...stylex.props(styles.title)}>{plan.storyboard.title}</Text>
        <PlanLength />
        <PlanApprovedCount />
        <PlanTimingSource />
      </Group>
      <Group gap="gap" wrap="nowrap">
        {ops.failed && <UnstyledButton fz="sm" onClick={ops.retry} {...stylex.props(styles.pill, styles.button, styles.failed)}>Not saved · retry</UnstyledButton>}
        {asks.length > 0 && (
          <UnstyledButton fz="sm" onClick={() => setSearch({ note: asks[0].id, ...(asks[0].plan.scene !== null && { scene: asks[0].plan.scene }) })} {...stylex.props(styles.pill, styles.asks)}>
            <CircleHelp size={13} /> {asks.length} {asks.length === 1 ? 'question' : 'questions'} for you
          </UnstyledButton>
        )}
        {waiting > 0 && (
          <HotkeyTooltip name="Saved as you write them: an agent watching this project has them now, and any other reads them on its next turn">
            <Text component="span" {...stylex.props(styles.pill)}><Send size={13} /> {waiting} {waiting === 1 ? 'note' : 'notes'} with the agent</Text>
          </HotkeyTooltip>
        )}
        <UnstyledButton fz="sm" onClick={onOpenBrief} {...stylex.props(styles.pill, styles.button)}><BookOpen size={13} /> Brief</UnstyledButton>
        {render && (
          <HotkeyTooltip name={`Review ${render.path} frame by frame`}>
            <AnchorLink to="/projects/$project/artifacts/$" params={{ project, _splat: render.path }} underline="never" fz="sm" {...stylex.props(styles.pill, styles.button)}>
              <Film size={13} /> {render.path.includes('animatic') ? 'Animatic review' : 'Video review'}
            </AnchorLink>
          </HotkeyTooltip>
        )}
        <AgentPresence agent={pulse.agent} />
      </Group>
    </Group>
  );
}
