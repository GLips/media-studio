import { createServerOnlyFn } from '@tanstack/react-start';
import { fileResponse } from '#web/infrastructure/media-response.server.ts';
import { ProjectMediaNotFound, renderFileStamp, resolveProjectMedia, reviewStills } from '#web/infrastructure/studio-engine.server.ts';

/** A storyboard still: `?path=<render>&render=<hash>&frame=<n>&fps=<fps>`, cut once per render and frame. */
export const respondWithReviewStill = createServerOnlyFn(async (request: Request, project: string): Promise<Response> => {
  const query = new URL(request.url).searchParams;
  let media: string;
  try {
    media = resolveProjectMedia(project, query.get('path') ?? '');
  } catch (error) {
    if (error instanceof ProjectMediaNotFound) return new Response(error.message, { status: 404 });
    throw error;
  }
  const hash = renderFileStamp(media).hash, frame = Number(query.get('frame')), fps = Number(query.get('fps'));
  if (hash !== query.get('render')) return new Response('replaced on disk since the page loaded it', { status: 410 });
  if (!(Number.isInteger(frame) && frame >= 0 && fps > 0)) return new Response('a still needs a whole frame and the fps', { status: 400 });
  const still = await reviewStills.cut(media, hash, frame, fps);
  return fileResponse(request, still, still.endsWith('.png') ? 'image/png' : 'image/jpeg');
});
