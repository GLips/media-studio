import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import { summarizeReviewProjects } from '#web/infrastructure/studio-engine.server.ts';

/** Every project under work/projects/ with its files, decisions, script and what waits on whom, the most recently active first. */
export const fetchReviewProjectSummaries = createServerFn({ method: 'GET' }).handler(() => summarizeReviewProjects());

/** One project's summary. Throws for a folder that isn't a project. */
export const fetchReviewProjectSummary = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ project: Schema.String })))
  .handler(({ data }) => summarizeReviewProjects([data.project])[0]);
