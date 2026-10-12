import { createServerOnlyFn } from '@tanstack/react-start';
import { fileResponse } from '#web/infrastructure/media-response.server.ts';
import { ProjectMediaNotFound, reviewPeaksFileOf } from '#web/infrastructure/studio-engine.server.ts';

/**
 * A render's waveform peaks: `?path=<render>[&render=<hash>]`, cut once per hash; unpinned, as the file is now. A replaced render's peaks come from
 * its archived copy, as its stills do, so a pinned version (`?r=`) keeps its sound lane; a 410 once no copy is kept.
 */
export const respondWithReviewPeaks = createServerOnlyFn(async (request: Request, project: string): Promise<Response> => {
  const query = new URL(request.url).searchParams;
  try {
    return fileResponse(request, await reviewPeaksFileOf(project, query.get('path') ?? '', query.get('render') ?? undefined), 'application/json');
  } catch (error) {
    if (error instanceof ProjectMediaNotFound) return new Response(error.message, { status: 410 });
    throw error;
  }
});
