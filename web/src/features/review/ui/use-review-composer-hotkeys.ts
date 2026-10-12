import { useHotkeys } from '@tanstack/react-hotkeys';
import { useEffect, useRef, type RefObject } from 'react';
import { focusNoteFieldAtEnd } from '#web/shared/ui/textarea.tsx';
import type { ReviewDraft } from './use-review-draft.ts';

type ReviewComposerHotkeyActions = {
  readonly save: () => void;
  readonly cycleKind: () => void;
  /** Leaves the composer, keeping the draft; an empty draft is discarded. */
  readonly leave: () => void;
};

/**
 * The composer's keys, bound to it, so they fire from inside its field and the screen's Escape never reaches a draft.
 * Tab cycles the kind from the field only; on the buttons it moves focus. A new pin (`N`, a stage click) puts the
 * cursor in the field; a draft restored on load doesn't.
 */
export function useReviewComposerHotkeys(
  composerRef: RefObject<HTMLElement | null>, fieldRef: RefObject<HTMLTextAreaElement | null>, pin: ReviewDraft['anchor'] | null,
  { save, cycleKind, leave }: ReviewComposerHotkeyActions,
) {
  const lastPin = useRef(pin);
  useEffect(() => {
    if (lastPin.current === pin) return undefined;
    lastPin.current = pin;
    if (!pin) return undefined;
    // After the key that pinned has finished: focused during it, `N` would type itself into the field.
    const timer = setTimeout(() => focusNoteFieldAtEnd(fieldRef.current));
    return () => clearTimeout(timer);
  }, [pin, fieldRef]);
  useHotkeys([
    { hotkey: 'Mod+Enter', callback: save, options: { meta: { group: 'composer', name: 'Save note' } } },
    { hotkey: 'Escape', callback: leave, options: { ignoreInputs: false, meta: { group: 'composer', name: 'Leave note' } } },
  ], { target: composerRef });
  useHotkeys([
    { hotkey: 'Tab', callback: cycleKind, options: { ignoreInputs: false, meta: { group: 'composer', name: 'Kind' } } },
  ], { target: fieldRef });
}
