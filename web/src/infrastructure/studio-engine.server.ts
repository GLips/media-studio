// studio-engine.server.ts: the app's one door into the studio's engine code. Controllers and server routes reach the studio's Node
// machinery through what this module re-exports, so the lint and the bundler each hold one fence: no browser module
// imports a feature's engine code (`#lib/<area>/<feature>/engine/…`), and the web tree reaches it from here alone.
import { join } from 'node:path';
import type { NodeServices } from '@effect/platform-node';
import { Layer, type Effect } from 'effect';
import { changeLibraryFlagsEffect, readLibraryFlagsEffect, readLibraryItemViewEffect, readLibraryShelfEffect, searchLibraryEffect } from '#lib/footage/library/engine/library-app.ts';
import { libraryStoreLayer, type LibraryStore } from '#lib/footage/library/engine/library-store.ts';
import type { LibraryFlagOp } from '#lib/footage/library/models/library-flags.ts';
import { libraryMediaFolderLayer, type LibraryMediaFolder } from '#lib/footage/library-media/engine/library-media-folder.ts';
import { runStudioEffect } from '#lib/platform/process/engine/studio-effect-runtime.ts';
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

export type { LibraryItemView, LibraryShelf, LibraryShelfItem } from '#lib/footage/library/engine/library-app.ts';

/** What the app's library reads and changes run on: its metadata and its media folder, never ffmpeg or whisper. */
const libraryAppLayer = Layer.mergeAll(libraryStoreLayer, libraryMediaFolderLayer);

/** The server's Board and thumbnail stills, cut on demand and kept for its life: removed with its process's temp root. */
export const reviewStills = createReviewStillCutter(join(studioTempRoot(), 'review-stills'));

const runLibraryApp = <A, E>(program: Effect.Effect<A, E, LibraryStore | LibraryMediaFolder | NodeServices.NodeServices>) =>
  runStudioEffect(program, libraryAppLayer);

/** The library's items, newest first, and where its media is. */
export const readLibraryShelf = () => runLibraryApp(readLibraryShelfEffect());
export const searchStudioLibrary = (query: string) => runLibraryApp(searchLibraryEffect(query));
/** An item with its transcript, or null when no item has the id. */
export const readLibraryItemView = (id: string) => runLibraryApp(readLibraryItemViewEffect(id));
export const readLibraryFlags = (id: string) => runLibraryApp(readLibraryFlagsEffect(id));
/** The reviewer's change to an item's flags; the flags after it. */
export const changeLibraryFlags = (id: string, op: LibraryFlagOp) => runLibraryApp(changeLibraryFlagsEffect(id, op, 'reviewer'));
