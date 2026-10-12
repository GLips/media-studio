import { Group, Menu, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useHotkeys } from '@tanstack/react-hotkeys';
import { ArrowLeftRight, Columns2 } from 'lucide-react';
import { useState } from 'react';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { reviewVersionLabelOf, useReviewCompareTarget } from './use-review-compare-target.ts';

const styles = stylex.create({
  target: {
    height: spacing.rowDense, paddingInline: spacing.tight, borderRadius: radius.control, color: { default: colors.dim, ':hover': colors.cream },
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  on: { color: colors.cream },
});

const two = (n: number) => String(n).padStart(2, '0');

/** `10-11 14:16`: when a version was made, local time. */
function formatReviewVersionMade(at: string): string {
  const made = new Date(at);
  return `${two(made.getMonth() + 1)}-${two(made.getDate())} ${two(made.getHours())}:${two(made.getMinutes())}`;
}

/**
 * `⇆ r13 ▾ ◫` in the transport: the version compared against (`V` opens the list) and side by side. Holding `\`
 * flips to it and `W` wipes. With no other version kept there's nothing to compare, and nothing shows.
 */
export function ReviewCompareMenu() {
  const { artifact, search, setSearch } = useReviewScreen();
  const { versions, shown, other } = useReviewCompareTarget();
  const [opened, setOpened] = useState(false);
  // Left out, not disabled, with nothing to choose: a disabled key still holds its binding.
  useHotkeys(other ? [{ hotkey: 'V', callback: () => setOpened((o) => !o), options: { meta: { group: 'compare', name: 'Compare with' } } }] : []);
  if (!other) return null;
  const choices = versions.filter((v) => v.hash !== artifact.render.hash).toReversed();
  const comparing = search.vs !== undefined;
  return (
    <Group gap={0} wrap="nowrap">
      <Menu opened={opened} onChange={setOpened} position="top-start" withinPortal>
        {/* The tooltip outside: Menu.Target forwards its ref to the button, where HotkeyTooltip would swallow it. */}
        <HotkeyTooltip name="Compare with" hotkey="Compare with">
          <Menu.Target>
            <UnstyledButton {...stylex.props(styles.target, comparing && styles.on)}>
              <Group gap="tight" wrap="nowrap">
                <ArrowLeftRight size={14} />
                <Text component="span" size="sm" inherit>{reviewVersionLabelOf(other, other.hash)} ▾</Text>
              </Group>
            </UnstyledButton>
          </Menu.Target>
        </HotkeyTooltip>
        <Menu.Dropdown>
          {choices.map((v) => (
            <Menu.Item key={v.hash} onClick={() => setSearch({ vs: v.hash })}>
              <Group gap="gap" wrap="nowrap">
                <Readout bright={v.hash === other.hash}>r{v.r}</Readout>
                <Readout>{v.hash.slice(0, 6)}{v.source.workspace?.dirty || v.source.engine.dirty ? '*' : ''}</Readout>
                <Readout>{formatReviewVersionMade(v.at)}</Readout>
              </Group>
            </Menu.Item>
          ))}
          {comparing && <Menu.Divider />}
          {comparing && (
            <Menu.Item onClick={() => setSearch({ vs: undefined, cmp: undefined, w: undefined })}>
              <Text component="span" size="sm">Only {reviewVersionLabelOf(shown, artifact.render.hash)}</Text>
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
      <IconButton name="Side by side" active={search.cmp === 'side'}
        onClick={() => setSearch(search.cmp === 'side' ? { cmp: undefined } : { vs: other.hash, cmp: 'side' })}>
        <Columns2 size={14} />
      </IconButton>
    </Group>
  );
}
