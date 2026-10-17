import { Box, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { PlanMarkdown } from './plan-markdown.tsx';
import type { PlanPlacedThread } from './plan-notes.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { PlanTargetBox } from './plan-target-box.tsx';
import { PlanThreadMarks } from './plan-thread-marks.tsx';

const styles = stylex.create({
  brief: { display: 'flex', flexDirection: 'column' },
  heading: { display: 'flex', alignItems: 'center', gap: spacing.tight, minWidth: 0 },
  toggle: {
    flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: `${spacing.inset} max-content minmax(0, 1fr)`, alignItems: 'baseline',
    columnGap: spacing.gap, height: spacing.row, paddingInline: spacing.tight, borderRadius: radius.control, textAlign: 'start',
    backgroundColor: { default: 'transparent', ':hover': colors.raised },
  },
  chevron: { color: colors.dim, alignSelf: 'center', display: 'flex' },
  name: { color: colors.cream, whiteSpace: 'nowrap' },
  preview: { color: colors.dim, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' },
  body: {
    color: colors.cream, maxWidth: '78ch', paddingBlock: spacing.tight, paddingInlineEnd: spacing.inset,
    paddingInlineStart: `calc(${spacing.inset} + ${spacing.gap} + ${spacing.tight})`, marginBottom: spacing.gap,
  },
});

/** A section's first words, its markup left off, as its heading's one-line preview. */
const previewOf = (markdown: string) => markdown.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The brief, a heading per line with its first words dim beside it; a click opens one as markdown, where a selection
 * quotes it for a note. A section's notes show by its heading, open or shut.
 */
export function PlanBrief() {
  const { plan, threads } = usePlanScreen();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const brief = Object.entries(plan.storyboard.brief ?? {});
  if (!brief.length) return null;
  const toggle = (section: string) => setOpen((now) => {
    const next = new Set(now);
    if (!next.delete(section)) next.add(section);
    return next;
  });
  const onSection = (section: string): PlanPlacedThread[] => (threads ?? []).filter((t) => !t.plan.unplaced && t.anchor.field === 'brief' && t.anchor.section === section);
  return (
    <Box component="section" aria-label="Brief" {...stylex.props(styles.brief)}>
      {brief.map(([section, markdown]) => {
        const shown = open.has(section);
        return (
          <Box key={section}>
            <Box {...stylex.props(styles.heading)}>
              <UnstyledButton aria-expanded={shown} onClick={() => toggle(section)} {...stylex.props(styles.toggle)}>
                <Box component="span" {...stylex.props(styles.chevron)}>{shown ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</Box>
                <Text component="span" size="md" {...stylex.props(styles.name)}>{section}</Text>
                <Text component="span" size="md" {...stylex.props(styles.preview)}>{shown ? '' : previewOf(markdown)}</Text>
              </UnstyledButton>
              <PlanThreadMarks threads={onSection(section)} />
            </Box>
            {shown && (
              <Box {...stylex.props(styles.body)}>
                <PlanTargetBox target={{ field: 'brief', section }}><PlanMarkdown markdown={markdown} /></PlanTargetBox>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
