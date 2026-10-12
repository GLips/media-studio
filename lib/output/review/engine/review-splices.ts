// review-splices.ts: the slices the review page lays into the cut it shows. A slice reaches the page only as the render
// a reply names (`studio review reply --render`); there's no registry of slices, and nothing scans out/wip/slices/.
//
// Which slices count, and whether each fits, is render-splice.ts's one verdict: a slice that started no later than the
// cut is retired by it, with no expiry state; one that won't splice is listed with why, for its thread to play it
// alone. Where fitting slices overlap, the newest wins each frame and an older one shows only outside it.
//
// Negative space: only the file at the cut's path as it is now gets slices. An older version (`r=`) shows as rendered.
import { listRenderArchive } from '#lib/output/render/engine/render-archive.ts';
import { loadRenderSnapshot, renderFileStamp } from '#lib/output/render/engine/render-snapshot.ts';
import { renderSnapshotIsCut } from '#lib/output/render/models/render-snapshot-model.ts';
import { renderSpliceVerdictOf } from '#lib/output/render/models/render-splice.ts';
import { layReviewSlices, type ReviewRefusedSlice, type ReviewSplices } from '../models/review-placement.ts';
import { projectFolderNamed, resolveProjectMedia } from './project-media.ts';
import { readReviewFile } from './review-file.ts';

/** The reply slices of `project` (a folder name under work/projects/) on the cut at `cut.path`, while it's `cut.hash`. */
export function readReviewSplices(project: string, cut: { path: string; hash: string }): ReviewSplices {
  const dir = projectFolderNamed(project), file = resolveProjectMedia(project, cut.path);
  if (renderFileStamp(file).hash !== cut.hash) return { laid: [], refused: [] };
  const loaded = loadRenderSnapshot(file);
  if (loaded.kind !== 'snapshot' || !renderSnapshotIsCut(loaded.snapshot)) return { laid: [], refused: [] };
  const cutSnapshot = loaded.snapshot, archive = new Map(listRenderArchive(dir).map((entry) => [entry.hash, entry]));

  // The last reply to name a slice is the thread it shows on.
  const replied = new Map<string, { thread: number; path: string }>();
  for (const thread of readReviewFile(dir).threads) {
    for (const { render } of thread.entries) if (render) replied.set(render.hash, { thread: thread.id, path: render.path });
  }
  const fitting: Parameters<typeof layReviewSlices>[0][number][] = [], refused: ReviewRefusedSlice[] = [];
  for (const [hash, { thread, path }] of replied) {
    const snapshot = archive.get(hash)?.snapshot;
    if (!snapshot) continue;
    const verdict = renderSpliceVerdictOf(cutSnapshot, snapshot);
    if (verdict.kind === 'refused') refused.push({ thread, path, hash, refusal: verdict.refusal });
    if (verdict.kind === 'laid') fitting.push({ thread, path, hash, ...snapshot.frames, pictureOnly: verdict.pictureOnly, started: snapshot.started });
  }
  return { laid: layReviewSlices(fitting), refused };
}
