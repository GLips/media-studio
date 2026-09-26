import { Image } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import type { LabGalleryItem } from '#models/lab/lab-catalog.ts';
import { colors } from '#web/shared/ui/theme.stylex.ts';
import { LabGeneratedVideo } from './lab-generated-video.tsx';
import { LabTrackPlayer } from './lab-track-player.tsx';

const styles = stylex.create({
  // A see-through image (a cut-out, an SVG) reads as see-through only against a checkerboard.
  checker: {
    backgroundColor: colors.mediaCheckerDark,
    backgroundImage: `repeating-conic-gradient(${colors.mediaCheckerLight} 0 25%, transparent 0 50%)`,
    backgroundSize: '20px 20px',
  },
});

type LabGeneratedMediaViewProps = {
  readonly url: string;
  readonly kind: LabGalleryItem['kind'];
  readonly autoPlay?: boolean;
  /** Sizes a still or a clip; a track player takes its row's width. */
  readonly xstyle?: stylex.StyleXStyles;
};

/** A generated file as its kind plays: a still on a checkerboard, a muted looping clip, or a track player. */
export function LabGeneratedMediaView({ url, kind, autoPlay = false, xstyle }: LabGeneratedMediaViewProps) {
  if (kind === 'video') return <LabGeneratedVideo url={url} autoPlay={autoPlay} xstyle={xstyle} />;
  if (kind === 'audio') return <LabTrackPlayer url={url} />;
  return <Image src={url} alt="" {...stylex.props(styles.checker, xstyle)} />;
}
