import { Box, Group, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import type { ReviewThreadCounts } from '#lib/output/review/models/review-dashboard.ts';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ProjectThreadCounts } from './project-thread-counts.tsx';

/** Where a row leads: a project's page, one of its files, a decision or its plan. */
export type ProjectRowTarget = { project: string } & ({ on: 'project' } | { on: 'file'; path: string } | { on: 'decision'; topic: string } | { on: 'plan' });

/** Marks the rows the arrow keys walk (use-project-row-hotkeys.ts). */
export const PROJECT_ROW_ATTRIBUTE = 'data-project-row';

const styles = stylex.create({
  row: {
    display: 'flex', alignItems: 'center', gap: spacing.inset, height: '40px', paddingInline: spacing.gap, minWidth: 0,
    color: colors.cream, textDecoration: 'none', borderRadius: radius.control,
    backgroundColor: {
      default: 'transparent',
      // While the keyboard holds a row, hover lights no other, so only one row is lit. Its list carries
      // `stylex.defaultMarker()`; the attribute is PROJECT_ROW_ATTRIBUTE, spelled out as the compiler needs.
      ':hover': { default: colors.raised, [stylex.when.ancestor(':has([data-project-row]:focus-visible)')]: 'transparent' },
      ':focus-visible': colors.raised,
    },
    outlineColor: colors.cream, outlineStyle: 'solid', outlineOffset: '-1px', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  lead: { display: 'flex', alignItems: 'center', gap: spacing.inset, minWidth: 0 },
  title: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  end: { marginInlineStart: 'auto', flexShrink: 0 },
});

export const projectListStyles = stylex.create({
  // Capped so a row's end readouts sit near its name on a wide screen, and the dashboard's two lists and a project's
  // page share one right edge.
  list: { padding: spacing.gap, maxWidth: '960px' },
});

type ProjectRowProps = {
  readonly target: ProjectRowTarget;
  /** The 64px picture, or a glyph in its box (ProjectThumbnail). */
  readonly thumbnail: ReactNode;
  readonly title: ReactNode;
  readonly threads?: ReviewThreadCounts;
  /** State glyphs after the counts: an open decision, an unsigned plan. */
  readonly marks?: ReactNode;
  /** Readouts, right-aligned: a file's age, where a row leads. */
  readonly end?: ReactNode;
};

/** The dashboard's, a project page's and the awaiting list's one row: 40px, picture, name, what waits, and when. */
export function ProjectRow({ target, thumbnail, title, threads, marks, end }: ProjectRowProps) {
  return (
    <ProjectRowLink target={target}>
      {thumbnail}
      <Box component="span" {...stylex.props(styles.lead)}>
        <Text component="span" size="md" {...stylex.props(styles.title)}>{title}</Text>
        {threads && <ProjectThreadCounts threads={threads} />}
        {marks}
      </Box>
      {end && <Group gap="gap" wrap="nowrap" {...stylex.props(styles.end)}>{end}</Group>}
    </ProjectRowLink>
  );
}

function ProjectRowLink({ target, children }: { readonly target: ProjectRowTarget; readonly children: ReactNode }) {
  const row = { ...stylex.props(styles.row), underline: 'never', [PROJECT_ROW_ATTRIBUTE]: '' } as const;
  const { project } = target;
  switch (target.on) {
    case 'project': return <AnchorLink to="/projects/$project" params={{ project }} {...row}>{children}</AnchorLink>;
    case 'file': return <AnchorLink to="/projects/$project/artifacts/$" params={{ project, _splat: target.path }} {...row}>{children}</AnchorLink>;
    case 'decision': return <AnchorLink to="/projects/$project/decisions/$topic" params={{ project, topic: target.topic }} {...row}>{children}</AnchorLink>;
    default: return <AnchorLink to="/projects/$project/plan" params={{ project }} {...row}>{children}</AnchorLink>;
  }
}

