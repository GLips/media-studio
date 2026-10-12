import { Box, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useParams } from '@tanstack/react-router';
import { StudioShell } from '#web/shared/ui/studio-shell.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { projectListStyles } from './project-row.tsx';

const styles = stylex.create({
  row: { display: 'flex', alignItems: 'center', gap: spacing.inset, height: '40px', paddingInline: spacing.gap },
  thumbnail: { width: '64px', height: '36px', flexShrink: 0, borderRadius: radius.control, backgroundColor: colors.skeleton },
  title: { width: '240px', height: '12px', borderRadius: radius.control, backgroundColor: colors.skeleton },
});

/** Enough rows to fill a tall screen; the list scrolls past the fold once it loads. */
const PENDING_ROWS = 12;

/** The dashboard and a project's page while their summary loads: their 40px rows, empty, under the bar they'll have. */
export function ProjectRowsPending() {
  const project = useParams({ strict: false }).project;
  return (
    <StudioShell start={<Text size="sm">{project ?? 'studio'}</Text>}>
      <Stack gap={0} aria-busy {...stylex.props(projectListStyles.list)}>
        {Array.from({ length: PENDING_ROWS }, (_, i) => (
          <Box key={i} {...stylex.props(styles.row)}><Box {...stylex.props(styles.thumbnail)} /><Box {...stylex.props(styles.title)} /></Box>
        ))}
      </Stack>
    </StudioShell>
  );
}
