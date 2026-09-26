import { Anchor, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { LabGalleryItem } from '#models/lab/lab-catalog.ts';
import { formatGenerationCost, labMusicModelWords, labProjectShortName } from '#models/lab/lab-generated-media.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { LabTrackPlayer } from './lab-track-player.tsx';

const styles = stylex.create({
  track: { backgroundColor: colors.panel, borderRadius: radius.surface, padding: `${spacing.gap} ${spacing.inset}` },
});

/** Every prompt opens with this, so a card leaves it off and shows what differs. */
const INSTRUMENTAL_PREAMBLE = /^Instrumental only, no vocals\.\s*/;

type LabMusicShelfProps = {
  readonly tracks: readonly LabGalleryItem[];
  readonly onDetail: (item: LabGalleryItem) => void;
};

/** The generated music tracks, each playable in place, with the start of its prompt. */
export function LabMusicShelf({ tracks, onDetail }: LabMusicShelfProps) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
      {tracks.map((t) => (
        <Paper key={t.id} component="article" {...stylex.props(styles.track)}>
          <Stack gap="xs" align="stretch">
            <Group justify="space-between" align="baseline" wrap="nowrap">
              <Text fw={700}>{t.name.replace(/^music-/, '')}</Text>
              <Readout>{t.cost === null ? '' : formatGenerationCost(t.cost)}</Readout>
            </Group>
            <Readout label>{labProjectShortName(t.project)} · {labMusicModelWords(t.model)}</Readout>
            <LabTrackPlayer url={t.files[0]} />
            <Text c="dimmed" lineClamp={3}>{t.prompt.replace(INSTRUMENTAL_PREAMBLE, '')}</Text>
            <Anchor component="button" type="button" fw={600} size="sm" ta="left" onClick={() => onDetail(t)}>Full prompt →</Anchor>
          </Stack>
        </Paper>
      ))}
    </SimpleGrid>
  );
}
