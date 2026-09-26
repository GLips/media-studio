import { ActionIcon, Box, Code, Group, Modal, Stack, Text, Title } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useHotkeys } from '@tanstack/react-hotkeys';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { LabGalleryItem } from '#models/lab/lab-catalog.ts';
import { formatGenerationCost, GENERATED_MEDIA_KIND_WORDS, isLabVideoUrl } from '#models/lab/lab-generated-media.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, fonts, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { LabGeneratedMediaView } from './lab-generated-media-view.tsx';

const NARROW = '@media (max-width: 900px)';

const styles = stylex.create({
  layout: {
    display: 'grid', gap: '24px',
    gridTemplateColumns: { default: 'minmax(0, 1.7fr) minmax(300px, 1fr)', [NARROW]: '1fr' },
  },
  view: { minWidth: 0 },
  large: { width: '100%', maxHeight: 'calc(100vh - 180px)', objectFit: 'contain', borderRadius: '8px' },
  track: { marginTop: '40px' },
  name: { fontFamily: fonts.display, fontWeight: 900, fontStretch: '85%', lineHeight: 1.1 },
  facts: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', alignItems: 'baseline', margin: 0 },
  fact: { margin: 0 },
  chip: {
    fontFamily: fonts.mono, backgroundColor: colors.ground,
    borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line, borderRadius: '4px', paddingInline: spacing.tight,
  },
  prompt: {
    whiteSpace: 'pre-wrap', backgroundColor: colors.ground, borderWidth: '1px', borderStyle: 'solid', borderColor: colors.line,
    borderRadius: radius.surface, padding: '12px 14px',
  },
  reference: { width: '180px', aspectRatio: '16 / 9', objectFit: 'contain', borderRadius: radius.control },
});

type LabMediaLightboxProps = {
  readonly items: readonly LabGalleryItem[];
  readonly index: number;
  readonly onIndex: (index: number) => void;
  readonly onClose: () => void;
};

/**
 * One generated piece in full: the file large, then its model, cost, settings, prompt and references. ← → step
 * through `items`, so the pieces of a section can be compared one after another.
 */
export function LabMediaLightbox({ items, index, onIndex, onClose }: LabMediaLightboxProps) {
  const item = items[index];
  const step = (by: number) => onIndex((index + by + items.length) % items.length);
  useHotkeys([
    { hotkey: 'ArrowLeft', callback: () => step(-1) },
    { hotkey: 'ArrowRight', callback: () => step(1) },
  ]);
  const params = Object.entries(item.params);
  return (
    <Modal opened onClose={onClose} size="min(1400px, 100%)" centered>
      <Box {...stylex.props(styles.layout)}>
        <Stack gap="sm" {...stylex.props(styles.view)}>
          <Box {...stylex.props(item.kind === 'audio' && styles.track)}>
            <LabGeneratedMediaView key={item.id} url={item.files[0]} kind={item.kind} autoPlay xstyle={styles.large} />
          </Box>
          {items.length > 1 && (
            <Group justify="center" gap="sm">
              <ActionIcon variant="default" onClick={() => step(-1)} aria-label="Previous"><ArrowLeft size={16} /></ActionIcon>
              <Readout>{index + 1} / {items.length}</Readout>
              <ActionIcon variant="default" onClick={() => step(1)} aria-label="Next"><ArrowRight size={16} /></ActionIcon>
            </Group>
          )}
        </Stack>
        <Stack gap="xs">
          <Readout label>{GENERATED_MEDIA_KIND_WORDS[item.kind]}</Readout>
          <Title order={3} {...stylex.props(styles.name)}>{item.name}</Title>
          <Box component="dl" {...stylex.props(styles.facts)}>
            <Box component="dt"><Readout label>Model</Readout></Box>
            <Box component="dd" {...stylex.props(styles.fact)}><Code>{item.model}</Code></Box>
            <Box component="dt"><Readout label>Cost</Readout></Box>
            <Box component="dd" {...stylex.props(styles.fact)}>{item.cost === null ? 'not recorded' : formatGenerationCost(item.cost)}</Box>
            {item.generatedAt && <>
              <Box component="dt"><Readout label>Made</Readout></Box>
              <Box component="dd" {...stylex.props(styles.fact)}>{new Date(item.generatedAt).toLocaleString()}</Box>
            </>}
            {params.length > 0 && <>
              <Box component="dt"><Readout label>Settings</Readout></Box>
              <Group component="dd" gap={4} {...stylex.props(styles.fact)}>
                {params.map(([k, v]) => <Text key={k} component="span" size="xs" {...stylex.props(styles.chip)}>{k.replaceAll('_', ' ')}: {String(v)}</Text>)}
              </Group>
            </>}
          </Box>
          <Readout label>The prompt, word for word</Readout>
          <Text {...stylex.props(styles.prompt)}>{item.prompt}</Text>
          {item.references.length > 0 && <>
            <Readout label>Given to the model alongside the prompt</Readout>
            <Group gap="xs">
              {item.references.map((r) => (
                <LabGeneratedMediaView key={r} url={r} kind={isLabVideoUrl(r) ? 'video' : 'image'} autoPlay xstyle={styles.reference} />
              ))}
            </Group>
          </>}
        </Stack>
      </Box>
    </Modal>
  );
}
