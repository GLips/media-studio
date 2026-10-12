import { queryOptions, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { useDeferredValue } from 'react';
import { projectScriptBeatOf } from '#lib/output/review/models/project-pulse.ts';
import { projectPulseQueryOptions, type ProjectPulse } from '#web/features/projects/index.ts';
import { fetchReviewScript } from './review-script.ts';

/** Every file the script is read from: an agent editing the words or re-voicing moves one, and it's read again. */
const reviewScriptBeatOf = ({ script }: Pick<ProjectPulse, 'script'>) => projectScriptBeatOf(script);

const reviewScriptQueryOptions = (project: string, beat: string) => queryOptions({
  queryKey: ['review-script', project, beat],
  queryFn: () => fetchReviewScript({ data: { project } }),
  staleTime: Infinity,
});

/** A loader's: the project's pulse, then the script as of it. */
export async function loadReviewScript(client: QueryClient, project: string) {
  const pulse = await client.ensureQueryData(projectPulseQueryOptions(project));
  return client.ensureQueryData(reviewScriptQueryOptions(project, reviewScriptBeatOf(pulse)));
}

/**
 * The script as of the project pulse, so the sign-off dims the moment the words change. The beat is deferred, so a
 * new read loads behind the one shown instead of suspending the page.
 */
export function useReviewScript(project: string) {
  const beat = useDeferredValue(reviewScriptBeatOf(useSuspenseQuery(projectPulseQueryOptions(project)).data));
  return useSuspenseQuery(reviewScriptQueryOptions(project, beat)).data;
}
