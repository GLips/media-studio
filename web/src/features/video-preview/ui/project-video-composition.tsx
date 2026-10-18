import { Video } from '#lib/picture/composition/studio/Video.tsx';
import { PictureRoot } from '#lib/picture/readback/studio/picture-root.tsx';
import type { ProjectVideoModules } from '../controllers/project-video-modules.ts';

/** The preview Player's composition: the video as a render draws it, in its picture root, with no render's reports. */
export function ProjectVideoComposition({ modules: { video, footage, sfxCues }, captions }: { modules: ProjectVideoModules; captions: boolean }) {
  return (
    <PictureRoot>
      <Video video={video} footage={footage} sfxCues={sfxCues} captions={captions} probe={false} blockouts={false} reportTimeline={false} />
    </PictureRoot>
  );
}
