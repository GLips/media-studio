// studio music: adds a music track to a project (lib/music-track.ts).
import { defineCommand } from 'citty';
import { studioProjectArg } from '../project-arg.ts';

export default defineCommand({
  meta: {
    name: 'music',
    description: "Copy a track into the project's music/, measure its loudness, tempo and beats, and write music/index.ts. Use it with defineVideo({ music: { track: music.bed } }). Prints music/index.ts.",
  },
  args: {
    project: studioProjectArg,
    track: { type: 'positional', required: true, description: 'The audio file to add' },
    name: { type: 'string', default: 'bed', description: 'What the video calls it: music.<name>' },
  },
  async run({ args }) {
    const { resolve } = await import('node:path');
    const { resolveStudioProject } = await import('../../lib/studio-project.ts');
    const { addProjectMusicTrack } = await import('../../lib/music-track.ts');
    console.log(addProjectMusicTrack(resolveStudioProject(args.project), resolve(args.track), args.name));
  },
});
