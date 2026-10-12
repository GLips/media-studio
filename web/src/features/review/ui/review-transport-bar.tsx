import { Box, Group } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { Grid3x3, LayoutGrid, Pause, Pencil, Play, Repeat, Scan, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { nextReviewGuideSet } from '#lib/output/review/models/review-guides.ts';
import { formatReviewClock } from '#lib/output/review/models/review-timeline-geometry.ts';
import { IconButton } from '#web/shared/ui/icon-button.tsx';
import { Readout } from '#web/shared/ui/readout.tsx';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import { ReviewCompareMenu } from './review-compare-menu.tsx';
import { toggleReviewDraw } from './review-draft-pin.ts';
import { ReviewProofGroundControl } from './review-proof-ground-control.tsx';
import { reviewPlayheadLeft } from './review-lane-playhead.tsx';
import { useReviewPlaybackState, type ReviewPlayback, type ReviewPlaybackState } from './review-playback-store.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { reviewLoopFor } from './use-review-playback-hotkeys.ts';
import { useReviewThreads } from './use-review-threads.ts';
import { useReviewTimelineView } from './use-review-timeline-view.ts';

const styles = stylex.create({
  bar: {
    position: 'relative', height: spacing.bar, paddingInline: spacing.tight, backgroundColor: colors.panel,
    borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: colors.line,
  },
  rule: { width: '1px', alignSelf: 'stretch', marginBlock: spacing.tight, backgroundColor: colors.line },
  // Over the dock's lanes (past its gutter), so the notch stands where the dock's playhead does. A notch in the bar's
  // top edge only: any deeper and it strikes through the buttons under it.
  edge: { position: 'absolute', top: '-1px', left: spacing.laneGutter, right: 0, height: spacing.tight, overflow: 'hidden', pointerEvents: 'none', zIndex: 1 },
  notch: {
    position: 'absolute', top: 0, bottom: 0, width: '2px', marginLeft: '-2px', boxSizing: 'content-box', backgroundColor: colors.cream,
    borderLeftWidth: '1px', borderLeftStyle: 'solid', borderLeftColor: colors.ground,
    borderRightWidth: '1px', borderRightStyle: 'solid', borderRightColor: colors.ground,
  },
  at: (left: string) => ({ left }),
});

/** The rate the transport shows beside the time: the shuttle's, slowed by the loop's; null at plain 1×. */
function reviewShownRate({ playing, rate, loop, loopRate }: ReviewPlaybackState): number | null {
  const shown = (playing ? rate : 1) * (loop ? loopRate : 1);
  return shown === 1 ? null : shown;
}

/** The time and frame readouts' nodes, written each animation frame while playing, as the playhead is. */
function useReviewPlayingReadouts(playback: ReviewPlayback, playing: boolean, fps: number) {
  const time = useRef<HTMLSpanElement>(null);
  const frameNumber = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!playing) return undefined;
    let raf = requestAnimationFrame(function write() {
      const now = playback.frameNow();
      if (time.current) time.current.textContent = formatReviewClock(now / fps);
      if (frameNumber.current) frameNumber.current.textContent = `f${now}`;
      raf = requestAnimationFrame(write);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, playback, fps]);
  return { time, frameNumber };
}

/**
 * `▶ 0:04.53 f136 ⟲ ♪ │ compare │ ✎ ⌗ ⊡ ▦`: the transport between the stage and the dock, with the playhead's notch on the
 * stage's edge. While playing, the time is written straight into its nodes, as the playhead is, so the bar re-renders
 * only when the clock settles.
 */
export function ReviewTransportBar() {
  const screen = useReviewScreen();
  const { playback, timing, mode, setMode, search, setSearch, guides, setGuides } = screen;
  const threads = useReviewThreads();
  const state = useReviewPlaybackState(playback, (s) => s);
  const view = useReviewTimelineView(playback);
  const { time, frameNumber } = useReviewPlayingReadouts(playback, state.playing, timing.fps);
  const rate = reviewShownRate(state);
  // The widest each readout gets on this render: its last time (always with hundredths, so 0:10.00 and 0:11.20 are
  // one width), and its last frame.
  const timeChars = formatReviewClock((timing.durationInFrames - 1) / timing.fps).length;
  const frameChars = `f${timing.durationInFrames - 1}`.length;
  const toggleLoop = () => {
    const loop = state.loop ? null : reviewLoopFor(screen, playback.frameNow(), threads?.threads.find((t) => t.id === search.note));
    playback.setLoop(loop);
    if (loop) playback.seek(loop.from);
  };
  return (
    <Group gap="tight" wrap="nowrap" {...stylex.props(styles.bar)}>
      <Box {...stylex.props(styles.edge)}><Box {...stylex.props(styles.notch, styles.at(reviewPlayheadLeft(view)))} /></Box>
      <IconButton name="Play" onClick={playback.toggle}>{state.playing ? <Pause size={14} /> : <Play size={14} />}</IconButton>
      <Readout bright ref={time} chars={timeChars}>{formatReviewClock(state.frame / timing.fps)}</Readout>
      <Readout ref={frameNumber} chars={frameChars}>{`f${state.frame}`}</Readout>
      {rate !== null && <Readout bright>{`${rate}×`}</Readout>}
      <IconButton name="Loop" active={state.loop !== null} onClick={toggleLoop}><Repeat size={14} /></IconButton>
      <IconButton name="Mute" active={state.muted} onClick={() => playback.setMuted(!state.muted)}>{state.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</IconButton>
      <Box {...stylex.props(styles.rule)} />
      <ReviewCompareMenu />
      <Box {...stylex.props(styles.rule)} />
      {screen.artifact.transparent && <ReviewProofGroundControl />}
      <IconButton name="Draw" active={mode === 'draw'} onClick={() => toggleReviewDraw(screen)}><Pencil size={14} /></IconButton>
      <IconButton name="Guides" active={guides !== null} onClick={() => setGuides(nextReviewGuideSet)}><Grid3x3 size={14} /></IconButton>
      {guides && <Readout bright>{guides}</Readout>}
      <IconButton name="Fit / 1:1" active={search.z === 1} onClick={() => setSearch({ z: search.z === 1 ? undefined : 1 })}><Scan size={14} /></IconButton>
      <IconButton name="Board" active={mode === 'board'} onClick={() => setMode(mode === 'board' ? 'stage' : 'board')}><LayoutGrid size={14} /></IconButton>
    </Group>
  );
}
