import * as stylex from '@stylexjs/stylex';
import { colors } from '#web/shared/ui/theme.stylex.ts';
import { useLabWholeVideo } from '../use-lab-whole-video.ts';

const styles = stylex.create({
  video: { display: 'block', width: '100%', backgroundColor: colors.screen },
});

type LabGeneratedVideoProps = {
  readonly url: string;
  /** Plays at once with its controls showing, as a piece looked at on its own; otherwise a still first frame. */
  readonly autoPlay?: boolean;
  readonly xstyle?: stylex.StyleXStyles;
};

/** A generated clip, muted and looping. */
export function LabGeneratedVideo({ url, autoPlay = false, xstyle }: LabGeneratedVideoProps) {
  const src = useLabWholeVideo(url);
  return <video src={src} muted loop playsInline autoPlay={autoPlay} controls={autoPlay} {...stylex.props(styles.video, xstyle)} />;
}
