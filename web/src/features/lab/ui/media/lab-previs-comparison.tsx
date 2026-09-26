import { Anchor, Box, Button, Group, Image, Paper, Slider, Stack, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import type { LabGalleryItem } from '#models/lab/lab-catalog.ts';
import { previsBlockoutUrl, previsSceneText } from '#models/lab/lab-generated-media.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { LabChoice } from '../lab-choice.tsx';
import { LabControls } from '../lab-controls.tsx';
import { LabPrevisPanes, type LabPrevisView } from './lab-previs-panes.tsx';
import { useLabPrevisPlayback } from './use-lab-previs-playback.ts';

const PREVIS_SPEEDS = [{ value: 1, label: 'Normal' }, { value: 0.5, label: '½ speed' }, { value: 0.25, label: '¼ speed' }] as const;
const PREVIS_VIEWS = [{ value: 'side', label: 'Side by side' }, { value: 'wipe', label: 'Wipe' }] as const;

const NARROW = '@media (max-width: 900px)';

const styles = stylex.create({
  play: { minWidth: '84px' },
  scrub: { flex: 1 },
  clock: { minWidth: '120px', textAlign: 'right' },
  scene: {
    display: 'grid', gap: '20px', backgroundColor: colors.panel, borderRadius: '12px', padding: `${spacing.inset} 20px`,
    gridTemplateColumns: { default: '1fr auto', [NARROW]: '1fr' },
  },
  sceneText: { maxWidth: '80ch' },
  photo: { width: '180px', borderRadius: radius.control, backgroundColor: colors.photoGround },
});

type LabPrevisComparisonProps = {
  readonly items: readonly LabGalleryItem[];
  readonly onDetail: (item: LabGalleryItem) => void;
};

/**
 * A Seedance render beside the grey 3D blockout it was told to follow, both playing off one clock, so the previs idea
 * shows for itself: block the shot for free, then pay once for a render that keeps its camera.
 */
export function LabPrevisComparison({ items, onDetail }: LabPrevisComparisonProps) {
  const [pick, setPick] = useState(items[0].id);
  const [view, setView] = useState<LabPrevisView>('side');
  const [speed, setSpeed] = useState<number>(1);
  const [wipe, setWipe] = useState(50);
  const item = items.find((i) => i.id === pick) ?? items[0];
  const playback = useLabPrevisPlayback(speed);
  const { playing, setPlaying, time, duration, seek } = playback;
  const photos = item.references.filter((r) => r !== previsBlockoutUrl(item));

  return (
    <Stack gap="sm">
      <LabPrevisPanes item={item} playback={playback} view={view} wipe={wipe} onWipe={setWipe} />

      <Group gap="sm" wrap="nowrap">
        <Button size="xs" variant="white" color="dark" onClick={() => setPlaying(!playing)} {...stylex.props(styles.play)}>
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Slider size="sm" label={null} min={0} max={duration} step={0.01} value={time} aria-label="Scrub both clips"
          onChange={(t) => { setPlaying(false); seek(t); }} {...stylex.props(styles.scrub)} />
        <Box {...stylex.props(styles.clock)}><Readout>{time.toFixed(2)}s / {duration.toFixed(2)}s</Readout></Box>
      </Group>

      <LabControls>
        <LabChoice label="Shot" options={items.map((i) => ({ value: i.id, label: i.name }))} value={item.id}
          onChange={(id) => { seek(0); setPick(id); }} hint="Three test shots, each blocked in 3D and then rendered once." />
        <LabChoice label="Compare" options={PREVIS_VIEWS} value={view} onChange={setView}
          hint="Wipe lays the render over its blockout, so you can check the camera and each object land in the same place." />
        <LabChoice label="Speed" options={PREVIS_SPEEDS} value={speed} onChange={setSpeed} hint="Slow it down to follow one object through the move." />
      </LabControls>

      <Paper {...stylex.props(styles.scene)}>
        <Stack gap="tight" align="flex-start">
          <Readout label>What each grey shape was told to become</Readout>
          <Text {...stylex.props(styles.sceneText)}>{previsSceneText(item.prompt)}</Text>
          <Anchor component="button" type="button" fw={600} size="sm" onClick={() => onDetail(item)}>The full prompt, settings and cost →</Anchor>
        </Stack>
        {photos.length > 0 && (
          <Stack gap="tight">
            <Readout label>Plus a photo of the real thing</Readout>
            {photos.map((p) => <Image key={p} src={p} alt="" {...stylex.props(styles.photo)} />)}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}
