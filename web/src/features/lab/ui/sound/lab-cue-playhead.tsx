import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, type RefObject } from 'react';
import { colors } from '#web/shared/ui/theme.stylex.ts';

const styles = stylex.create({
  playhead: {
    position: 'absolute', top: 0, bottom: 0, width: '2px', marginLeft: '-1px', backgroundColor: colors.accent,
    pointerEvents: 'none', zIndex: 4,
  },
});

type LabCuePlayheadProps = { readonly videoRef: RefObject<HTMLVideoElement | null>; readonly duration: number };

/**
 * The timeline's playhead, following the video. It's moved straight on the DOM every frame rather than through state,
 * so the timeline and its hundred markers don't re-render 60 times a second.
 */
export function LabCuePlayhead({ videoRef, duration }: LabCuePlayheadProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const move = () => {
      const video = videoRef.current;
      if (video && ref.current) ref.current.style.left = `${(video.currentTime / duration) * 100}%`;
      frame = requestAnimationFrame(move);
    };
    move();
    return () => cancelAnimationFrame(frame);
  }, [videoRef, duration]);
  return <Box ref={ref} {...stylex.props(styles.playhead)} />;
}
