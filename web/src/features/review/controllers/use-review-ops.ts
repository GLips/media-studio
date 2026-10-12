import { useIsMutating, useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { applyReviewOpsToFile, ReviewOpRefused, type ReviewOp } from '#lib/output/review/models/review-ops.ts';
import type { ReviewFile } from '#lib/output/review/models/review-threads.ts';
import { projectPulseQueryOptions } from '#web/features/projects/index.ts';
import { applyReviewOpsFn } from './review-ops.ts';
import { reviewFileQueryPrefix } from './review-queries.ts';
import type { DecodedReviewOp } from './review-op-schema.ts';

/** What the server answered a batch: the revision it made, or the note a stale edit conflicts with. */
export type ReviewOpsAnswer = Awaited<ReturnType<typeof applyReviewOpsFn>>;

/**
 * `file` with `ops` applied as the reviewer, as the server will: the same pure rules on the same file, so a screen can
 * move at once. Undefined when the rules refuse here (the screen's copy is behind), leaving the server to decide.
 */
function applyReviewOpsAsReviewer(file: ReviewFile, ops: readonly ReviewOp[]): ReviewFile | undefined {
  try {
    const applied = applyReviewOpsToFile(file, ops, { author: 'reviewer', now: new Date().toISOString(), writtenOnOf: (render) => render });
    return 'conflict' in applied ? undefined : applied.file;
  } catch (error) {
    if (error instanceof ReviewOpRefused) return undefined;
    throw error;
  }
}

/** Every batch of a project's review ops, whichever screen sent it: one `failed` and one `retry` for all of them. */
const reviewOpsMutationKey = (project: string) => ['review-ops', project] as const;

/**
 * Sends the reviewer's ops, showing them at once in every cached copy of the project's review file, which every screen
 * places from. Batches share a scope, so they reach the server in order; once one settles, the server's file replaces
 * the guess. A failed batch stays cached for `retry`, so every caller sees `failed`.
 */
export function useReviewOps(project: string) {
  const client = useQueryClient();
  const mutationKey = reviewOpsMutationKey(project);
  const failed = useMutationState({ filters: { mutationKey, status: 'error' } }).length > 0;
  const send = useMutation({
    mutationKey,
    scope: { id: `review-ops:${project}` },
    mutationFn: (ops: DecodedReviewOp[]) => applyReviewOpsFn({ data: { project, ops } }),
    // A read already under way would land without the batch and overwrite the guess.
    onMutate: async (ops) => {
      await client.cancelQueries({ queryKey: reviewFileQueryPrefix(project) });
      client.setQueriesData<ReviewFile>({ queryKey: reviewFileQueryPrefix(project) }, (file) => file && (applyReviewOpsAsReviewer(file, ops) ?? file));
    },
    // The file too, not only the pulse: a refused batch moves no revision, and its guess has to go.
    onSettled: () => Promise.all([reviewFileQueryPrefix(project), projectPulseQueryOptions(project).queryKey].map((queryKey) => client.invalidateQueries({ queryKey }))),
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

/**
 * The review revision to read the file at: the pulse's, held while a batch of the reviewer's ops is in flight. A newer
 * revision (an agent's reply) read meanwhile lacks the batch, and its note would blink out until the batch lands.
 */
export function useReviewFileRevision(project: string, revision: number): number {
  const sending = useIsMutating({ mutationKey: reviewOpsMutationKey(project) }) > 0;
  const [held, setHeld] = useState(revision);
  if (!sending && held !== revision) setHeld(revision);
  return sending ? held : revision;
}
