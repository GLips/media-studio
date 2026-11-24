import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useParams } from '@tanstack/react-router';
import { StudioCollectionViewToggle } from '#web/shared/ui/studio-collection-view-toggle.tsx';
import { StudioPageTitle } from '#web/shared/ui/studio-page-title.tsx';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { useStudioCollectionView } from '#web/shared/ui/use-studio-collection-view.ts';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ProjectName } from './project-name.tsx';
import { projectListStyles } from './project-row.tsx';
import { projectTileGridStyles } from './project-tile.tsx';

const styles = stylex.create({
  row: { gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: spacing.inset, height: '44px', paddingInline: spacing.gap },
  thumbnail: { width: '64px', height: '36px', flexShrink: 0, borderRadius: radius.control, backgroundColor: colors.skeleton },
  title: { width: '240px', height: '12px', borderRadius: radius.control, backgroundColor: colors.skeleton },
  // A tile's picture cell and name line (ProjectTile), empty.
  tile: { display: 'flex', flexDirection: 'column', gap: spacing.tight, padding: spacing.tight },
  picture: { width: '100%', aspectRatio: '4 / 3', borderRadius: radius.control, backgroundColor: colors.skeleton },
  name: { width: '70%', height: '12px', borderRadius: radius.control, backgroundColor: colors.skeleton },
});

/** Enough rows to fill a tall screen; the list scrolls past the fold once it loads. */
const PENDING_ROWS = 12;

/** Two rows of tiles at 1440 wide, enough to fill the first screen. */
const PENDING_TILES = 10;

/**
 * The index and a project's page while their summary loads: their 44px rows, or a project's tiles in the grid view,
 * empty, under the title they'll have.
 */
export function ProjectRowsPending() {
  const project = useParams({ strict: false }).project;
  const { view } = useStudioCollectionView();
  return (
    <StudioShell>
      {project === undefined
        ? <StudioPageTitle>Awaiting you</StudioPageTitle>
        : <StudioPageTitle end={<StudioCollectionViewToggle />}><ProjectName project={project} /></StudioPageTitle>}
      {project !== undefined && view === 'grid' ? (
        <Box aria-busy {...stylex.props(projectListStyles.list)}>
          <Box {...stylex.props(projectTileGridStyles.grid)}>
            {Array.from({ length: PENDING_TILES }, (_, i) => (
              <Box key={i} {...stylex.props(styles.tile)}><Box {...stylex.props(styles.picture)} /><Box {...stylex.props(styles.name)} /></Box>
            ))}
          </Box>
        </Box>
      ) : (
        <Box aria-busy {...stylex.props(projectListStyles.list)}>
          {Array.from({ length: PENDING_ROWS }, (_, i) => (
            <Box key={i} {...stylex.props(styles.row)}><Box {...stylex.props(styles.thumbnail)} /><Box {...stylex.props(styles.title)} /></Box>
          ))}
        </Box>
      )}
    </StudioShell>
  );
}
