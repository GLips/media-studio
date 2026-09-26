import { createServerOnlyFn } from '@tanstack/react-start';
import { fileResponse } from '#web/infrastructure/media-response.server.ts';
import { projectMediaTypeOf, ProjectMediaNotFound, renderFileStamp, resolveProjectMedia, STUDIO_ROOT } from '#web/infrastructure/studio-engine.server.ts';

/**
 * A project's media file, `?path=<path in the project>`: in the query, since Vite's dev server keeps a URL ending in a
 * media extension for itself. With `?render=<hash>` it serves those bytes or nothing: once the file is replaced a
 * review's buffered frames stay the old render's, never a splice of two. The review and the lab both play from here.
 */
export const respondWithProjectMedia = createServerOnlyFn((request: Request, project: string): Response => {
  const query = new URL(request.url).searchParams;
  let file: string;
  try {
    file = resolveProjectMedia(project, query.get('path') ?? '');
  } catch (error) {
    if (error instanceof ProjectMediaNotFound) return new Response(error.message, { status: 404 });
    throw error;
  }
  const pinned = query.get('render');
  if (pinned && renderFileStamp(file).hash !== pinned) return new Response('replaced on disk since the page loaded it', { status: 410 });
  return fileResponse(request, file, projectMediaTypeOf(file).type);
});

/**
 * Which checkout this server is: `studio review` and `studio lab` open a server already on their port only when it
 * answers with their own repo root, so a second worktree never talks to the first one's files.
 */
export const respondWithStudioCheckout = createServerOnlyFn((): Response => Response.json({ app: 'studio', root: STUDIO_ROOT }));
