// project-queries.ts: the project pulse, the one query the app polls, and the summaries keyed on it. Polled, not
// pushed: the CLI writes without the server, and a poll survives server restarts and a sleeping tab for a few stats.
// Every other query is fetched once per key and keyed on its part of the pulse, so what moved is what's fetched.
import { keepPreviousData, queryOptions, useQuery, useSuspenseQuery, type QueryClient } from '@tanstack/react-query';
import { useDeferredValue } from 'react';
import { projectPulseBeatOf } from '#lib/output/review/models/project-pulse.ts';
import { fetchProjectPulse, fetchStudioPulseBeat, type ProjectPulse } from './project-pulse.ts';
import { fetchReviewProjectSummaries, fetchReviewProjectSummary } from './project-summaries.ts';

const PROJECT_PULSE_POLL_MS = 1000;

/** Every screen of a project shares this one poll. */
export const projectPulseQueryOptions = (project: string) => queryOptions({
  queryKey: ['project-pulse', project],
  queryFn: () => fetchProjectPulse({ data: { project } }),
  refetchInterval: PROJECT_PULSE_POLL_MS,
  refetchOnWindowFocus: true,
});

/** The dashboard's and quick-open's pulse: one hash over every project's. */
const studioPulseQueryOptions = queryOptions({
  queryKey: ['studio-pulse'],
  queryFn: () => fetchStudioPulseBeat(),
  refetchInterval: PROJECT_PULSE_POLL_MS,
  refetchOnWindowFocus: true,
});

/** The project's pulse, which the route's loader has fetched. */
export function useProjectPulse(project: string): ProjectPulse {
  return useSuspenseQuery(projectPulseQueryOptions(project)).data;
}

const projectSummariesQueryOptions = (studioBeat: string) => queryOptions({
  queryKey: ['review-project-summaries', studioBeat],
  queryFn: () => fetchReviewProjectSummaries(),
  staleTime: Infinity,
});

const projectSummaryQueryOptions = (project: string, beat: string) => queryOptions({
  queryKey: ['review-project-summary', project, beat],
  queryFn: () => fetchReviewProjectSummary({ data: { project } }),
  staleTime: Infinity,
});

/** A loader's: the project's pulse, then its summary as of it. */
export async function loadProjectSummary(client: QueryClient, project: string) {
  const pulse = await client.ensureQueryData(projectPulseQueryOptions(project));
  return client.ensureQueryData(projectSummaryQueryOptions(project, projectPulseBeatOf(pulse)));
}

/** A loader's: the studio's pulse, then every project's summary as of it. */
export async function loadProjectSummaries(client: QueryClient) {
  return client.ensureQueryData(projectSummariesQueryOptions(await client.ensureQueryData(studioPulseQueryOptions)));
}

/**
 * The project's summary as of its pulse, and the pulse's time, which row ages count from. The beat is deferred, so a
 * new summary loads behind the one shown instead of suspending the page.
 */
export function useProjectSummary(project: string) {
  const pulse = useSuspenseQuery(projectPulseQueryOptions(project));
  const beat = useDeferredValue(projectPulseBeatOf(pulse.data));
  return { summary: useSuspenseQuery(projectSummaryQueryOptions(project, beat)).data, now: pulse.dataUpdatedAt };
}

/** Every project's summary as of the studio's pulse, deferred as useProjectSummary's is. */
export function useProjectSummaries() {
  const pulse = useSuspenseQuery(studioPulseQueryOptions);
  const beat = useDeferredValue(pulse.data);
  return { summaries: useSuspenseQuery(projectSummariesQueryOptions(beat)).data, now: pulse.dataUpdatedAt };
}

/** The summaries for what mustn't suspend (quick-open, on every page): undefined until the first answer. */
export function useProjectSummariesIfLoaded() {
  const beat = useQuery(studioPulseQueryOptions).data;
  return useQuery({ ...projectSummariesQueryOptions(beat ?? ''), enabled: beat !== undefined, placeholderData: keepPreviousData }).data;
}
