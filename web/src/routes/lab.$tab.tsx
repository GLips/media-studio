import { createFileRoute, notFound } from '@tanstack/react-router';
import { isLabTabId } from '#models/lab/lab-tabs.ts';

// The tab's screen is in lab.$tab.lazy.tsx: it plays Remotion compositions, whose modules load fonts and so run only
// in the page, never in the server that lists this route.
export const Route = createFileRoute('/lab/$tab')({
  beforeLoad: ({ params }) => {
    if (!isLabTabId(params.tab)) throw notFound();
  },
});
