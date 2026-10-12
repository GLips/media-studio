import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import { readProjectPulse, readStudioPulseBeat } from '#web/infrastructure/studio-engine.server.ts';

export type { ProjectPulse } from '#web/infrastructure/studio-engine.server.ts';

/** A project's pulse: its review's revision, its files' hashes, the script's, the agent's presence and a render under way. */
export const fetchProjectPulse = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ project: Schema.String })))
  .handler(({ data }) => readProjectPulse(data.project));

/** One hash over every project's pulse, which moves when any project's summary would. */
export const fetchStudioPulseBeat = createServerFn({ method: 'GET' }).handler(() => readStudioPulseBeat());
