import { useHotkeys, useHotkeySequences, type UseHotkeyDefinition } from '@tanstack/react-hotkeys';
import type { RefObject } from 'react';
import { type PlacedReviewThread, reviewThreadFrameOf } from '#lib/output/review/models/review-placement.ts';
import type { ReviewPlayback } from './review-playback-store.ts';
import type { ReviewThreadActions } from './use-review-thread-panel.ts';

/** On the thread panel's root, valued with what it lists (`video`, `decision`, …): where `G N` and the arrows look. */
export const REVIEW_THREAD_ATTRIBUTE = 'data-review-thread';

/** The row a key was pressed in, by its `data-thread-id`. */
function rowOf(event: KeyboardEvent): HTMLElement | null {
  return event.target instanceof Element ? event.target.closest<HTMLElement>('[data-thread-id]') : null;
}

function rowIdOf(event: KeyboardEvent): number | undefined {
  const row = rowOf(event);
  return row ? Number(row.dataset.threadId) : undefined;
}

/** The thread panel a key was pressed in. */
function threadOf(event: KeyboardEvent): HTMLElement | null {
  return event.target instanceof Element ? event.target.closest<HTMLElement>(`[${REVIEW_THREAD_ATTRIBUTE}]`) : null;
}

/** Moves focus to the row `by` rows from the one the key was pressed in, or to the first from the panel itself. */
function focusRowBeside(event: KeyboardEvent, by: -1 | 1) {
  const thread = threadOf(event);
  const rows = [...(thread?.querySelectorAll<HTMLElement>('[data-thread-id]') ?? [])];
  const row = rowOf(event);
  const at = row ? rows.indexOf(row) : -1;
  rows[at === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, at + by))]?.focus();
}

/**
 * Moves focus off a row that's about to leave the list (resolved, deleted) to the one after it, else the one before,
 * so the same key works on down the list.
 */
function focusRowAfter(event: KeyboardEvent) {
  const thread = threadOf(event);
  const rows = [...(thread?.querySelectorAll<HTMLElement>('[data-thread-id]') ?? [])];
  const at = rows.indexOf(rowOf(event) ?? rows[0]);
  (rows[at + 1] ?? rows[at - 1])?.focus();
}

/** Focuses the screen thread's row `id`, else its first: where `G N` lands. */
function focusThreadRow(id: number | null) {
  const thread = document.querySelector(['video', 'still', 'plan'].map((on) => `[${REVIEW_THREAD_ATTRIBUTE}="${on}"]`).join(', '));
  (thread?.querySelector<HTMLElement>(`[data-thread-id="${id}"]`) ?? thread?.querySelector<HTMLElement>('[data-thread-id]'))?.focus();
}

type ReviewThreadHotkeysOptions = {
  readonly threadRef: RefObject<HTMLElement | null>;
  /** The rows as listed, which `[` `]` step through on the playhead. */
  readonly listed: readonly PlacedReviewThread[];
  readonly actions: ReviewThreadActions;
  /** The row `G N` lands on: the note in focus, else the one under the playhead. */
  readonly currentId: number | null;
  /**
   * Whether this is its screen's one thread, which binds the screen-wide keys (resolve addressed, copy, undo, `G N`):
   * a second panel would bind them twice.
   */
  readonly screenThread: boolean;
  /** The clock `[` `]` step notes on, where they sit on frames (a render, not the plan). */
  readonly screenPlayback: ReviewPlayback | undefined;
  /** Where the cheatsheet lists `[` `]`: with a video's playback keys, or a still's own. */
  readonly noteStepGroup: 'playback' | 'still';
};

type ReviewThreadHotkeyGroup = 'notes' | 'playback' | 'still' | 'global';

const onThread = (hotkey: UseHotkeyDefinition['hotkey'], name: string, callback: (event: KeyboardEvent) => void): UseHotkeyDefinition =>
  ({ hotkey, callback, options: { meta: { group: 'notes', name } } });

const onScreen = (hotkey: UseHotkeyDefinition['hotkey'], group: ReviewThreadHotkeyGroup, name: string, callback: () => void, ignoreInputs?: boolean): UseHotkeyDefinition =>
  ({ hotkey, callback, options: { meta: { group, name }, ...(ignoreInputs !== undefined && { ignoreInputs }) } });

