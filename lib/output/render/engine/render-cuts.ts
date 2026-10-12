// render-cuts.ts: the videos a project keeps directly in out/ and out/wip/, its cuts (full-length renders) among them,
// and the verdict on laying a slice into the newest cut. Review places notes on the newest cut by default and lists
// these videos as its artifacts; `studio render` and `studio review reply` print the verdict so an agent knows whether
// the page will show its slice in the cut or alone. Node only.
//
// Negative space: deeper folders aren't looked at. out/wip/slices/ holds slices, never cuts by their frames anyway;
// out/wip/remote, out/reel, out/check and out/storyboard hold pieces, passes and review sheets of a cut.
import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { renderSnapshotIsCut, type RenderSnapshot } from '../models/render-snapshot-model.ts';
import { renderSpliceVerdictOf } from '../models/render-splice.ts';
import { listRenderVersions } from './render-archive.ts';
import { loadRenderSnapshot, renderFileStamp } from './render-snapshot.ts';

const PROJECT_VIDEO_FOLDERS = ['out', 'out/wip'] as const;
const PROJECT_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov']);

/** The videos directly in the project's out/ and out/wip/: `path` in the project, `file` absolute. */
export function listProjectOutVideos(projectDir: string): { path: string; file: string }[] {
  return PROJECT_VIDEO_FOLDERS.flatMap((folder) => {
    const dir = join(projectDir, ...folder.split('/'));
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isFile() && PROJECT_VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase()) ? [{ path: `${folder}/${entry.name}`, file: join(dir, entry.name) }] : []);
  });
}

/** A full-length render on disk: `path` in the project, `file` absolute, the hash of its bytes and its snapshot. */
export type ProjectCut = { path: string; file: string; hash: string; snapshot: RenderSnapshot };

const newestCutFirst = (a: ProjectCut, b: ProjectCut) =>
  b.snapshot.started.localeCompare(a.snapshot.started) || Number(b.snapshot.captions) - Number(a.snapshot.captions) || a.path.localeCompare(b.path);

/**
 * The cut that started last, or null when the project has none with a snapshot. Of two from one render (video.mp4 and
 * video-plain.mp4 under --plain), the captioned one: it's the one delivered, and slices are rendered to match it.
 */
export function newestProjectCut(projectDir: string): ProjectCut | null {
  const cuts = listProjectOutVideos(projectDir).flatMap(({ path, file }) => {
    const loaded = loadRenderSnapshot(file);
    if (loaded.kind !== 'snapshot' || !renderSnapshotIsCut(loaded.snapshot)) return [];
    return [{ path, file, hash: renderFileStamp(file).hash, snapshot: loaded.snapshot }];
  });
  return cuts.toSorted(newestCutFirst)[0] ?? null;
}

/** `out/video.mp4 r14`: a render by its path and its number among the path's kept versions (its hash when not kept). */
export function formatRenderVersionName(projectDir: string, render: { path: string; hash: string }): string {
  const r = listRenderVersions(projectDir, render.path).find((v) => v.hash === render.hash)?.r;
  return `${render.path} ${r ? `r${r}` : render.hash}`;
}

/**
 * Whether the review page will lay `slice` (a render's snapshot) into the project's newest cut, as one line: where it
 * splices, or why it won't and what to do. Null for a render that is itself a cut.
 */
export function formatRenderSpliceVerdict(projectDir: string, slice: RenderSnapshot): string | null {
  if (renderSnapshotIsCut(slice)) return null;
  const cut = newestProjectCut(projectDir);
  const alone = 'reply with it and it plays alone; render the whole video to see it in the cut';
  if (!cut) return `won't splice: there's no full render to lay it into (studio render, or --animatic) — ${alone}`;
  const name = formatRenderVersionName(projectDir, cut), verdict = renderSpliceVerdictOf(cut.snapshot, slice);
  if (verdict.kind === 'cut') return null;
  if (verdict.kind === 'retired') return `won't splice: it started before ${name} did, so the cut is newer — ${alone}`;
  if (verdict.kind === 'refused') return `won't splice: ${verdict.refusal} (${name}) — ${alone}`;
  return `splices into ${name} at f${slice.frames.from}–f${slice.frames.end - 1}${verdict.pictureOnly ? ', picture only: its sound effects differ from the cut\'s' : ''}`;
}
