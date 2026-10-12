import { createServerFn } from '@tanstack/react-start';
import { Schema } from 'effect';
import { projectFolderNamed, readReviewScript } from '#web/infrastructure/studio-engine.server.ts';

const ReviewScriptRef = Schema.Struct({ project: Schema.String });

/** The project's script with its take's word times, the take, and the hash a sign-off holds. */
export const fetchReviewScript = createServerFn({ method: 'GET' })
  .validator(Schema.toStandardSchemaV1(ReviewScriptRef))
  .handler(({ data }) => readReviewScript(projectFolderNamed(data.project)));

/** The script as the read-along gets it. */
export type ReviewScriptRead = Awaited<ReturnType<typeof fetchReviewScript>>;
/** A take of it: its file in the project, stamped as a render is, and how it was read. */
export type ReviewScriptTakeRead = ReviewScriptRead['takes'][number];
