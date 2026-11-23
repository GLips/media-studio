import { useHotkeys } from '@tanstack/react-hotkeys';
import type { RefObject } from 'react';
import { LIBRARY_SHELF_ROW_ATTRIBUTE } from './library-shelf-row.tsx';

/** Focuses the row `by` steps from the focused one, or the first row when none is; the list doesn't wrap. */
export function focusLibraryShelfRow(list: HTMLElement | null, by: 1 | -1) {
  if (!list) return;
  const rows = [...list.querySelectorAll<HTMLElement>(`[${LIBRARY_SHELF_ROW_ATTRIBUTE}]`)];
  const at = rows.findIndex((row) => row === document.activeElement);
  const next = at === -1 ? rows[0] : rows[Math.min(Math.max(at + by, 0), rows.length - 1)];
  next?.focus();
  next?.scrollIntoView({ block: 'nearest' });
}

/** The shelf's keys: `/` to search, the arrows walk the rows, `Enter` opens the focused one. */
export function useLibraryShelfHotkeys(listRef: RefObject<HTMLElement | null>, searchRef: RefObject<HTMLInputElement | null>) {
  useHotkeys([
    { hotkey: '/', callback: () => searchRef.current?.focus(), options: { meta: { group: 'library', name: 'Search' } } },
    { hotkey: 'ArrowDown', callback: () => focusLibraryShelfRow(listRef.current, 1), options: { meta: { group: 'library', name: 'Next row' } } },
    { hotkey: 'ArrowUp', callback: () => focusLibraryShelfRow(listRef.current, -1), options: { meta: { group: 'library', name: 'Previous row' } } },
    // Listed for the cheatsheet only: a row is a link, and the browser's own `Enter` opens it.
    { hotkey: 'Enter', callback: () => {}, options: { preventDefault: false, stopPropagation: false, meta: { group: 'library', name: 'Open row' } } },
  ]);
}
