import { ActionIcon } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { HotkeyTooltip } from './hotkey-tooltip.tsx';
import { colors, radius } from './theme.stylex.ts';

const styles = stylex.create({
  button: {
    color: { default: colors.dim, ':hover': colors.cream },
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
    borderRadius: radius.control,
    outlineColor: colors.cream,
    outlineOffset: '1px',
    outlineWidth: { default: 0, ':focus-visible': '1px' },
    outlineStyle: 'solid',
  },
  // Filled, not just brighter: a chosen tool or a toggle that's on has to read apart from its dim neighbours.
  active: { color: colors.cream, backgroundColor: colors.raised },
});

type IconButtonProps = {
  /** The action's name: its tooltip, its accessible label, and the registered action whose key the tooltip shows. */
  readonly name: string;
  /** The registered action whose key the tooltip shows, where the name says more than it (`Up to sandbox`, `Up`). */
  readonly hotkey?: string;
  readonly children: ReactNode;
  readonly onClick?: () => void;
  /** Drawn lit: a toggle that's on, a menu that's open. */
  readonly active?: boolean;
  readonly disabled?: boolean;
};

/** A glyph that does one thing, its name and key in its tooltip. The bar, the transport and row actions use it. */
export function IconButton({ name, hotkey = name, children, onClick, active = false, disabled = false }: IconButtonProps) {
  return (
    <HotkeyTooltip name={name} hotkey={hotkey}>
      <ActionIcon aria-label={name} onClick={onClick} disabled={disabled} {...stylex.props(styles.button, active && styles.active)}>
        {children}
      </ActionIcon>
    </HotkeyTooltip>
  );
}
