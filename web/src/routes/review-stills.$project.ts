import { createFileRoute } from '@tanstack/react-router';
import { respondWithReviewStill } from '#web/features/review/index.ts';

export const Route = createFileRoute('/review-stills/$project')({
  server: { handlers: { GET: ({ request, params }) => respondWithReviewStill(request, params.project) } },
});
