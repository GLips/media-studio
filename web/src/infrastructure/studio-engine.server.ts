// studio-engine.server.ts: the app's one door into the studio's engine code. Controllers and server routes reach the studio's Node
// machinery through what this module re-exports, so the lint and the bundler each hold one fence: no browser module
// imports a feature's engine code (`#lib/<area>/<feature>/engine/…`), and the web tree reaches it from here alone.
import { join } from 'node:path';
import { createReviewStillCutter } from '#lib/output/review/engine/review-stills.ts';
import { studioTempRoot } from '#lib/platform/temp/engine/studio-temp.ts';

export { listStudioProjects, STUDIO_ROOT } from '#lib/platform/project/engine/studio-project.ts';
export { renderFileStamp } from '#lib/output/render/engine/render-snapshot.ts';
export { projectFolderNamed, projectMediaTypeOf, ProjectMediaNotFound, resolveProjectMedia } from '#lib/output/review/engine/project-media.ts';
export { readReviewArtifact } from '#lib/output/review/engine/review-artifact.ts';
export { applyReviewOps, readReviewFile } from '#lib/output/review/engine/review-file.ts';
export { readReviewCandidateFileStates } from '#lib/output/review/engine/review-candidate-files.ts';
export { readProjectPulse, readStudioPulseBeat, type ProjectPulse } from '#lib/output/review/engine/project-pulse.ts';
export { readReviewSplices } from '#lib/output/review/engine/review-splices.ts';
export { runInReviewCutQueue } from '#lib/output/review/engine/review-cut-queue.ts';
export { reviewPeaksFileOf } from '#lib/output/review/engine/review-peaks.ts';
export { listReviewRenderVersions, type ReviewRenderVersion } from '#lib/output/review/engine/review-history.ts';
export { summarizeReviewProjects, type ReviewProjectSummary } from '#lib/output/review/engine/review-dashboard.ts';
export { editProjectStoryboardText, type StoryboardTextEdit } from '#lib/timing/storyboard/engine/storyboard-source-edit.ts';

/** The server's Board and thumbnail stills, cut on demand and kept for its life: removed with its process's temp root. */
export const reviewStills = createReviewStillCutter(join(studioTempRoot(), 'review-stills'));
