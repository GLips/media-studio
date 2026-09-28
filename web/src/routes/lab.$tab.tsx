import { createFileRoute, notFound } from '@tanstack/react-router';
import { Schema } from 'effect';
import { isLabTabId } from '#models/lab/lab-tabs.ts';

// The tab's screen is in lab.$tab.lazy.tsx: it plays Remotion compositions, whose modules load fonts and so run only
// in the page, never in the server that lists this route.
export const Route = createFileRoute('/lab/$tab')({
  // `project` picks the Sound tab's cue list; the other tabs ignore it. An absent or unknown one opens the first.
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ project: Schema.optionalKey(Schema.String) })),
  beforeLoad: ({ params }) => {
    if (!isLabTabId(params.tab)) throw notFound();
  },
});
