import { Group, Image, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PlacedReviewThread } from '#lib/output/review/models/review-placement.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { projectFileUrl } from '#web/shared/media-urls.ts';
import { ReviewThreadBody } from './review-thread-body.tsx';
import type { ReviewThreadActions } from './use-review-thread-panel.ts';

const styles = stylex.create({
  toggle: {
    display: 'flex', alignItems: 'center', gap: spacing.tight, flexShrink: 0, width: '100%', height: spacing.row, paddingInline: spacing.inset,
    color: { default: colors.dim, ':hover': colors.cream }, backgroundColor: { default: 'transparent', ':hover': colors.raised },
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line,
  },
  group: { paddingTop: spacing.gap, borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line },
  item: { paddingInline: spacing.inset, paddingBottom: spacing.gap },
  frame: { width: '100%', borderRadius: radius.control, backgroundColor: colors.screen },
  action: {
    color: colors.cream, paddingInline: spacing.tight,
    borderRadius: radius.control, backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
});

/** What the group of notes with no place here is called, where the subject doesn't name it otherwise. */
const REVIEW_UNPLACED_LABEL = 'Earlier renders';

type ReviewThreadUnplacedToggleProps = {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly label?: string;
};

/**
 * `▸ Earlier renders`: the closed disclosure at the panel's foot for notes this file has no place for, left on an
 * earlier render (the plan's are `moved or removed`). Deliberately no count: how many there are isn't worth the glance.
 */
export function ReviewThreadUnplacedToggle({ open, onToggle, label = REVIEW_UNPLACED_LABEL }: ReviewThreadUnplacedToggleProps) {
  return (
    <UnstyledButton aria-expanded={open} onClick={onToggle} {...stylex.props(styles.toggle)}>
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      <Text component="span" size="sm" inherit>{label}</Text>
    </UnstyledButton>
  );
}

type ReviewThreadUnplacedProps = {
  readonly threads: readonly PlacedReviewThread[];
  readonly project: string;
  readonly actions: ReviewThreadActions;
};

/**
 * The unplaced notes, opened from their toggle, at the list's end: each with the frame it was written against, Re-pin
 * (to the playhead here) and Resolve.
 */
export function ReviewThreadUnplaced({ threads, project, actions }: ReviewThreadUnplacedProps) {
  return (
    <Stack gap="gap" role="list" data-review-unplaced {...stylex.props(styles.group)}>
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
            <ReviewThreadBody text={thread.entries[0].text} clamp />
          </Stack>
        );
      })}
    </Stack>
  );
}
