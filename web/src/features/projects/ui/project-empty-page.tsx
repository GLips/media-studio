import { Code, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { StudioHeader } from '#web/shared/ui/studio-header.tsx';
import { spacing } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  page: { maxWidth: spacing.pageMaxWidth, marginInline: 'auto', padding: spacing.pageMargin },
});

/** A project with nothing to review yet, and the commands that make something. */
export function ProjectEmptyPage({ project }: { readonly project: string }) {
  return (
    <Stack gap="lg" {...stylex.props(styles.page)}>
      <StudioHeader />
      <Text fw={700}>{project} has nothing to review yet.</Text>
      <Text size="sm" c="dimmed">
        A render lands in out/ (<Code>studio render {project}</Code>), a still in out/stills/ (<Code>studio still {project}</Code>).
      </Text>
    </Stack>
  );
}
