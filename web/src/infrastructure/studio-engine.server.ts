// studio-engine.server.ts: the app's one door into lib/engine. Controllers and server routes reach the studio's Node
// machinery through what this module re-exports, so the lint and the bundler each hold one fence: no browser module
// imports `#engine/*`, and the web tree reaches it from here alone.
import { join } from 'node:path';
import { createReviewStillCutter } from '#engine/review/review-stills.ts';
import { studioTempRoot } from '#engine/temp/studio-temp.ts';

export { listStudioProjects, STUDIO_ROOT } from '#engine/project/studio-project.ts';
export { renderFileStamp } from '#engine/snapshot/render-snapshot.ts';
export { listProjectsWithArtifacts } from '#engine/review/project-artifacts.ts';
export { projectMediaTypeOf, ProjectMediaNotFound, resolveProjectMedia } from '#engine/review/project-media.ts';
export { readReviewArtifact, readReviewArtifactStatus, saveReviewNotes } from '#engine/review/review-artifact.ts';

/** The server's storyboard stills, cut on demand and kept for its life: removed with its process's temp root. */
export const reviewStills = createReviewStillCutter(join(studioTempRoot(), 'review-stills'));
