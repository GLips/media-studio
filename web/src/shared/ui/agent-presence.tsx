import { Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Bot } from 'lucide-react';
import { HotkeyTooltip } from './hotkey-tooltip.tsx';
import { colors } from './theme.stylex.ts';

const styles = stylex.create({
  // Decoration, not a control: it never reacts to the pointer.
  agent: { color: colors.dim, cursor: 'default' },
  here: { color: colors.cream },
});

/** `12:04`: a time of day in the bar, the agent's or a sign-off's. */
export const formatStudioClock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

/** The bar's `agent`: cream while a `studio review watch` beats, dim otherwise; the tooltip says since when. */
export function AgentPresence({ agent }: { readonly agent: { readonly since: string } | null | undefined }) {
  return (
    <HotkeyTooltip name={agent ? `watching since ${formatStudioClock(agent.since)}` : 'no agent watching'}>
      <Group component="span" gap="tight" wrap="nowrap" {...stylex.props(styles.agent, agent && styles.here)}>
        <Bot size={14} />
        <Text component="span" size="sm" inherit>agent</Text>
      </Group>
    </HotkeyTooltip>
  );
}
