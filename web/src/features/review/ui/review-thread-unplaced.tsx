import { Box, Group, Image, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import type { PlacedReviewThread } from '#lib/output/review/models/review-placement.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { projectFileUrl } from '#web/shared/media-urls.ts';
import { ReviewThreadBody } from './review-thread-body.tsx';
import type { ReviewThreadActions } from './use-review-thread-panel.ts';

const styles = stylex.create({
  group: { borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line },
  toggle: {
    width: '100%', height: spacing.row, paddingInline: spacing.gap, color: colors.dim, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  item: { paddingInline: spacing.gap, paddingBottom: spacing.gap },
  frame: { width: '100%', borderRadius: radius.control, backgroundColor: colors.screen },
  action: {
    color: colors.cream, paddingInline: spacing.tight,
    borderRadius: radius.control, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
});

type ReviewThreadUnplacedProps = {
  readonly threads: readonly PlacedReviewThread[];
  readonly project: string;
  readonly actions: ReviewThreadActions;
  readonly label?: string;
};

/**
 * `▸ unplaced 2`: notes this render has no place for, folded at the foot; `label` names the group where a subject
 * says it otherwise (the plan's `moved or removed`). Each shows the frame it was written against, with Re-pin (to the
 * playhead here) and Resolve.
 */
export function ReviewThreadUnplaced({ threads, project, actions, label = 'unplaced' }: ReviewThreadUnplacedProps) {
  const [open, setOpen] = useState(false);
  if (!threads.length) return null;
  return (
    <Box {...stylex.props(styles.group)}>
      <UnstyledButton aria-expanded={open} onClick={() => setOpen((o) => !o)} {...stylex.props(styles.toggle)}>
        <Text component="span" size="sm" inherit>{open ? '▾' : '▸'} {label}{threads.length > 1 && ` ${threads.length}`}</Text>
      </UnstyledButton>
      {open && (
        <Stack gap="gap" role="list">
          {threads.map((thread) => {
            const { anchor, placement } = thread;
            const image = anchor.on === 'video' || anchor.on === 'still' ? anchor.image : undefined;
            return (
              <Stack key={thread.id} gap="tight" role="listitem" {...stylex.props(styles.item)}>
                <Group gap="tight" wrap="nowrap">
                  <Tooltip label={'unplaced' in placement ? placement.unplaced : ''} openDelay={400} withinPortal multiline>
                    <Readout bright>#{thread.id}</Readout>
                  </Tooltip>
                  {anchor.on === 'video' && <UnstyledButton onClick={() => void actions.repin(thread)} {...stylex.props(styles.action)}><Text component="span" size="sm" inherit>Re-pin</Text></UnstyledButton>}
                  {thread.state === 'resolved' || <UnstyledButton onClick={() => actions.resolve([thread.id])} {...stylex.props(styles.action)}><Text component="span" size="sm" inherit>Resolve</Text></UnstyledButton>}
                </Group>
                {image && <Image src={projectFileUrl(project, image)} alt="" {...stylex.props(styles.frame)} />}
                <ReviewThreadBody text={thread.entries[0].text} />
              </Stack>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
