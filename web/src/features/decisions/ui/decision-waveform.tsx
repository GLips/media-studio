import { Box } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, type PointerEvent } from 'react';
import { drawReviewPeaks, reviewPeaksQueryOptions } from '#web/features/review/index.ts';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { DECISION_TIME_VAR, decisionTimeAxisOf, useDecisionPlaybackState } from './decision-playback.ts';
import { useDecisionScreen } from './decision-screen-context.tsx';

const styles = stylex.create({
  wave: { position: 'relative', width: '100%', height: '100%', cursor: 'pointer', touchAction: 'none' },
  loading: { backgroundColor: colors.skeleton },
  // The canvas reads its ink from its own `color`, so the waveform is drawn in the token.
  canvas: { position: 'absolute', top: 0, left: 0, height: '100%', color: colors.mark },
  // The candidate's own length as a share of the longest's: every lane on one time axis.
  spans: (share: number) => ({ width: `${share * 100}%` }),
  playhead: {
    position: 'absolute', top: 0, bottom: 0, width: spacing.hairline, backgroundColor: colors.cream, pointerEvents: 'none',
    borderInlineWidth: '1px', borderInlineStyle: 'solid', borderInlineColor: colors.ground, boxSizing: 'content-box', translate: '-2px 0',
  },
  at: (seconds: number) => ({ left: `calc(min(var(${DECISION_TIME_VAR}, 0) / ${seconds}, 1) * 100%)` }),
});

type DecisionWaveformProps = { readonly candidateKey: string; readonly path: string; readonly hash: string };

/**
 * An audio candidate's waveform on the screen's one time axis (the longest candidate's), so the shared playhead sits
 * at the same x in every lane; a press hears this candidate from there.
 */
export function DecisionWaveform({ candidateKey, path, hash }: DecisionWaveformProps) {
  const { project, playback, focus } = useDecisionScreen();
  // Unpinned, as the candidate plays: a file re-made in place shows its new sound, marked changed.
  const peaks = useQuery(reviewPeaksQueryOptions(project, path, hash, { pinned: false })).data;
  const own = useDecisionPlaybackState(playback, (s) => s.durations[candidateKey]) ?? (peaks && peaks.peaks.length / peaks.perSecond);
  const seconds = useDecisionPlaybackState(playback, decisionTimeAxisOf) ?? own;
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !peaks) return undefined;
    const observer = new ResizeObserver(() => drawReviewPeaks(c, peaks, { from: 0, to: peaks.peaks.length / peaks.perSecond }));
    observer.observe(c);
    return () => observer.disconnect();
  }, [peaks]);
  const seekAt = (event: PointerEvent<HTMLElement>) => {
    if (seconds === undefined) return;
    const box = event.currentTarget.getBoundingClientRect();
    focus(candidateKey);
    playback.seek(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * seconds);
  };
  return (
    <Box
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        seekAt(event);
      }}
      onPointerMove={(event) => { if (event.buttons) seekAt(event); }}
      {...stylex.props(styles.wave, !peaks && styles.loading)}
    >
      <Box component="canvas" ref={canvas} {...stylex.props(styles.canvas, styles.spans(own !== undefined && seconds ? Math.min(1, own / seconds) : 1))} />
      {seconds !== undefined && <Box {...stylex.props(styles.playhead, styles.at(seconds))} />}
    </Box>
  );
}
