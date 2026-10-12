import { createServerOnlyFn } from '@tanstack/react-start';
import { fileResponse } from '#web/infrastructure/media-response.server.ts';
import {
  listReviewRenderVersions, ProjectMediaNotFound, renderFileStamp, resolveProjectMedia, reviewStills,
} from '#web/infrastructure/studio-engine.server.ts';

/**
 * A Board still: `?path=<render>&render=<hash>&frame=<n>&fps=<fps>`, cut once per render and frame. Keyed by the
 * render's hash, so a page still showing a replaced render gets its tiles from the cut made already or from the
 * render's archived copy (`r14 ▾`'s), and a 410 only once no copy of those bytes is kept.
 */
export const respondWithReviewStill = createServerOnlyFn(async (request: Request, project: string): Promise<Response> => {
  const query = new URL(request.url).searchParams;
  const path = query.get('path') ?? '', hash = query.get('render') ?? '';
  const frame = Number(query.get('frame')), fps = Number(query.get('fps'));
  if (!(Number.isInteger(frame) && frame >= 0 && fps > 0)) return new Response('a still needs a whole frame and the fps', { status: 400 });
  const respond = (still: string) => fileResponse(request, still, still.endsWith('.png') ? 'image/png' : 'image/jpeg');
  const made = reviewStills.cutOf(hash, frame);
  if (made) return respond(await made);
  let media: string;
  try {
    media = resolveProjectMedia(project, path);
  } catch (error) {
    if (error instanceof ProjectMediaNotFound) return new Response(error.message, { status: 404 });
    throw error;
  }
  if (renderFileStamp(media).hash !== hash) {
    const kept = listReviewRenderVersions(project, path).find((v) => v.hash === hash);
    if (!kept) return new Response(`render ${hash} of ${path} is no longer kept`, { status: 410 });
    media = resolveProjectMedia(project, kept.file);
  }
  return respond(await reviewStills.cut(media, hash, frame, fps));
});
