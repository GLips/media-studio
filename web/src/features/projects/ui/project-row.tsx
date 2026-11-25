import { Group, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { PROJECT_ROW_ATTRIBUTE, ProjectTargetLink, type ProjectRowTarget } from './project-target-link.tsx';

const styles = stylex.create({
  // A subgrid of its list (projectListStyles), so names, details, states and readouts line up down every row.
  row: {
    display: 'grid', gridColumn: '1 / -1', gridTemplateColumns: 'subgrid', alignItems: 'center', height: '44px',
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
  // The name holds its weight, not a brighter tone: the question beside it, in the same cream, is what's acted on.
  name: { fontWeight: 600 },
  // A title with no columns after it, free of the name column's cap.
  wide: { gridColumn: '2 / -1' },
  end: { justifySelf: 'end' },
});

export const projectListStyles = stylex.create({
  // Every row's columns: picture, name (its longest, to a cap), its state straight after so the eye reads name then
  // state, what it asks taking the slack, then its age at the right edge. The picture's column is `auto`: a subgrid
  // row's padding is laid into it. Inset so a row's picture starts under the page title (StudioPageTitle).
  list: {
    display: 'grid', gridTemplateColumns: 'auto fit-content(280px) minmax(112px, auto) minmax(0, 1fr) minmax(88px, auto)',
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
  /** Its one state in plain words, after the name (ProjectRowStatus): `not decided`, `1 to verify`, `0 of 6 signed`. */
  readonly status?: ReactNode;
  /** After the state, in the same cream: what a decision asks. */
  readonly detail?: ReactNode;
  /** Readouts, right-aligned: a file's age, where a row leads. */
  readonly end?: ReactNode;
};

/** A project page's and the awaiting list's one row: 44px, picture, name, its state, what it asks, and when. */
export function ProjectRow({ target, thumbnail, title, detail, status, end }: ProjectRowProps) {
  return (
    <ProjectTargetLink target={target} xstyle={styles.row}>
      {thumbnail}
      <Text component="span" size="md" {...stylex.props(styles.cell, styles.name)}>{title}</Text>
      <Group component="span" gap="gap" wrap="nowrap">{status}</Group>
      <Text component="span" size="md" {...stylex.props(styles.cell)}>{detail}</Text>
      <Group component="span" gap="gap" wrap="nowrap" {...stylex.props(styles.end)}>{end}</Group>
    </ProjectTargetLink>
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
