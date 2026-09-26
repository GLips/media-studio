import { createFileRoute } from '@tanstack/react-router';
import { respondWithProjectMedia } from '#web/features/projects/index.ts';

export const Route = createFileRoute('/media/$project')({
  server: { handlers: { GET: ({ request, params }) => respondWithProjectMedia(request, params.project) } },
});
