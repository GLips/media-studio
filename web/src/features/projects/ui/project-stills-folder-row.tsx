import { Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { LayoutGrid } from 'lucide-react';
import { colors } from '#web/shared/ui/theme.stylex.ts';
import { ProjectRow } from './project-row.tsx';
import { ProjectThumbnail } from './project-thumbnail.tsx';

const styles = stylex.create({
  dim: { color: colors.dim },
});

/**
 * A folder of stills as one row, heading its files: it opens the folder's grid (the review route turns a folder's path
 * into its first still with `view=grid`). Its stills' notes are counted on their own rows below, so not again here.
 */
export function ProjectStillsFolderRow({ project, folder, stills }: { readonly project: string; readonly folder: string; readonly stills: number }) {
  return (
    <ProjectRow target={{ project, on: 'file', path: folder.replace(/\/$/, '') }} thumbnail={<ProjectThumbnail glyph={<LayoutGrid size={14} />} />}
      title={<>all {stills} stills <Text component="span" inherit {...stylex.props(styles.dim)}>as a grid</Text></>} />
  );
}

