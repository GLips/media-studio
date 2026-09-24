// Root.tsx: registers the one project this bundle was built for (see lib/project-bundle.ts), as a composition named
// after its folder, plus a replay of it for `render.ts --repeatable`.

import { Composition, Freeze, useCurrentFrame } from 'remotion';
import video from '@project';
import { FPS, H, W } from './frame.ts';
import { layoutVideo, totalFrames } from './timeline.ts';
import { Video, type VideoProps } from './Video.tsx';

const ProjectVideo = (props: VideoProps) => <Video video={video} {...props} />;

export type ReplayProps = VideoProps & { order: number[] };

/**
 * Frame i shows the video's frame order[i] (the last one past the end). Rendered in one tab, that gives each frame a
 * chosen history, which renderFrames can't (it sorts the frames it's asked for).
 */
const ReplayVideo = ({ order, ...props }: ReplayProps) => (
  <Freeze frame={order[Math.min(useCurrentFrame(), order.length - 1)]}>
    <ProjectVideo {...props} />
  </Freeze>
);

export function Root() {
  const tl = layoutVideo(video);
  const frames = totalFrames(tl, FPS);
  return (
    <>
      <Composition
        id={PROJECT_SLUG}
        component={ProjectVideo}
        width={W}
        height={H}
        fps={FPS}
        durationInFrames={frames}
        defaultProps={{ captions: false, probe: false } satisfies VideoProps}
      />
      <Composition
        id={REPLAY_SLUG}
        component={ReplayVideo}
        width={W}
        height={H}
        fps={FPS}
        durationInFrames={frames}
        // Never shorter than the video: a frozen frame is clamped to the composition's length.
        calculateMetadata={({ props }) => ({ durationInFrames: Math.max(frames, props.order.length) })}
        defaultProps={{ captions: false, probe: false, order: [0] } satisfies ReplayProps}
      />
    </>
  );
}
