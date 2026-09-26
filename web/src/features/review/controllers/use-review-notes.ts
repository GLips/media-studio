import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReviewNote } from '#models/review/review-notes.ts';
import type { ReviewArtifact } from '#models/review/review-artifact.ts';
import { submitReviewNotes } from './review-artifact.ts';

/**
 * The file's notes, saved whole on every change. The saves share a mutation scope, so they run one after another and
 * an older one can't land after a newer one and put back a note just deleted.
 */
export function useReviewNotes(artifact: ReviewArtifact) {
  const [notes, setNotes] = useState(artifact.notes);
  const save = useReviewNotesSave(artifact);
  const updateNotes = (change: (notes: ReviewNote[]) => ReviewNote[]) => {
    const next = change(notes);
    setNotes(next);
    save.mutate({ data: { project: artifact.project, path: artifact.path, notes: next, ...(artifact.kind === 'video' && { fps: artifact.fps ?? 30 }) } });
  };
  return { notes, updateNotes, saveState: reviewNotesSaveState(save, artifact.notesPath) };
}

const useReviewNotesSave = (artifact: ReviewArtifact) =>
  useMutation({ mutationFn: submitReviewNotes, scope: { id: `review-notes:${artifact.project}/${artifact.path}` } });

function reviewNotesSaveState(save: ReturnType<typeof useReviewNotesSave>, notesPath: string): string {
  if (save.isPending) return 'saving…';
  if (save.isError) return `not saved: ${save.error.message}`;
  if (save.isSuccess) return `saved to ${save.data.savedTo}`;
  return `notes in ${notesPath}`;
}
