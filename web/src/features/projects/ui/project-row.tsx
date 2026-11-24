import { Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';

/** Where a row leads: a project's page, one of its files, a decision or its plan. */
export type ProjectRowTarget = { project: string } & ({ on: 'project' } | { on: 'file'; path: string } | { on: 'decision'; topic: string } | { on: 'plan' });

/** Marks the rows the arrow keys walk (use-project-row-hotkeys.ts). */
export const PROJECT_ROW_ATTRIBUTE = 'data-project-row';

const styles = stylex.create({
  // A subgrid of its list (projectListStyles), so names, details, states and readouts line up down every row.
  row: {
    display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: 'subgrid', alignItems: 'center', height: '40px',
    paddingInline: spacing.gap, minWidth: 0, color: colors.cream, textDecoration: 'none', borderRadius: radius.control,
    backgroundColor: {
      default: 'transparent',
      // While the keyboard holds a row, hover lights no other, so only one row is lit. Its list carries
      // `stylex.defaultMarker()`; the attribute is PROJECT_ROW_ATTRIBUTE, spelled out as the compiler needs.
      ':hover': { default: colors.raised, [stylex.when.ancestor(':has([data-project-row]:focus-visible)')]: 'transparent' },
      ':focus-visible': colors.raised,
    },
    outlineColor: colors.cream, outlineStyle: 'solid', outlineOffset: '-1px', outlineWidth: { default: 0, ':focus-visible': '1px' },
  },
  cell: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  detail: { color: colors.dim },
  // A title with no columns after it, free of the name column's cap.
  wide: { gridColumn: '2 / -1' },
  end: { justifySelf: 'end' },
});

export const projectListStyles = stylex.create({
  // Every row's columns: picture, name and what it asks (each its longest, to a cap), its state just after, then the
  // readouts at the far edge. The picture's column is `auto`: a subgrid row's padding is laid into it. Inset so a
  // row's picture starts under the page title (StudioPageTitle).
  list: {
    display: 'grid', gridTemplateColumns: 'auto fit-content(320px) fit-content(480px) auto minmax(max-content, 1fr)',
    columnGap: spacing.inset, alignContent: 'start', paddingInline: `calc(${spacing.row} - ${spacing.gap})`, paddingBlockStart: spacing.gap, paddingBlockEnd: spacing.row,
  },
  // Anything in the list that isn't a row (a header, a rule, a note) spans every column.
  span: { gridColumn: '1 / -1' },
});

type ProjectRowProps = {
  readonly target: ProjectRowTarget;
  /** The 64px picture, or a glyph in its box (ProjectThumbnail). */
  readonly thumbnail: ReactNode;
  readonly title: ReactNode;
  /** Dim, after the name: what a decision asks, a project's newest file. */
  readonly detail?: ReactNode;
  /** Its state in plain words: `1 open note`, `2 questions`, `0 of 6 signed`. */
  readonly status?: ReactNode;
  /** Readouts, right-aligned: a file's age, where a row leads. */
  readonly end?: ReactNode;
};

/** The dashboard's, a project page's and the awaiting list's one row: 40px, picture, name, what it asks, its state, and when. */
export function ProjectRow({ target, thumbnail, title, detail, status, end }: ProjectRowProps) {
  return (
    <ProjectRowLink target={target}>
      {thumbnail}
      <Text component="span" size="md" {...stylex.props(styles.cell)}>{title}</Text>
      <Text component="span" size="md" {...stylex.props(styles.cell, styles.detail)}>{detail}</Text>
      <Group component="span" gap="gap" wrap="nowrap">{status}</Group>
      <Group component="span" gap="gap" wrap="nowrap" {...stylex.props(styles.end)}>{end}</Group>
    </ProjectRowLink>
  );
}

type ProjectRowButtonProps = {
  readonly thumbnail: ReactNode;
  readonly title: ReactNode;
  readonly expanded: boolean;
  readonly onToggle: () => void;
};

/** A row that opens and closes the rows below it in place, as a folded run of older work does. */
export function ProjectRowButton({ thumbnail, title, expanded, onToggle }: ProjectRowButtonProps) {
  return (
    <UnstyledButton {...stylex.props(styles.row)} {...{ [PROJECT_ROW_ATTRIBUTE]: '' }} aria-expanded={expanded} onClick={onToggle}>
      {thumbnail}
      <Text component="span" size="md" {...stylex.props(styles.cell, styles.wide)}>{title}</Text>
    </UnstyledButton>
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
