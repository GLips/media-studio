import { useQueries } from '@tanstack/react-query';
import type { ProjectArtifact } from '#lib/output/review/models/review-artifact.ts';
import { projectFileUrl, reviewMediaUrl, type PinnedProjectFile } from '#web/shared/media-urls.ts';
import { useReviewScreen } from './review-screen-context.tsx';
import { reviewIsProofed } from './use-review-proof-ground.ts';

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

/** The open still's folder as the project pulse last listed it, so a still written since appears. */
export function useReviewStillSiblings(): ReviewStillSibling[] {
  const { artifact, pulse } = useReviewScreen();
  return reviewStillSiblingsOf(pulse.files, artifact);
}

/** A still's own pixels: its size, and whether any of them lets the ground through. */
export type ReviewStillPixels = { readonly w: number; readonly h: number; readonly clear: boolean };

/** The longest side the alpha check reads at: a clear patch still pulls its block below opaque when scaled down. */
const REVIEW_ALPHA_CHECK_EDGE = 512;

/** Decodes the still and, for a format that can hold transparency, reads whether any pixel is less than opaque. */
async function readReviewStillPixels(src: string, mayBeClear: boolean): Promise<ReviewStillPixels> {
  const image = new Image();
  image.src = src;
  await image.decode();
  const { naturalWidth: w, naturalHeight: h } = image;
  if (!mayBeClear) return { w, h, clear: false };
  const scale = Math.min(1, REVIEW_ALPHA_CHECK_EDGE / Math.max(w, h));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return { w, h, clear: false };
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return { w, h, clear: true };
  return { w, h, clear: false };
}

/**
 * Each still's pixels, read once per URL and kept: whether the ground can show through it (a PNG may well be opaque),
 * and its size, for the zoom readout. Undefined until the still has decoded.
 */
export function useReviewStillPixels(stills: readonly { readonly path: string; readonly src: string }[]): (ReviewStillPixels | undefined)[] {
  return useQueries({
    queries: stills.map(({ path, src }) => ({
      queryKey: ['review-still-pixels', src],
      queryFn: () => readReviewStillPixels(src, reviewIsProofed({ kind: 'still', path, transparent: false })),
      staleTime: Infinity,
    })),
  }).map((q) => q.data);
}
