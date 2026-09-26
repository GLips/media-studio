import { createFileRoute } from '@tanstack/react-router';
import { respondWithLabCatalog } from '#web/features/lab/index.ts';

export const Route = createFileRoute('/lab-catalog.json')({
  server: { handlers: { GET: () => respondWithLabCatalog() } },
});
