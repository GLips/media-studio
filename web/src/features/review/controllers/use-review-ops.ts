import { useMutation, useMutationState, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { ReviewArtifact } from '#lib/output/review/models/review-artifact.ts';
import { applyReviewOpsToFile, ReviewOpRefused, type ReviewOp } from '#lib/output/review/models/review-ops.ts';
import { placeReviewThread, type PlacedReviewThread, type ReviewPlacementTarget } from '#lib/output/review/models/review-placement.ts';
import { REVIEW_FILE_VERSION, type ReviewFile } from '#lib/output/review/models/review-threads.ts';
import { applyReviewOpsFn, type readReviewThreadsFn } from './review-ops.ts';
import { reviewStatusQueryKey, reviewThreadsQueryPrefix } from './review-queries.ts';
import type { DecodedReviewOp } from './review-op-schema.ts';

/** The threads as readReviewThreadsFn answers them, which the threads query caches. */
type PlacedReviewThreadsResponse = Awaited<ReturnType<typeof readReviewThreadsFn>>;
/** What the server answered a batch: the revision it made, or the note a stale edit conflicts with. */
export type ReviewOpsAnswer = Awaited<ReturnType<typeof applyReviewOpsFn>>;

/**
 * `file` with `ops` applied as the reviewer, as the server will: the same pure rules, so a screen can move at once.
 * Undefined when the rules refuse here (the screen's copy is behind), leaving the server to decide.
 */
export function applyReviewOpsAsReviewer(file: ReviewFile, ops: readonly ReviewOp[]): ReviewFile | undefined {
  try {
    const applied = applyReviewOpsToFile(file, ops, { author: 'reviewer', now: new Date().toISOString(), writtenOnOf: (render) => render });
    return 'conflict' in applied ? undefined : applied.file;
  } catch (error) {
    if (error instanceof ReviewOpRefused) return undefined;
    throw error;
  }
}

/** `data` with `ops` applied. Threads keep their placement; a new one is placed on the open file. */
function applyReviewOpsLocally(data: PlacedReviewThreadsResponse, ops: readonly ReviewOp[], target: ReviewPlacementTarget): PlacedReviewThreadsResponse | undefined {
  const ids = [...data.threads.map((t) => t.id), ...data.decisions.map((d) => d.id)];
  const applied = applyReviewOpsAsReviewer({
    version: REVIEW_FILE_VERSION, revision: data.revision, nextId: Math.max(0, ...ids) + 1,
    threads: data.threads.map(({ id, kind, state, rev, anchor, entries }) => ({ id, kind, state, rev, anchor, entries })), decisions: data.decisions, signoffs: data.signoffs,
  }, ops);
  if (!applied) return undefined;
  const placedBefore = new Map(data.threads.map((t) => [t.id, t.placement]));
  const threads = applied.threads.flatMap((thread): PlacedReviewThread[] => {
    const placement = placedBefore.get(thread.id) ?? placeReviewThread(thread, target);
    return placement ? [{ ...thread, placement }] : [];
  });
  return { ...data, revision: applied.revision, threads, decisions: applied.decisions, signoffs: applied.signoffs };
}

/** Where a batch shows before the server answers, and what's fetched again once it has. */
export type ReviewOpsTarget = {
  project: string;
  /** Puts the batch into the screen's cached copy, so it moves at once. */
  showLocally: (client: QueryClient, ops: readonly ReviewOp[]) => void;
  /** The queries in which the server's answer replaces the guess. */
  refetch: readonly QueryKey[];
};

/** The ops target of a reviewed file (a render, a still, the script's take): its threads and its status. */
export function reviewFileOpsTarget(artifact: Pick<ReviewArtifact, 'project' | 'path' | 'kind' | 'render'>): ReviewOpsTarget {
  // A new note is written on these bytes, so it places at its own frame without the render's timing.
  const target: ReviewPlacementTarget = { kind: artifact.kind, hash: artifact.render.hash, path: artifact.path, durationInFrames: Infinity };
  return {
    project: artifact.project,
    showLocally: (client, ops) => client.setQueriesData<PlacedReviewThreadsResponse>({ queryKey: reviewThreadsQueryPrefix(artifact.project, artifact.path) }, (data) =>
      data && (applyReviewOpsLocally(data, ops, target) ?? data)),
    refetch: [reviewThreadsQueryPrefix(artifact.project, artifact.path), reviewStatusQueryKey(artifact.project, artifact.path)],
  };
}

/** Every batch of a project's review ops, whichever screen sent it: one `failed` and one `retry` for all of them. */
export const reviewOpsMutationKey = (project: string) => ['review-ops', project] as const;

/**
 * Sends the reviewer's ops, showing them at once. Batches share a mutation scope, so they reach the server in order;
 * once one settles, the server's answer replaces the guess. A failed batch stays in the mutation cache for `retry`,
 * so every caller (header, thread panel) sees `failed`.
 */
export function useReviewOps(target: ReviewOpsTarget) {
  const client = useQueryClient();
  const mutationKey = reviewOpsMutationKey(target.project);
  const failed = useMutationState({ filters: { mutationKey, status: 'error' } }).length > 0;
  const send = useMutation({
    mutationKey,
    scope: { id: `review-ops:${target.project}` },
    mutationFn: (ops: DecodedReviewOp[]) => applyReviewOpsFn({ data: { project: target.project, ops } }),
    onMutate: (ops) => target.showLocally(client, ops),
    onSettled: () => Promise.all(target.refetch.map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
  const retry = () => {
    const cache = client.getMutationCache();
    for (const mutation of cache.findAll({ mutationKey, status: 'error' })) {
      cache.remove(mutation);
      // SAFETY: only this hook's mutation runs under this key, and its variables are a batch of decoded ops.
      send.mutate(mutation.state.variables as DecodedReviewOp[]);
    }
  };
  return {
    /** The server's answer, or undefined when the batch failed: it's kept for `retry`, and `failed` says so. */
    apply: (ops: DecodedReviewOp[]): Promise<ReviewOpsAnswer | undefined> => send.mutateAsync(ops).catch(() => undefined),
    pending: send.isPending,
    failed,
    retry,
  };
}

export type ReviewOps = ReturnType<typeof useReviewOps>;
