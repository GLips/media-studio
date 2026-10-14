import { CircleHelp, Lock, Wrench, type LucideIcon } from 'lucide-react';
import type { ReviewThreadKind } from '#lib/output/review/models/review-threads.ts';

/** The kinds in the order `Tab` cycles them and the composer lists them. */
export const REVIEW_THREAD_KINDS: readonly ReviewThreadKind[] = ['fix', 'question', 'keep'];

/**
 * Each kind's icon, the same in the composer, the thread and on the frame. Shape carries the kind because colour is
 * spoken for: it says the note's state.
 */
const REVIEW_THREAD_KIND_ICONS: Readonly<Record<ReviewThreadKind, LucideIcon>> = { fix: Wrench, question: CircleHelp, keep: Lock };

/** A kind's icon in the colour around it, labelled by its word for a screen reader. */
export function ReviewThreadKindIcon({ kind, size = 12 }: { readonly kind: ReviewThreadKind; readonly size?: number }) {
  const Icon = REVIEW_THREAD_KIND_ICONS[kind];
  return <Icon size={size} aria-label={kind} role="img" />;
}
