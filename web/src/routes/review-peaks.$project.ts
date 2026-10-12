import { createFileRoute } from '@tanstack/react-router';
import { respondWithReviewPeaks } from '#web/features/review/index.ts';

export const Route = createFileRoute('/review-peaks/$project')({
  server: { handlers: { GET: ({ request, params }) => respondWithReviewPeaks(request, params.project) } },
});
