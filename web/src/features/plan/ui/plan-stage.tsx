import { Box, Text } from '@mantine/core';
import type { PlayerRef } from '@remotion/player';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ProjectVideoPlayer, type ProjectVideoLoadState } from '#web/features/video-preview/index.ts';
import { colors, radius, spacing } from '#web/shared/ui/theme.stylex.ts';
import { usePlanScreen } from './plan-screen-context.tsx';
import { formatPlanSeconds } from './plan-timing.ts';

/** The video's frame further than this off where the plan's clock puts it is put back. */
const PLAN_STAGE_DRIFT_FRAMES = 4;

const styles = stylex.create({
  stage: {
    position: 'relative', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: spacing.gap, backgroundColor: colors.screen, padding: spacing.inset, containerType: 'size',
  },
  // As wide as the stage allows and no taller than it: a portrait video stands centred instead of overflowing.
  fit: (aspect: number) => ({ width: `min(100cqw - 2 * ${spacing.inset}, (100cqh - 2 * ${spacing.inset} - ${spacing.row}) * ${aspect})` }),
  frame: { borderRadius: radius.control, overflow: 'hidden' },
  note: { color: colors.dim, maxWidth: '72ch', textAlign: 'center' },
  problem: { color: colors.danger, whiteSpace: 'pre-wrap', maxWidth: '72ch' },
});

type PlanStageFormat = Extract<ProjectVideoLoadState, { state: 'ready' }>;

/** Keeps the muted player on the plan's clock: playing with it, paused with it, and put back when it strays or seeks. */
function usePlanStageFollow(playerRef: RefObject<PlayerRef | null>, format: PlanStageFormat | null) {
  const { playback, timing } = usePlanScreen();
  const planFps = timing?.fps ?? 30;
  useEffect(() => {
    if (!format) return undefined;
    const toVideo = (frame: number) => Math.min(format.durationInFrames - 1, Math.round((frame / planFps) * format.fps));
    const player = () => playerRef.current;
    // The plan plays the voice and music itself, so the video's own sound would double them.
    player()?.mute();
    const follow = (frame: number) => {
      const at = player();
      if (!at) return;
      const want = toVideo(frame);
      if (Math.abs(at.getCurrentFrame() - want) > PLAN_STAGE_DRIFT_FRAMES) at.seekTo(want);
    };
    const steer = () => {
      const at = player();
      if (!at) return;
      const { playing, frame } = playback.getState();
      at.seekTo(toVideo(playing ? playback.frameNow() : frame));
      if (playing && !at.isPlaying()) at.play();
      if (!playing && at.isPlaying()) at.pause();
    };
    steer();
    const stopTicks = playback.onTick(follow);
    const stopState = playback.subscribe(steer);
    return () => {
      stopTicks();
      stopState();
    };
  }, [playback, playerRef, format, planFps]);
}

/**
 * The plan's picture: the project's video.tsx played live on the plan's clock, so it re-times the moment storyboard.ts
 * changes. A video that runs a different length than the plan says so, since its scenes then aren't the plan's.
 */
export function PlanStage() {
  const { project, timing } = usePlanScreen();
  const playerRef = useRef<PlayerRef>(null);
  const [format, setFormat] = useState<PlanStageFormat | null>(null);
  usePlanStageFollow(playerRef, format);
  const videoSeconds = format && format.durationInFrames / format.fps;
  const planSeconds = timing && timing.end / timing.fps;
  const apart = videoSeconds !== null && planSeconds !== null && Math.abs(videoSeconds - planSeconds) > 0.1;
  return (
    <Box {...stylex.props(styles.stage)}>
      <Box {...stylex.props(styles.frame, styles.fit(format ? format.width / format.height : 16 / 9))}>
        <ProjectVideoPlayer project={project} playerRef={playerRef} onLoadState={(load) => setFormat(load.state === 'ready' ? load : null)} />
      </Box>
      {format?.error && <Text size="xs" ff="monospace" {...stylex.props(styles.problem)}>The newest video.tsx doesn't load, so this is the last copy that did:{'\n'}{format.error}</Text>}
      {apart && (
        <Text size="sm" {...stylex.props(styles.note)}>
          The video runs {formatPlanSeconds(videoSeconds)} and the plan {formatPlanSeconds(planSeconds)}: video.tsx doesn't take all its timing from storyboard.ts yet.
        </Text>
      )}
    </Box>
  );
}
