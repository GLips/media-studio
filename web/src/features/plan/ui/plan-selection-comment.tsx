import { Button } from '@mantine/core';
import * as stylex from '@stylexjs/stylex';
import { MessageSquarePlus } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { shadows } from '#web/shared/ui/shadows.ts';
import { colors, radius } from '#web/shared/ui/theme.stylex.ts';
import { planNoteAnchorOf, planSelectionIn, type PlanTarget } from './plan-notes.ts';
import { usePlanScreen } from './plan-screen-context.tsx';

const styles = stylex.create({
  button: {
    // Over the brief's drawer too.
    position: 'fixed', zIndex: 1000, color: colors.cream, backgroundColor: colors.cobalt, borderRadius: radius.control,
  },
  at: (left: number, top: number) => ({ left, top }),
});

type PlanSelection = { target: PlanTarget; text: string; left: number; top: number };

/** Opens a new note on `target`, quoting `text` when there is some, and puts the cursor in the composer. */
export function usePlanStartNote() {
  const { plan, draft, setTarget, playback } = usePlanScreen();
  return (target: PlanTarget, text: string | null) => {
    playback.pause();
    setTarget(target);
    draft.setAnchor(planNoteAnchorOf(target, text, plan));
    window.getSelection()?.removeAllRanges();
    // The composer mounts its field already; focus it after this render settles.
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-review-composer] textarea')?.focus());
  };
}

/**
 * The Comment button that rises over words selected anywhere on the plan (a line, a cell, the brief): a click opens a
 * note quoting them, written in the thread's composer. It follows the selection, and goes when the selection does.
 */
export function PlanSelectionComment({ root }: { readonly root: RefObject<HTMLElement | null> }) {
  const startNote = usePlanStartNote();
  const [selection, setSelection] = useState<PlanSelection | null>(null);
  useEffect(() => {
    const read = () => {
      const within = root.current ? planSelectionIn(root.current) : null;
      const range = within && window.getSelection()?.getRangeAt(0);
      if (!within || !range) {
        setSelection(null);
        return;
      }
      const box = range.getBoundingClientRect();
      setSelection({ ...within, left: box.left, top: Math.max(4, box.top - 34) });
    };
    document.addEventListener('selectionchange', read);
    window.addEventListener('scroll', read, true);
    return () => {
      document.removeEventListener('selectionchange', read);
      window.removeEventListener('scroll', read, true);
    };
  }, [root]);
  if (!selection) return null;
  return (
    <Button
      size="compact-sm" leftSection={<MessageSquarePlus size={14} />}
      // Keeps the selection: a mousedown would collapse it before the click reads it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        startNote(selection.target, selection.text);
        setSelection(null);
      }}
      {...stylex.props(styles.button, shadows.float, styles.at(selection.left, selection.top))}
    >
      Comment
    </Button>
  );
}
