import { useHotkeys } from '@tanstack/react-hotkeys';
import type { RefObject } from 'react';
import { studioSpatialStepOf, type StudioStepDirection } from '#web/shared/studio-spatial-step.ts';
import { LIBRARY_SHELF_ROW_ATTRIBUTE } from './library-shelf-row.tsx';

/**
 * Focuses the row or tile an arrow leads to from the focused one, as they sit on screen (studioSpatialStepOf), or the
 * first when none is; at an edge the focus holds.
 */
export function focusLibraryShelfRow(list: HTMLElement | null, direction: StudioStepDirection) {
  if (!list) return;
  const rows = [...list.querySelectorAll<HTMLElement>(`[${LIBRARY_SHELF_ROW_ATTRIBUTE}]`)];
  const at = rows.findIndex((row) => row === document.activeElement);
  const next = studioSpatialStepOf(rows.map((row) => row.getBoundingClientRect()), at === -1 ? null : at, direction);
  if (next === null) return;
  rows[next].focus();
  rows[next].scrollIntoView({ block: 'nearest' });
}

/** The shelf's keys: `/` to search, the arrows move through the rows or the grid's tiles, `Enter` opens the focused one. */
export function useLibraryShelfHotkeys(listRef: RefObject<HTMLElement | null>, searchRef: RefObject<HTMLInputElement | null>) {
  useHotkeys([
    { hotkey: '/', callback: () => searchRef.current?.focus(), options: { meta: { group: 'library', name: 'Search' } } },
    { hotkey: 'ArrowDown', callback: () => focusLibraryShelfRow(listRef.current, 'down'), options: { meta: { group: 'library', name: 'Move down' } } },
    { hotkey: 'ArrowUp', callback: () => focusLibraryShelfRow(listRef.current, 'up'), options: { meta: { group: 'library', name: 'Move up' } } },
    { hotkey: 'ArrowLeft', callback: () => focusLibraryShelfRow(listRef.current, 'left'), options: { meta: { group: 'library', name: 'Move left' } } },
    { hotkey: 'ArrowRight', callback: () => focusLibraryShelfRow(listRef.current, 'right'), options: { meta: { group: 'library', name: 'Move right' } } },
    // Listed for the cheatsheet only: a row is a link, and the browser's own `Enter` opens it.
    { hotkey: 'Enter', callback: () => {}, options: { preventDefault: false, stopPropagation: false, meta: { group: 'library', name: 'Open row' } } },
  ]);
}
