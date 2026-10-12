import { Group } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useNavigate } from '@tanstack/react-router';
import { ChevronLeft, Keyboard, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './icon-button.tsx';
import { colors, spacing, typography } from './theme.stylex.ts';
import { type StudioUpTarget, useStudioUp } from './use-global-hotkeys.ts';

const styles = stylex.create({
  bar: {
    height: spacing.bar, paddingInline: spacing.tight, fontSize: typography.chrome, lineHeight: typography.lineHeight,
    borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: colors.line, backgroundColor: colors.ground,
    minWidth: 0,
  },
  start: { minWidth: 0, flex: 1 },
});

type StudioHeaderProps = {
  /** Where this screen is, left of centre: the crumbs, the file and render menus. */
  readonly start?: ReactNode;
  /** The screen's own state, before the global buttons: agent presence, a save that failed. */
  readonly end?: ReactNode;
  readonly onQuickOpen: () => void;
  readonly onCheatsheet: () => void;
};

/** `◂`'s tooltip: where it leads, since a level up isn't always the crumb beside it. */
const studioUpLabelOf = (up: StudioUpTarget) => (up.to === '/' ? 'Up to studio' : `Up to ${up.params.project}`);

/** The 28px bar over every screen: `◂` up a level (none on the dashboard), the screen's own items, then quick-open and the keys. */
export function StudioHeader({ start, end, onQuickOpen, onCheatsheet }: StudioHeaderProps) {
  const navigate = useNavigate();
  const up = useStudioUp();
  return (
    <Group component="header" gap="gap" wrap="nowrap" {...stylex.props(styles.bar)}>
      {up && <IconButton name={studioUpLabelOf(up)} hotkey="Up a level" onClick={() => void navigate(up)}><ChevronLeft size={14} /></IconButton>}
      <Group gap="gap" wrap="nowrap" {...stylex.props(styles.start)}>{start}</Group>
      {end}
      <IconButton name="Open…" onClick={onQuickOpen}><Search size={14} /></IconButton>
      <IconButton name="Keys" onClick={onCheatsheet}><Keyboard size={14} /></IconButton>
    </Group>
  );
}
