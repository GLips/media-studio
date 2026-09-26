import { Group, SimpleGrid, Text, UnstyledButton } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { LabGalleryItem } from '#models/lab/lab-catalog.ts';
import { formatGenerationCost } from '#models/lab/lab-generated-media.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius } from '#web/shared/ui/theme.stylex.ts';
import { LabGeneratedMediaView } from './lab-generated-media-view.tsx';

const styles = stylex.create({
  card: {
    display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', cursor: 'zoom-in',
    backgroundColor: colors.panel, borderWidth: '1px', borderStyle: 'solid', borderColor: { default: 'transparent', ':hover': colors.dim }, borderRadius: radius.surface,
  },
  picture: { width: '100%', aspectRatio: '16 / 9', objectFit: 'contain', borderRadius: radius.control },
});

type LabMediaStillsProps = {
  readonly items: readonly LabGalleryItem[];
  readonly onDetail: (item: LabGalleryItem) => void;
};

/** Generated pieces as a grid of cards, each opening large on a click. */
export function LabMediaStills({ items, onDetail }: LabMediaStillsProps) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
      {items.map((item) => (
        <UnstyledButton key={item.id} onClick={() => onDetail(item)} {...stylex.props(styles.card)}>
          <LabGeneratedMediaView url={item.files[0]} kind={item.kind} xstyle={styles.picture} />
          <Group justify="space-between" align="baseline" wrap="nowrap">
            <Text fw={700}>{item.name}</Text>
            <Readout>{item.cost === null ? '' : formatGenerationCost(item.cost)}</Readout>
          </Group>
          <Text size="xs" c="dimmed" lineClamp={2}>{item.prompt}</Text>
        </UnstyledButton>
      ))}
    </SimpleGrid>
  );
}
