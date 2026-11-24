import { useHotkeys } from '@tanstack/react-hotkeys';
import type { RefObject } from 'react';
import { projectSpatialStepOf, type ProjectStepDirection } from './project-spatial-step.ts';
import { PROJECT_ROW_ATTRIBUTE } from './project-target-link.tsx';

/** Focuses the row or tile an arrow leads to from the focused one (projectSpatialStepOf), or the first when none is. */
function focusProjectItem(list: HTMLElement | null, direction: ProjectStepDirection) {
  if (!list) return;
  const items = [...list.querySelectorAll<HTMLElement>(`[${PROJECT_ROW_ATTRIBUTE}]`)];
  const at = items.findIndex((item) => item === document.activeElement);
  const next = projectSpatialStepOf(items.map((item) => item.getBoundingClientRect()), at === -1 ? null : at, direction);
  if (next === null) return;
  items[next].focus();
  items[next].scrollIntoView({ block: 'nearest' });
}

/**
 * The dashboard's and a project page's keys: the arrows move through the rows and a grid's tiles as they sit on
 * screen, and `Enter` opens the focused one.
 * Document-wide: these screens have no other list to hold the arrows.
 */
export function useProjectRowHotkeys(listRef: RefObject<HTMLElement | null>) {
  useHotkeys([
    { hotkey: 'ArrowDown', callback: () => focusProjectItem(listRef.current, 'down'), options: { meta: { group: 'dashboard', name: 'Move down' } } },
    { hotkey: 'ArrowUp', callback: () => focusProjectItem(listRef.current, 'up'), options: { meta: { group: 'dashboard', name: 'Move up' } } },
    { hotkey: 'ArrowLeft', callback: () => focusProjectItem(listRef.current, 'left'), options: { meta: { group: 'dashboard', name: 'Move left' } } },
    { hotkey: 'ArrowRight', callback: () => focusProjectItem(listRef.current, 'right'), options: { meta: { group: 'dashboard', name: 'Move right' } } },
    // Listed for the cheatsheet only: a row is a link, and the browser's own `Enter` opens it (and presses any button).
    { hotkey: 'Enter', callback: () => {}, options: { preventDefault: false, stopPropagation: false, meta: { group: 'dashboard', name: 'Open row' } } },
  ]);
}
