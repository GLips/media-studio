import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { colors } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  date: { color: colors.dim },
});

/** A project's `YYYY-MM-` prefix, which every name in the studio starts with: `2026-11-`. */
const PROJECT_DATE_PREFIX = /^(\d{4})-(\d{2})-/;

/** A project's month (`2026-11`) and its name after the date; a name with no date prefix has no month. */
export function projectDateSplitOf(project: string): { month: string | null; rest: string } {
  const match = PROJECT_DATE_PREFIX.exec(project);
  if (!match) return { month: null, rest: project };
  return { month: `${match[1]}-${match[2]}`, rest: project.slice(match[0].length) };
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** `2026-11` as `Nov 2026`, the sidebar's heading over that month's projects. */
export const projectMonthLabelOf = (month: string) => MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`));

/**
 * `2026-11-media-studio-brand` with its date dim, so the part that tells projects apart reads first. A name with no
 * date prefix shows whole.
 */
export function ProjectName({ project }: { readonly project: string }) {
  const { rest } = projectDateSplitOf(project);
  const date = project.slice(0, project.length - rest.length);
  return (
    <>
      {date && <Text component="span" inherit {...stylex.props(styles.date)}>{date}</Text>}
      {rest}
    </>
  );
}
