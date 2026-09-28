import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import { listProjectsWithArtifacts, listStudioProjects } from '#web/infrastructure/studio-engine.server.ts';

/** Every project under work/projects/ with what it has made, the most recently active first. */
export const fetchProjectListings = createServerFn({ method: 'GET' }).handler(() => listProjectsWithArtifacts(listStudioProjects()));

/** One project's listing: the files a project's landing chooses between. Throws for a folder that isn't a project. */
export const fetchProjectListing = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ project: Schema.String })))
  .handler(({ data }) => listProjectsWithArtifacts([data.project])[0]);
