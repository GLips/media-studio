// Root.tsx: registers the one project this bundle was built for (see lib/project-bundle.ts), as a composition named
// after its folder.

import { Composition } from 'remotion';
import video from '@project';
import { FPS, H, W } from './frame.ts';
import { layoutVideo, totalFrames } from './timeline.ts';
import { Video, type VideoProps } from './Video.tsx';

const ProjectVideo = (props: VideoProps) => <Video video={video} {...props} />;

export function Root() {
  const tl = layoutVideo(video);
  return (
    <Composition
      id={PROJECT_SLUG}
      component={ProjectVideo}
      width={W}
      height={H}
      fps={FPS}
      durationInFrames={totalFrames(tl, FPS)}
      defaultProps={{ captions: false, probe: false } satisfies VideoProps}
    />
  );
}
