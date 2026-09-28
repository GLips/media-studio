import { Badge, Group, Paper, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useSuspenseQuery } from '@tanstack/react-query';
import { AnchorLink } from '#web/shared/ui/anchor-link.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { StudioHeader } from '#web/shared/ui/studio-header.tsx';
import { radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { projectListingsQueryOptions } from '../controllers/project-queries.ts';

const styles = stylex.create({
  page: { maxWidth: spacing.pageMaxWidth, marginInline: 'auto', padding: spacing.pageMargin },
  row: { borderRadius: radius.surface, padding: `${spacing.gap} ${spacing.inset}` },
});

const formatDay = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** Every project, the most recently active first, each opening on the newest thing it has made. */
export function ProjectsPage() {
  const { data: projects } = useSuspenseQuery(projectListingsQueryOptions);
  return (
    <Stack gap="lg" {...stylex.props(styles.page)}>
      <StudioHeader />
      <Stack gap="xs">
        {projects.length === 0 && <Text size="sm" c="dimmed">No projects in work/projects/ yet: <code>studio new</code> starts one.</Text>}
        {projects.map(({ project, artifacts }) => (
          <Paper key={project} withBorder {...stylex.props(styles.row)}>
            <Group justify="space-between">
              <AnchorLink to="/projects/$project" params={{ project }} fw={700}>{project}</AnchorLink>
              {artifacts[0] ? (
                <Group gap="xs">
                  <Badge variant="light" color="gray">{artifacts.filter((a) => a.kind === 'video').length} videos</Badge>
                  <Badge variant="light" color="gray">{artifacts.filter((a) => a.kind === 'still').length} stills</Badge>
                  <Readout>newest {artifacts[0].path} · {formatDay(artifacts[0].modified)}</Readout>
                </Group>
              ) : <Text size="sm" c="dimmed">nothing rendered yet</Text>}
            </Group>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}
