// studio-engine.server.ts: the app's one door into the studio's engine code. Controllers and server routes reach the studio's Node
// machinery through what this module re-exports, so the lint and the bundler each hold one fence: no browser module
// imports a feature's engine code (`#lib/<area>/<feature>/engine/…`), and the web tree reaches it from here alone.
import { join } from 'node:path';
import { createReviewStillCutter } from '#lib/output/review/engine/review-stills.ts';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';

export { listStudioProjects, STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
export { renderFileStamp } from '#lib/output/render/engine/render-snapshot.ts';
export { listProjectsWithArtifacts } from '#lib/output/review/engine/project-artifacts.ts';
export { projectMediaTypeOf, ProjectMediaNotFound, resolveProjectMedia } from '#lib/output/review/engine/project-media.ts';
export { readReviewArtifact, readReviewArtifactStatus, saveReviewNotes } from '#lib/output/review/engine/review-artifact.ts';

/** The server's storyboard stills, cut on demand and kept for its life: removed with its process's temp root. */
export const reviewStills = createReviewStillCutter(join(studioTempRoot(), 'review-stills'));
