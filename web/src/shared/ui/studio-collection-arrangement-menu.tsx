import { Group, Menu, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { ArrowDownUp, Check } from 'lucide-react';
import { useState } from 'react';
import {
  STUDIO_COLLECTION_GROUPS, STUDIO_COLLECTION_SORTS, type StudioCollectionGroup, type StudioCollectionSort,
} from '../studio-collection-arrangement.ts';
import { HotkeyTooltip } from './hotkey-tooltip.tsx';
import { colors, radius, spacing } from './theme.stylex.ts';
import { useStudioCollectionArrangement } from './use-studio-collection-arrangement.ts';

const styles = stylex.create({
  target: {
    height: spacing.rowDense, paddingInline: spacing.tight, borderRadius: radius.control, color: { default: colors.dim, ':hover': colors.cream },
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
    outlineColor: colors.cream, outlineOffset: '1px', outlineStyle: 'solid', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  // Every item keeps the check's room, so the choices' words line up whichever is on.
  check: { width: '14px', flexShrink: 0 },
});

const GROUP_LABELS: Readonly<Record<StudioCollectionGroup, string>> = { shape: 'Shape', name: 'Name', none: 'None' };
const SORT_LABELS: Readonly<Record<StudioCollectionSort, string>> = { name: 'Name', newest: 'Newest' };

function ArrangementChoice({ label, on, onPick }: { readonly label: string; readonly on: boolean; readonly onPick: () => void }) {
  return (
    <Menu.Item onClick={onPick}>
      <Group gap="tight" wrap="nowrap">
        <Group component="span" {...stylex.props(styles.check)}>{on && <Check size={14} />}</Group>
        <Text component="span" size="sm">{label}</Text>
      </Group>
    </Menu.Item>
  );
}

/**
 * `⇅ Shape · Name ▾` beside the list-or-grid toggle wherever a grid of pictures shows: how every grid groups its
 * pictures (by shape, by their names' shared starts, or not at all) and orders them (useStudioCollectionArrangement).
 */
export function StudioCollectionArrangementMenu() {
  const { group, sort, setGroup, setSort } = useStudioCollectionArrangement();
  const [opened, setOpened] = useState(false);
  return (
    <Menu opened={opened} onChange={setOpened} position="bottom-end" withinPortal>
      {/* The tooltip outside: Menu.Target forwards its ref to the button, where HotkeyTooltip would swallow it. */}
      <HotkeyTooltip name="Group · Sort" disabled={opened}>
        <Menu.Target>
          <UnstyledButton aria-label="Group and sort" {...stylex.props(styles.target)}>
            <Group gap="tight" wrap="nowrap">
              <ArrowDownUp size={14} />
              <Text component="span" size="sm" inherit>{GROUP_LABELS[group]} · {SORT_LABELS[sort]} ▾</Text>
            </Group>
          </UnstyledButton>
        </Menu.Target>
      </HotkeyTooltip>
      <Menu.Dropdown>
        <Menu.Label>Group by</Menu.Label>
        {STUDIO_COLLECTION_GROUPS.map((g) => <ArrangementChoice key={g} label={GROUP_LABELS[g]} on={g === group} onPick={() => setGroup(g)} />)}
        <Menu.Divider />
        <Menu.Label>Sort by</Menu.Label>
        {STUDIO_COLLECTION_SORTS.map((s) => <ArrangementChoice key={s} label={SORT_LABELS[s]} on={s === sort} onPick={() => setSort(s)} />)}
      </Menu.Dropdown>
    </Menu>
  );
}
