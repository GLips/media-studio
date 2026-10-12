import { Group, Kbd, Text, Tooltip } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactElement } from 'react';
import { colors, fonts, typography } from './theme.stylex.ts';
import { useHotkeyLabel } from './use-hotkey-label.ts';

const styles = stylex.create({
  kbd: { fontFamily: fonts.mono, fontSize: typography.readout, color: colors.dim, backgroundColor: 'transparent' },
});

/** The tooltip's text, mounted only while it shows, so a screen's many buttons don't each watch the registry. */
function HotkeyTooltipLabel({ name, hotkey }: { readonly name: string; readonly hotkey: string }) {
  const keys = useHotkeyLabel(hotkey);
  return (
    <Group gap="tight" wrap="nowrap">
      <Text size="sm" component="span">{name}</Text>
      {keys && <Kbd size="xs" {...stylex.props(styles.kbd)}>{keys}</Kbd>}
    </Group>
  );
}

type HotkeyTooltipProps = {
  readonly name: string;
  /** The registered action (its meta `name`) whose key the tooltip shows. Absent, a label with no key. */
  readonly hotkey?: string;
  readonly children: ReactElement;
};

/**
 * `name <Kbd>` over its child: what it is, and the key of the action `hotkey` names, read from the hotkey registry so
 * the hint follows the binding. Only an explicit `hotkey` is looked up: a label's copy never picks up a key by chance.
 */
export function HotkeyTooltip({ name, hotkey, children }: HotkeyTooltipProps) {
  const label = hotkey === undefined ? <Text size="sm" component="span">{name}</Text> : <HotkeyTooltipLabel name={name} hotkey={hotkey} />;
  return <Tooltip label={label} openDelay={400} withinPortal>{children}</Tooltip>;
}