/**
 * The thread's keys. Its row keys are bound to the thread itself, so they act on the row the key was pressed in (or
 * the selection) and hide the playhead's `Enter` while focus is in the thread; the rest are the screen's.
 */
export function useReviewThreadHotkeys({ threadRef, listed, actions, currentId, screenThread, screenPlayback, noteStepGroup }: ReviewThreadHotkeysOptions) {
  /** The selection when there is one, else the row the key was pressed in. */
  const targets = (event: KeyboardEvent) => (actions.selected.size ? [...actions.selected] : [rowIdOf(event)].filter((id) => id !== undefined));
  const stepNote = (playback: ReviewPlayback, direction: -1 | 1) => () => {
    const frame = playback.frameNow();
    const placed = listed.filter((t) => reviewThreadFrameOf(t) !== undefined);
    const next = direction > 0 ? placed.find((t) => (reviewThreadFrameOf(t) ?? 0) > frame) : placed.findLast((t) => (reviewThreadFrameOf(t) ?? 0) < frame);
    if (next) actions.open(next);
  };

  useHotkeys([
    onThread('ArrowUp', 'Up the thread', (event) => focusRowBeside(event, -1)),
    onThread('ArrowDown', 'Down the thread', (event) => focusRowBeside(event, 1)),
    onThread('Enter', 'Open note', (event) => {
      const thread = listed.find((t) => t.id === rowIdOf(event));
      if (thread) actions.open(thread);
    }),
    onThread('R', 'Reply', (event) => {
      const id = rowIdOf(event);
      if (id !== undefined) actions.startInline(id, 'reply');
    }),
    onThread('E', 'Resolve', (event) => {
      actions.resolve(targets(event));
      if (!actions.selected.size) focusRowAfter(event);
    }),
    onThread('U', 'Reopen', (event) => actions.reopen(targets(event))),
    onThread('X', 'Select', (event) => {
      const id = rowIdOf(event);
      if (id !== undefined) actions.toggleSelected(id);
    }),
    onThread('Backspace', 'Delete', (event) => {
      if (!actions.selected.size) focusRowAfter(event);
      actions.remove(targets(event));
    }),
    onThread('F', 'Filter', (event) => {
      // The row may leave the list under the new filter: focus waits on the thread itself, then goes back to the row
      // if it stayed, so F keeps cycling and the arrows keep stepping.
      const thread = threadOf(event), id = rowIdOf(event);
      thread?.focus();
      actions.cycleFilter();
      setTimeout(() => thread?.querySelector<HTMLElement>(`[data-thread-id="${id}"]`)?.focus());
    }),
    // From a row or the thread itself with nothing selected, Escape leaves the thread, letting go of the note in focus
    // and handing the keys back to the stage. From the composer, Escape is the composer's.
    onThread('Escape', actions.selected.size ? 'Clear selection' : 'Leave thread', (event) => {
      if (actions.selected.size) actions.clearSelected();
      else if (event.target instanceof HTMLElement && (rowOf(event) || event.target === threadOf(event))) {
        event.target.blur();
        actions.close();
      }
    }),
  ], { target: threadRef });
  useHotkeys([
    ...(screenThread ? [
      // From anywhere, so thirty addressed notes resolve in one key without first finding the thread.
      onScreen('Shift+E', 'notes', 'Resolve all addressed', () => actions.resolveAddressed()),
      onScreen('Mod+Shift+C', 'global', 'Copy notes', () => void actions.copy?.()),
      // Inside a field, Mod+Z is the field's own undo.
      onScreen('Mod+Z', 'global', 'Undo', actions.undo, true),
      onScreen('Mod+Shift+Z', 'global', 'Redo', actions.redo, true),
    ] : []),
    ...(screenThread && screenPlayback ? [
      onScreen({ key: '[' }, noteStepGroup, 'Previous note', stepNote(screenPlayback, -1)),
      onScreen({ key: ']' }, noteStepGroup, 'Next note', stepNote(screenPlayback, 1)),
    ] : []),
  ]);
  useHotkeySequences(screenThread
    ? [{ sequence: ['G', 'N'], callback: () => focusThreadRow(currentId), options: { meta: { group: 'global', name: 'Go to thread' } } }]
    : []);
}
