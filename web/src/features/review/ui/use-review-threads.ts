// use-review-threads.ts: the project's review as the screen shows it, placed here from the raw review file. The server
// places nothing: the file, the slices laid into the cut and the open render's timing are all the page needs, and an
// optimistic op lands in the same file every screen places from.
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { projectPulseHashOf } from '#lib/output/review/models/project-pulse.ts';
import { placeReviewThread, type PlacedReviewThread, type ReviewPlacementTarget, type ReviewSplices } from '#lib/output/review/models/review-placement.ts';
import type { ReviewDecision, ReviewFile, ReviewSignoff } from '#lib/output/review/models/review-threads.ts';
import { reviewFileQueryOptions, reviewSplicesQueryOptions } from '../controllers/review-queries.ts';
import { useReviewFileRevision } from '../controllers/use-review-ops.ts';
import { useReviewScreen, type ReviewScreenValue } from './review-screen-context.tsx';

/** The project's review placed on a file: its threads about it, and the project's decisions and sign-offs. */
export type ReviewPlacedThreads = { revision: number; threads: PlacedReviewThread[]; decisions: ReviewDecision[]; signoffs: ReviewSignoff[] };

const NO_REVIEW_SPLICES: ReviewSplices = { laid: [], refused: [] };

/** The project's review file as of the pulse's revision; the last revision's while a new one loads. */
export function useReviewFile(): ReviewFile | undefined {
  const { project, pulse } = useReviewScreen();
  return useQuery(reviewFileQueryOptions(project, useReviewFileRevision(project, pulse.revision))).data;
}

/**
 * The reply slices for the open render, laid in or refused, as of the pulse's revision. Only a video gets any, and
 * only as the file at its path is now: an older version (`r`) shows as it was rendered.
 */
export function useReviewSplices(): ReviewSplices {
  const { project, artifact, pulse } = useReviewScreen();
  const cut = { path: artifact.path, hash: artifact.render.hash };
  const current = artifact.kind === 'video' && projectPulseHashOf(pulse, cut.path) === cut.hash;
  return useQuery({ ...reviewSplicesQueryOptions(project, cut, pulse.revision), enabled: current }).data ?? NO_REVIEW_SPLICES;
}

/** What threads are placed on for `path`: the open render with its timing and the slices laid into it, or a still beside it. */
function reviewPlacementTargetOf(
  { artifact, files }: Pick<ReviewScreenValue, 'artifact'> & { files: ReviewScreenValue['pulse']['files'] },
  path: string, { laid }: ReviewSplices,
): ReviewPlacementTarget {
  if (path !== artifact.path) {
    const file = files.find((f) => f.path === path);
    return { kind: file?.kind ?? 'still', hash: file?.hash ?? '', path, durationInFrames: Infinity };
  }
  const { kind, render: { hash } } = artifact;
  // Without a snapshot there's no timing: only notes written on these very bytes place, and the length isn't consulted.
  if (!artifact.timing) return { kind, hash, path, durationInFrames: Infinity };
  return { kind, hash, path, timing: artifact.timing, durationInFrames: artifact.durationInFrames ?? Infinity, ...(laid.length > 0 && { splices: laid }) };
}

/**
 * The review placed on `path`: the open file by default, or a still beside it (the grid's and the filmstrip's dots).
 * Undefined until the first file loads.
 */
export function useReviewThreads(path?: string): ReviewPlacedThreads | undefined {
  const { artifact, pulse: { files } } = useReviewScreen();
  const file = useReviewFile(), splices = useReviewSplices();
  const on = path ?? artifact.path;
  // Each input keeps its identity until it changes (query data is structurally shared), so a poll that moved nothing
  // places nothing again.
  const target = useMemo(() => reviewPlacementTargetOf({ artifact, files }, on, splices), [artifact, files, on, splices]);
  return useMemo(() => file && placeReviewFileOn(file, target), [file, target]);
}

/** `file` placed on `target`; threads about something else (another still, the plan) are left out. */
function placeReviewFileOn(file: ReviewFile, target: ReviewPlacementTarget): ReviewPlacedThreads {
  const threads = file.threads.flatMap((thread) => {
    const placement = placeReviewThread(thread, target);
    return placement ? [{ ...thread, placement }] : [];
  });
  return { revision: file.revision, threads, decisions: file.decisions, signoffs: file.signoffs };
}
