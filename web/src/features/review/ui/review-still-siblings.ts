import type { ProjectArtifact } from '#lib/output/review/models/review-artifact.ts';
import { projectFileUrl, reviewMediaUrl, type PinnedProjectFile } from '#web/shared/media-urls.ts';
import { useReviewScreen } from './review-screen-context.tsx';

/** A still in the open one's folder: its path, its file name, and its bytes as they are now. */
export type ReviewStillSibling = { readonly path: string; readonly name: string; readonly src: string };

const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

const reviewStillSiblingOf = (path: string, src: string): ReviewStillSibling => ({ path, name: path.slice(path.lastIndexOf('/') + 1), src });

/**
 * The stills in the open still's folder, itself included, in name order (`og-a`, `og-b`, … `og-10`): what the grid
 * shows and the arrows and filmstrip step through. A still opened from outside the listed folders is alone. Each URL
 * carries the file's modified time, so a still written again shows its new bytes.
 */
export function reviewStillSiblingsOf(artifacts: readonly ProjectArtifact[], open: PinnedProjectFile): ReviewStillSibling[] {
  const folder = folderOf(open.path);
  const listed = artifacts.filter((a) => a.kind === 'still' && folderOf(a.path) === folder);
  const entries = listed.map((a) => reviewStillSiblingOf(a.path, projectFileUrl(open.project, a.path, a.modified)));
  const all = listed.some((a) => a.path === open.path) ? entries : [...entries, reviewStillSiblingOf(open.path, reviewMediaUrl(open))];
  return all.toSorted((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

/**
 * The still a folder's URL opens (`out/stills` or `out/stills/`): the one `still` names by file name, else its first in
 * name order. Undefined when the folder holds no listed still, so the path stays the "no such file" it was.
 */
export function reviewStillsFolderOpening(artifacts: readonly ProjectArtifact[], folder: string, still?: string): string | undefined {
  const dir = folder.endsWith('/') ? folder : `${folder}/`;
  const inFolder = artifacts.filter((a) => a.kind === 'still' && folderOf(a.path) === dir).map((a) => a.path);
  const named = inFolder.find((path) => path === `${dir}${still}`);
  return named ?? inFolder.toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
}

/** The open still's folder as the status poll last listed it, so a still written since appears. */
export function useReviewStillSiblings(): ReviewStillSibling[] {
  const { artifact, status } = useReviewScreen();
  return reviewStillSiblingsOf(status?.artifacts ?? artifact.artifacts, artifact);
}
