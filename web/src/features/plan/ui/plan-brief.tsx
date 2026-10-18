import { Box, Drawer, Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { MessageSquarePlus } from 'lucide-react';
import type { RefObject } from 'react';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { StudioInline } from '#web/shared/ui/studio-inline.tsx';
import { StudioMarkdown } from '#web/shared/ui/studio-markdown.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { PlanEditableText } from './plan-editable-text.tsx';
import { planTargetAttributes, type PlanPlacedThread, type PlanTarget } from './plan-notes.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { usePlanStartNote } from './plan-selection-comment.tsx';
import { PlanThreadMarks } from './plan-thread-marks.tsx';

const styles = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: '22px', paddingBottom: '40px' },
  section: { display: 'flex', flexDirection: 'column', gap: spacing.tight },
  heading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: spacing.gap },
  name: { color: colors.cream, fontWeight: 700, margin: 0 },
  text: { color: colors.cream, maxWidth: '68ch' },
  leftOut: { margin: 0, paddingInlineStart: '18px', display: 'flex', flexDirection: 'column', gap: spacing.gap },
  hint: { color: colors.dim },
});

/** A brief section's heading, its notes and a comment button. */
function PlanBriefHeading({ name, target, threads }: { readonly name: string; readonly target: PlanTarget; readonly threads: readonly PlanPlacedThread[] }) {
  const startNote = usePlanStartNote();
  return (
    <Box {...stylex.props(styles.heading)}>
      <Text component="h3" size="prose" {...stylex.props(styles.name)}>{name}</Text>
      <Group gap="tight" wrap="nowrap">
        <PlanThreadMarks threads={threads} />
        <IconButton name={`Comment on ${name}`} onClick={() => startNote(target, null)}><MessageSquarePlus size={14} /></IconButton>
      </Group>
    </Box>
  );
}

/**
 * The brief in a drawer beside the page: each section as markdown, clicked to edit and selected to comment on, then
 * what was left out on purpose. It's the plan's why; the scenes stay in view behind it.
 */
export function PlanBriefDrawer({ opened, onClose, root }: { readonly opened: boolean; readonly onClose: () => void; readonly root: RefObject<HTMLDivElement | null> }) {
  const { plan, threads } = usePlanScreen();
  const on = (match: (t: PlanPlacedThread) => boolean) => (threads ?? []).filter((t) => !t.plan.unplaced && match(t));
  const leftOut = plan.storyboard.leftOut ?? [];
  return (
    // On the left with no overlay, so the thread and its composer stay in reach while commenting on the brief.
    <Drawer opened={opened} onClose={onClose} position="left" size="640px" title="Brief" padding="xl" withOverlay={false} lockScroll={false} closeOnClickOutside={false}>
      <Box ref={root} {...stylex.props(styles.body)}>
        <Text {...stylex.props(styles.hint)}>Click any text to edit it; select words to comment on them.</Text>
        {Object.entries(plan.storyboard.brief ?? {}).map(([section, markdown]) => (
          <Box key={section} {...planTargetAttributes({ field: 'brief', section })} {...stylex.props(styles.section)}>
            <PlanBriefHeading name={section} target={{ field: 'brief', section }} threads={on((t) => t.anchor.field === 'brief' && t.anchor.section === section)} />
            <Text component="div" size="prose" {...stylex.props(styles.text)}>
              <PlanEditableText value={markdown} target={{ field: 'brief', section }} multiline><StudioMarkdown markdown={markdown} /></PlanEditableText>
            </Text>
          </Box>
        ))}
        {leftOut.length > 0 && (
          <Box {...stylex.props(styles.section)}>
            <PlanBriefHeading name="Left out on purpose" target={{ field: 'leftOut', item: 0 }} threads={on((t) => t.anchor.field === 'leftOut')} />
            <Text component="ul" size="prose" {...stylex.props(styles.leftOut, styles.text)}>
              {leftOut.map((item, index) => (
                <Box component="li" key={item} {...planTargetAttributes({ field: 'leftOut', item: index })}>
                  <PlanEditableText value={item} target={{ field: 'leftOut', index }} multiline><StudioInline text={item} /></PlanEditableText>
                </Box>
              ))}
            </Text>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}
