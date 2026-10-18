// project-video-player.tsx: a project's video played live in the page by Remotion's Player, from its video.tsx rather
// than a render, so it re-times as storyboard.ts and the scenes change. A caller drives it through `playerRef`
// (seekTo, play, pause) or `frame`, and hears what loaded through `onLoadState`.
//
// Negative space: a video's `clock` isn't pinned, as a render pins it: that stops Date for the whole tab, the page
// included.
import { Player, type PlayerRef } from '@remotion/player';
import * as stylex from '@stylexjs/stylex';
import { Box, Text } from '@mantine/core';
import { useEffect, useEffectEvent, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { laidVideoOf, videoFormatOf, type VideoDef } from '#lib/picture/video/studio/video.ts';
import { colors, spacing } from '#web/shared/ui/theme.stylex.ts';
import type { ProjectVideoModules } from '../controllers/project-video-modules.ts';
import { useProjectVideo } from '../controllers/use-project-video.ts';

/** What the player has, as its caller hears it: a ready video's format and length, or why there's none. */
export type ProjectVideoLoadState =
  | { state: 'loading' }
  | { state: 'none' }
  | { state: 'failed'; error: string }
  /** `error`: a newer copy failed to load, and the last that did plays on. */
  | { state: 'ready'; fps: number; durationInFrames: number; width: number; height: number; error: string | null };

export type ProjectVideoPlayerProps = {
  readonly project: string;
  /** Remotion's handle on the player: seekTo, play, pause, getCurrentFrame, and its events. */
  readonly playerRef?: RefObject<PlayerRef | null>;
  /** The frame to show: the player seeks whenever it changes. Leave it out to drive the player through `playerRef`. */
  readonly frame?: number;
  /** Remotion's own controls bar; off by default, for a caller with its own transport. */
  readonly controls?: boolean;
  /** Burn the video's captions in, as a captioned render does. */
  readonly captions?: boolean;
  readonly onLoadState?: (load: ProjectVideoLoadState) => void;
  /** Shown in place of the player while it has no video; a message naming why by default. */
  readonly fallback?: (load: Exclude<ProjectVideoLoadState, { state: 'ready' }>) => ReactNode;
};

const styles = stylex.create({
  frame: { width: '100%', background: colors.screen },
  placeholder: { display: 'flex', alignItems: 'center', justifyContent: 'center', aspectRatio: '16 / 9', padding: spacing.inset, overflow: 'auto' },
  message: { color: colors.dim, whiteSpace: 'pre-wrap' },
  failed: { color: colors.danger },
});

// Inline, as the Player reads its size from `style`: given a width alone, it takes its height from the video's aspect.
// A class can't say this, since without a style width it sets its inline size to the composition's pixels.
const PLAYER_STYLE = { width: '100%' } as const;

// Lazy, so a page that never plays a video never loads lib's picture code. Module-level: the Player wants it stable.
const loadProjectVideoComposition = () => import('./project-video-composition.tsx').then(({ ProjectVideoComposition }) => ({ default: ProjectVideoComposition }));

const WAITING_TEXT = { loading: 'Loading the video…', none: 'This project has no video.tsx.' } as const;

function ProjectVideoMessage({ load }: { load: Exclude<ProjectVideoLoadState, { state: 'ready' }> }) {
  const text = load.state === 'failed' ? load.error : WAITING_TEXT[load.state];
  return <Text ff="monospace" size="xs" {...stylex.props(styles.message, load.state === 'failed' && styles.failed)}>{text}</Text>;
}

type PlayableFormat = { fps: number; durationInFrames: number; width: number; height: number };

// Laid out once per video definition: the player re-renders on every tick of a caller's clock.
const playableFormats = new WeakMap<VideoDef, PlayableFormat>();
function playableFormatOf(video: VideoDef): PlayableFormat {
  let format = playableFormats.get(video);
  if (!format) {
    const { fps, width, height } = videoFormatOf(video);
    playableFormats.set(video, (format = { fps, width, height, durationInFrames: Math.max(1, laidVideoOf(video).frames) }));
  }
  return format;
}

type ProjectVideoStageProps = Pick<ProjectVideoPlayerProps, 'frame' | 'controls' | 'captions'> & {
  readonly modules: ProjectVideoModules;
  readonly playerRef: RefObject<PlayerRef | null>;
};

function ProjectVideoStage({ modules, playerRef, frame, controls, captions = false }: ProjectVideoStageProps) {
  const format = playableFormatOf(modules.video);
  const inputProps = useMemo(() => ({ modules, captions }), [modules, captions]);
  useEffect(() => {
    if (frame !== undefined) playerRef.current?.seekTo(Math.min(frame, format.durationInFrames - 1));
  }, [frame, format, playerRef]);
  return (
    <Box {...stylex.props(styles.frame)}>
      <Player
        ref={playerRef}
        lazyComponent={loadProjectVideoComposition}
        inputProps={inputProps}
        durationInFrames={format.durationInFrames}
        fps={format.fps}
        compositionWidth={format.width}
        compositionHeight={format.height}
        initialFrame={frame}
        controls={controls}
        acknowledgeRemotionLicense
        style={PLAYER_STYLE}
      />
    </Box>
  );
}

export function ProjectVideoPlayer({ project, playerRef, frame, controls = false, captions = false, onLoadState, fallback }: ProjectVideoPlayerProps) {
  const load = useProjectVideo(project);
  const ownRef = useRef<PlayerRef>(null);
  // Built from parts that keep their identity across renders, so the caller hears each change once.
  const { state } = load, format = load.state === 'ready' ? playableFormatOf(load.modules.video) : null;
  const error = load.state === 'ready' || load.state === 'failed' ? load.error : null;
  const loadState = useMemo((): ProjectVideoLoadState => {
    if (format) return { state: 'ready', ...format, error };
    return state === 'failed' ? { state, error: error ?? '' } : { state: state === 'none' ? 'none' : 'loading' };
  }, [state, format, error]);
  const reportLoadState = useEffectEvent((next: ProjectVideoLoadState) => onLoadState?.(next));
  useEffect(() => reportLoadState(loadState), [loadState]);

  if (load.state !== 'ready') {
    return <Box {...stylex.props(styles.frame, styles.placeholder)}>{fallback ? fallback(load) : <ProjectVideoMessage load={load} />}</Box>;
  }
  return <ProjectVideoStage modules={load.modules} playerRef={playerRef ?? ownRef} frame={frame} controls={controls} captions={captions} />;
}
