import { Group, Menu, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { HotkeyTooltip } from '#web/shared/ui/hotkey-tooltip.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { formatReviewVersionCommit, ReviewRenderVersionRow } from './review-render-version-row.tsx';
import { useReviewScreen } from './review-screen-context.tsx';
import { useReviewCompareTarget } from './use-review-compare-target.ts';

const styles = stylex.create({
  target: {
    paddingInline: spacing.tight, borderRadius: radius.control, whiteSpace: 'nowrap', cursor: 'pointer',
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
    outlineColor: colors.cream, outlineOffset: '1px', outlineStyle: 'solid', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  caret: { color: colors.dim },
});

/**
 * `r14 ▾ 3a9f2c1*`: the render shown, by its place among its path's kept versions, and its commit. The menu lists
 * every kept version, newest first; the newest is the file on disk, so choosing it leaves `r` out of the URL. A render
 * never kept (made outside `studio render`, never noted on) shows its hash.
 */
export function ReviewRenderMenu() {
  const { artifact, status, setSearch } = useReviewScreen();
  const { versions, shown } = useReviewCompareTarget();
  // Ages are as of opening the screen: a version's age moving while it's on screen would say nothing.
  const [now] = useState(Date.now);
  const newest = status?.render.hash ?? artifact.render.hash;
  // A still is the file itself: its name says which, and a hash beside it says nothing more.
  if (!shown && artifact.kind === 'still') return null;
  if (!shown) {
    return (
      <HotkeyTooltip name={`render ${artifact.render.hash}`}>
        <Readout>{artifact.render.hash.slice(0, 6)}</Readout>
      </HotkeyTooltip>
    );
  }
  // No tooltip on the target: it would sit over the open menu, whose rows name both commits.
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <UnstyledButton aria-label={`render r${shown.r}, made from ${formatReviewVersionCommit(shown)}`} {...stylex.props(styles.target)}>
          <Group gap="tight" wrap="nowrap">
            <Readout bright>r{shown.r}</Readout>
            <Text component="span" size="xs" {...stylex.props(styles.caret)}>▾</Text>
            <Readout>{formatReviewVersionCommit(shown)}</Readout>
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        {versions.toReversed().map((version) => (
          <ReviewRenderVersionRow key={version.hash} version={version} shown={version.hash === shown.hash} now={now}
            onChoose={() => setSearch({ r: version.hash === newest ? undefined : version.hash })} />
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
