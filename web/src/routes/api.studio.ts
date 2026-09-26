import { createFileRoute } from '@tanstack/react-router';
import { respondWithStudioCheckout } from '#web/features/projects/index.ts';

export const Route = createFileRoute('/api/studio')({
  server: { handlers: { GET: () => respondWithStudioCheckout() } },
});
