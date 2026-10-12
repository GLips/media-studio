import { useHotkeys } from '@tanstack/react-hotkeys';
import type { RefObject } from 'react';
import { PROJECT_ROW_ATTRIBUTE } from './project-row.tsx';

/** Focuses the row `by` steps from the focused one, or the first row when none is focused; the list doesn't wrap. */
function focusProjectRow(list: HTMLElement | null, by: 1 | -1) {
  if (!list) return;
  const rows = [...list.querySelectorAll<HTMLElement>(`[${PROJECT_ROW_ATTRIBUTE}]`)];
  const at = rows.findIndex((row) => row === document.activeElement);
  const next = at === -1 ? rows[0] : rows[Math.min(Math.max(at + by, 0), rows.length - 1)];
  next?.focus();
  next?.scrollIntoView({ block: 'nearest' });
}

/**
 * The dashboard's and a project page's keys: the arrows walk the rows, and `Enter` opens the focused one.
 * Document-wide: these screens have no other list to hold the arrows.
 */
export function useProjectRowHotkeys(listRef: RefObject<HTMLElement | null>) {
  useHotkeys([
    { hotkey: 'ArrowDown', callback: () => focusProjectRow(listRef.current, 1), options: { meta: { group: 'dashboard', name: 'Next row' } } },
    { hotkey: 'ArrowUp', callback: () => focusProjectRow(listRef.current, -1), options: { meta: { group: 'dashboard', name: 'Previous row' } } },
    // Listed for the cheatsheet only: a row is a link, and the browser's own `Enter` opens it (and presses any button).
    { hotkey: 'Enter', callback: () => {}, options: { preventDefault: false, stopPropagation: false, meta: { group: 'dashboard', name: 'Open row' } } },
  ]);
}
