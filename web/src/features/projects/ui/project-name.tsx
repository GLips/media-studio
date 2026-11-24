import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { colors } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  date: { color: colors.dim },
});

/** A project's `YYYY-MM-` prefix, which every name in the studio starts with: `2026-11-`. */
const PROJECT_DATE_PREFIX = /^\d{4}-\d{2}-/;

/**
 * `2026-11-media-studio-brand` with its date dim, so the part that tells projects apart reads first. A name with no
 * date prefix shows whole.
 */
export function ProjectName({ project }: { readonly project: string }) {
  const date = PROJECT_DATE_PREFIX.exec(project)?.[0] ?? '';
  return (
    <>
      {date && <Text component="span" inherit {...stylex.props(styles.date)}>{date}</Text>}
      {project.slice(date.length)}
    </>
  );
}
