import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Clock } from 'lucide-react';
import type { ReviewProjectRow } from '#lib/output/review/models/review-dashboard.ts';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ProjectFileIsNewTest } from '../controllers/project-seen.ts';

const styles = stylex.create({
  link: { display: 'inline-flex', alignItems: 'center', gap: spacing.tight, color: colors.cream, whiteSpace: 'nowrap' },
  fresh: { color: colors.accent, fontWeight: 600 },
});

/** How many of the rows' files read as new. */
export const projectNewFileCountOf = (rows: readonly ReviewProjectRow[], isNew: ProjectFileIsNewTest) =>
  (isNew === null ? 0 : rows.filter((row) => row.on === 'file' && isNew(row.artifact.path, row.artifact.modified)).length);

/** The project page's way to its latest view (`/projects/<p>/latest`), with how many files are new since the last look. */
export function ProjectLatestLink({ project, fresh }: { readonly project: string; readonly fresh: number }) {
  return (
    <AnchorLink to="/projects/$project/latest" params={{ project }} underline="never" fz="sm" {...stylex.props(styles.link)}>
      <Clock size={14} />
      latest
      {fresh > 0 && <Text component="span" inherit {...stylex.props(styles.fresh)}>· {fresh} new</Text>}
    </AnchorLink>
  );
}
