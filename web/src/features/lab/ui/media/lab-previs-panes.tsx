import { Box, SimpleGrid, Text } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { PointerEvent } from 'react';
import type { LabGalleryItem } from '#models/lab/lab-catalog.ts';
import { formatGenerationCost, previsBlockoutUrl } from '#models/lab/lab-generated-media.ts';
import { Readout } from '#web/shared/ui/readout.tsx';
import { shadows } from '#web/shared/ui/shadows.ts';
import { colors, fonts } from '#web/shared/ui/theme.stylex.ts';
import { useLabWholeVideo } from '../use-lab-whole-video.ts';
import type { LabPrevisPlayback } from './use-lab-previs-playback.ts';

export type LabPrevisView = 'side' | 'wipe';

const styles = stylex.create({
  captions: { marginBottom: '6px' },
  centered: { textAlign: 'center' },
  panes: { position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  // Wipe stacks both clips in one cell as wide as a side-by-side pane, so the section's height doesn't change.
  wipePanes: {
    gridTemplateColumns: '1fr', width: 'calc(50% - 8px)', marginInline: 'auto', cursor: 'ew-resize',
    touchAction: 'none', userSelect: 'none', borderRadius: '4px', overflow: 'hidden',
  },
  stacked: { gridArea: '1 / 1' },
  video: { display: 'block', width: '100%', aspectRatio: '16 / 9', backgroundColor: colors.screen, borderRadius: '4px' },
  clip: (wipe: number) => ({ clipPath: `inset(0 0 0 ${wipe}%)` }),
  bar: (wipe: number) => ({
    position: 'absolute', top: 0, bottom: 0, left: `${wipe}%`, width: '2px', marginLeft: '-1px', backgroundColor: colors.cream,
    pointerEvents: 'none',
  }),
  handle: {
    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '36px', height: '36px',
    borderRadius: '50%', backgroundColor: colors.cream, color: colors.ground, display: 'grid', placeItems: 'center',
  },
  label: {
    position: 'absolute', top: '12px', paddingBlock: '3px', paddingInline: '8px', borderRadius: '4px', pointerEvents: 'none',
    backgroundColor: `color-mix(in srgb, ${colors.ground} 75%, transparent)`,
    fontFamily: fonts.mono, letterSpacing: '0.04em', textTransform: 'uppercase', color: colors.cream,
  },
  left: { left: '12px' },
  right: { right: '12px' },
});

type LabPrevisPanesProps = {
  readonly item: LabGalleryItem;
  readonly playback: LabPrevisPlayback;
  readonly view: LabPrevisView;
  /** Where the wipe's line sits, as a percentage of the pane's width from its left. */
  readonly wipe: number;
  readonly onWipe: (wipe: number) => void;
};

/**
 * The blockout and its render, side by side or one wiped over the other. Both videos stay mounted in the same places
 * in either view, so switching views keeps their time and play state.
 */
export function LabPrevisPanes({ item, playback, view, wipe, onWipe }: LabPrevisPanesProps) {
  const blockoutSrc = useLabWholeVideo(previsBlockoutUrl(item));
  const renderSrc = useLabWholeVideo(item.files[0]);
  const { blockoutRef, renderRef, onBlockoutMetadata, onRenderMetadata } = playback;
  const wiping = view === 'wipe';

  const dragWipe = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
    else if (!e.buttons) return;
    const box = e.currentTarget.getBoundingClientRect();
    onWipe(Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100)));
  };

  return (
    <Box>
      {wiping ? (
        <Box {...stylex.props(styles.captions, styles.centered)}>
          <Readout label>Drag across the picture: blockout on the left of the line, render on the right</Readout>
        </Box>
      ) : (
        <SimpleGrid cols={2} spacing="md" {...stylex.props(styles.captions)}>
          <Readout label>1 · The blockout · free, drawn in code</Readout>
          <Readout label>2 · The render · {item.cost === null ? '' : formatGenerationCost(item.cost)} from Seedance</Readout>
        </SimpleGrid>
      )}
      <Box {...stylex.props(styles.panes, wiping && styles.wipePanes)}
        onPointerDown={wiping ? dragWipe : undefined} onPointerMove={wiping ? dragWipe : undefined}>
        <video ref={blockoutRef} key={`b-${item.id}`} src={blockoutSrc} muted loop playsInline preload="auto"
          onLoadedMetadata={(e) => onBlockoutMetadata(e.currentTarget)}
          {...stylex.props(styles.video, wiping && styles.stacked)} />
        <Box {...stylex.props(wiping && styles.stacked, wiping && styles.clip(wipe))}>
          <video ref={renderRef} key={`r-${item.id}`} src={renderSrc} muted loop playsInline preload="auto"
            onLoadedMetadata={(e) => onRenderMetadata(e.currentTarget)} {...stylex.props(styles.video)} />
        </Box>
        {wiping && <>
          <Box {...stylex.props(styles.bar(wipe), shadows.paneHairline)}><Text size="xl" {...stylex.props(styles.handle)}>⇆</Text></Box>
          <Text component="span" size="xs" {...stylex.props(styles.label, styles.left)}>Blockout</Text>
          <Text component="span" size="xs" {...stylex.props(styles.label, styles.right)}>Render</Text>
        </>}
      </Box>
    </Box>
  );
}
